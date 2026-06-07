import Foundation
import AudioCommon
import Qwen3ASR
import MLX
import MLXLLM
import MLXLMCommon
import MLXHuggingFace
import HuggingFace
import Tokenizers

// stt-helper: line-delimited JSON-RPC over stdin/stdout, mirroring SwiftHelper's
// transport. Runs Qwen3-ASR (MLX) in its own process so heavy/experimental
// inference never blocks the real-time accessibility/keyboard helper.
//
// Requests  (one JSON object per line on stdin):
//   {"id":"1","method":"prepare","params":{"modelId":"..."}}
//   {"id":"2","method":"transcribe","params":{"path":"/abs.wav","language":"auto"}}
//   {"id":"3","method":"transcribe","params":{"pcmBase64":"...","sampleRate":16000}}
//   {"id":"4","method":"ping"}
// Responses (one JSON object per line on stdout):
//   {"id":"1","result":{"ready":true,"modelId":"..."}}
//   {"id":"2","result":{"text":"..."}}
//   {"id":"2","error":"message"}
//
// Logs go to stderr only. Default model is the 0.6B 4-bit MLX build.

let defaultModelId = "aufklarer/Qwen3-ASR-0.6B-MLX-4bit"

func logErr(_ s: String) { FileHandle.standardError.write(Data((s + "\n").utf8)) }

// MARK: - Wire types

struct RPCParams: Decodable {
    let modelId: String?
    let path: String?
    let pcmBase64: String?
    let sampleRate: Int?
    let language: String?
    // ASR context hint: domain vocabulary injected into Qwen3-ASR's system
    // prompt to bias recognition toward these terms (Qwen3DecodingOptions.context).
    let context: String?
    // LLM (proofreading) params — used by loadLLM/generate.
    let systemPrompt: String?
    let userPrompt: String?
    let maxTokens: Int?
}

struct RPCRequest: Decodable {
    let id: String
    let method: String
    let params: RPCParams?
}

struct RPCResult: Encodable {
    var ready: Bool? = nil
    var modelId: String? = nil
    var text: String? = nil
}

struct RPCResponse: Encodable {
    let id: String
    var result: RPCResult? = nil
    var error: String? = nil
}

struct HelperError: Error { let message: String }

// MARK: - Async bridge
// fromPretrained is async; the stdin loop is synchronous. Run the async work on
// the cooperative pool and block the reader thread until it finishes (the helper
// does one thing at a time, so blocking here is fine).
func runBlocking<T>(_ op: @escaping () async throws -> T) throws -> T {
    let sem = DispatchSemaphore(value: 0)
    var outcome: Result<T, Error>!
    Task {
        do { outcome = .success(try await op()) } catch { outcome = .failure(error) }
        sem.signal()
    }
    sem.wait()
    return try outcome.get()
}

extension Data {
    /// Interpret bytes as little-endian Float32 PCM samples.
    func toFloat32Array() -> [Float] {
        let count = self.count / MemoryLayout<Float>.size
        return self.withUnsafeBytes { raw in
            Array(raw.bindMemory(to: Float.self).prefix(count))
        }
    }
}

// MARK: - Engine

var model: Qwen3ASRModel?
var currentModelId: String?

// MARK: - LLM engine (proofreading)
// Shares THIS single process with ASR. The transcription pipeline runs ASR and
// proofreading serially (record -> transcribe -> finalize/format), so the two
// never infer at the same time — exactly what MLX needs (no concurrent inference).
// The TS client decides, per the user's memory strategy, whether to keep the LLM
// resident or unloadLLM() after each format.

var llm: ModelContainer?
var currentLLMId: String?

func ensureLLM(_ modelId: String) throws {
    if llm != nil && currentLLMId == modelId { return }
    if llm != nil {
        logErr("stt-helper: switching LLM \(currentLLMId ?? "?") -> \(modelId)")
        llm = nil
        currentLLMId = nil
        MLX.Memory.clearCache()
    }
    logErr("stt-helper: loading LLM \(modelId)")
    llm = try runBlocking {
        try await #huggingFaceLoadModelContainer(
            configuration: ModelConfiguration(id: modelId)
        ) { progress in
            logErr(String(format: "stt-helper: [DL] %3d%% loading LLM",
                          Int(progress.fractionCompleted * 100)))
        }
    }
    currentLLMId = modelId
    logErr("stt-helper: LLM ready")
}

func unloadLLM() {
    guard llm != nil else { return }
    logErr("stt-helper: unloading LLM \(currentLLMId ?? "?")")
    llm = nil
    currentLLMId = nil
    MLX.Memory.clearCache()
}

// One-shot proofreading. A fresh ChatSession per call keeps the LLM stateless
// (no history bleed between transcriptions). systemPrompt/userPrompt come from
// the existing TS formatter-prompt builder, so app-type rules + vocabulary
// transfer verbatim from the cloud/Ollama path.
func handleGenerate(_ p: RPCParams?) throws -> RPCResult {
    guard let modelId = p?.modelId else {
        throw HelperError(message: "generate requires 'modelId'")
    }
    guard let userPrompt = p?.userPrompt else {
        throw HelperError(message: "generate requires 'userPrompt'")
    }
    try ensureLLM(modelId)
    guard let container = llm else { throw HelperError(message: "LLM not loaded") }

    var params = GenerateParameters()
    params.temperature = 0.1            // proofreading: near-deterministic
    params.maxTokens = p?.maxTokens ?? 4000
    params.repetitionPenalty = 1.05

    let session = ChatSession(
        container,
        instructions: p?.systemPrompt,
        generateParameters: params
    )
    let text = try runBlocking { try await session.respond(to: userPrompt) }
    return RPCResult(text: text.trimmingCharacters(in: .whitespacesAndNewlines))
}

func ensureModel(_ modelId: String?) throws {
    let mid = modelId ?? defaultModelId
    // Already loaded and the requested variant matches -> nothing to do.
    if model != nil && currentModelId == mid { return }
    // Switching variants (e.g. 0.6B <-> 1.7B): drop the old weights first.
    if model != nil {
        logErr("stt-helper: switching model \(currentModelId ?? "?") -> \(mid)")
        model = nil
        currentModelId = nil
    }
    logErr("stt-helper: loading model \(mid)")
    model = try runBlocking {
        try await Qwen3ASRModel.fromPretrained(
            modelId: mid,
            cacheDir: nil,
            offlineMode: false,
            progressHandler: { fraction, status in
                logErr(String(format: "stt-helper: [DL] %3d%% %@", Int(fraction * 100), "\(status)"))
            }
        )
    }
    currentModelId = mid
    logErr("stt-helper: model ready")

    // Pre-compile the Metal kernels with a throwaway inference so the first real
    // transcription doesn't pay the one-time JIT/kernel-compilation cost.
    if let m = model {
        let warmupSamples = [Float](repeating: 0, count: 8_000) // 0.5s @ 16kHz
        _ = m.transcribe(audio: warmupSamples, sampleRate: 16_000, options: decodeOptions(nil))
        logErr("stt-helper: warmup inference done")
    }
}

func decodeOptions(_ language: String?, context: String? = nil) -> Qwen3DecodingOptions {
    var o = Qwen3DecodingOptions()
    // language: nil => auto-detect + transcribe in source language (no translation)
    o.language = (language == "auto" || (language?.isEmpty ?? true)) ? nil : language
    // context: nil => no bias; non-empty => prepended to the decoder prompt as a
    // glossary that softly biases recognition (see Qwen3DecodingOptions.context).
    o.context = (context?.isEmpty ?? true) ? nil : context
    // Mandatory for the 0.6B 4-bit model: prevents repetition loops on short chunks.
    o.repetitionPenalty = 1.3
    o.noRepeatNgramSize = 4
    return o
}

func handleTranscribe(_ p: RPCParams?) throws -> RPCResult {
    try ensureModel(p?.modelId)
    guard let m = model else { throw HelperError(message: "model not prepared") }

    let sampleRate = p?.sampleRate ?? 16_000
    let samples: [Float]
    if let path = p?.path {
        samples = try AudioFileLoader.load(url: URL(fileURLWithPath: path), targetSampleRate: sampleRate)
    } else if let b64 = p?.pcmBase64, let data = Data(base64Encoded: b64) {
        samples = data.toFloat32Array()
    } else {
        throw HelperError(message: "transcribe requires 'path' or 'pcmBase64'")
    }

    let text = m.transcribe(audio: samples, sampleRate: sampleRate, options: decodeOptions(p?.language, context: p?.context))
    return RPCResult(text: text.trimmingCharacters(in: .whitespacesAndNewlines))
}

func writeResponse(_ resp: RPCResponse, _ encoder: JSONEncoder) {
    do {
        let data = try encoder.encode(resp)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        logErr("stt-helper: failed to encode response: \(error)")
    }
}

// MARK: - Main loop

let decoder = JSONDecoder()
let encoder = JSONEncoder()

logErr("stt-helper: started (default model \(defaultModelId))")

// Run the blocking stdin loop OFF the main thread. mlx-swift-lm's model loader
// hops to the main actor while loading; if the loop's runBlocking sem.wait()
// occupies the main thread, that hop deadlocks (observed: the main thread sat in
// semaphore_wait for the entire time an LLM was "loading", with no download
// progress). dispatchMain() below keeps the main thread pumping the main queue
// so the loader's main-actor work can proceed. ASR worked before only because
// Qwen3ASRModel.fromPretrained never hopped to the main actor.
DispatchQueue.global(qos: .userInitiated).async {
while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    guard let data = line.data(using: .utf8) else {
        logErr("stt-helper: non-utf8 line on stdin")
        continue
    }

    let req: RPCRequest
    do {
        req = try decoder.decode(RPCRequest.self, from: data)
    } catch {
        logErr("stt-helper: malformed request: \(error)")
        continue
    }

    var resp = RPCResponse(id: req.id)
    do {
        switch req.method {
        case "prepare":
            try ensureModel(req.params?.modelId)
            resp.result = RPCResult(ready: true, modelId: req.params?.modelId ?? defaultModelId)
        case "transcribe":
            resp.result = try handleTranscribe(req.params)
        case "ping":
            resp.result = RPCResult(ready: true)
        case "loadLLM":
            guard let mid = req.params?.modelId else {
                throw HelperError(message: "loadLLM requires 'modelId'")
            }
            try ensureLLM(mid)
            resp.result = RPCResult(ready: true, modelId: mid)
        case "unloadLLM":
            unloadLLM()
            resp.result = RPCResult(ready: true)
        case "generate":
            resp.result = try handleGenerate(req.params)
        default:
            resp.error = "unknown method: \(req.method)"
        }
    } catch let e as HelperError {
        resp.error = e.message
    } catch {
        resp.error = "\(error)"
    }
    writeResponse(resp, encoder)
}

logErr("stt-helper: stdin closed, exiting")
exit(0)
}

// Keep the main thread alive and servicing the main queue (main actor) while the
// stdin loop runs on the background queue above.
dispatchMain()
