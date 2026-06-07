import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import split2 from "split2";
import { v4 as uuid } from "uuid";
import { createScopedLogger } from "../../../main/logger";

/**
 * Client for the dedicated `stt-helper` process (Qwen3-ASR via MLX, macOS only).
 *
 * Kept separate from NativeBridge on purpose: stt-helper is its own binary whose
 * heavy/experimental inference must never share a process with the real-time
 * accessibility/keyboard helper. Transport mirrors NativeBridge — line-delimited
 * JSON-RPC over stdio, correlated by id — but the surface is just prepare/transcribe.
 *
 * Spawned lazily on first use so non-Qwen3 sessions never start it.
 */

interface PrepareResult {
  ready: boolean;
  modelId: string;
}

interface TranscribeResult {
  text: string;
}

type RpcResultPayload = Partial<PrepareResult & TranscribeResult>;

interface RpcResponse {
  id: string;
  result?: RpcResultPayload;
  error?: string;
}

type PendingRpc = {
  method: string;
  resolve: (result: RpcResultPayload) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
};

// Model download on first prepare can pull hundreds of MB.
const PREPARE_TIMEOUT_MS = 10 * 60 * 1000;
const TRANSCRIBE_TIMEOUT_MS = 60 * 1000;
// LLM (proofreading) load may download a multi-GB model on first use; generation
// itself is a short burst. unload just frees weights, so it's quick.
const LOAD_LLM_TIMEOUT_MS = 15 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 120 * 1000;
const UNLOAD_LLM_TIMEOUT_MS = 30 * 1000;

export class Qwen3HelperClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRpc>();
  // Preventive recycle counter: MLX grows unstable over a very long-lived process
  // (learned on CaptionCraft), so we restart the helper every N generates. Crash
  // recovery is already automatic (the "close" handler nulls proc; the next call
  // respawns) — this just gets ahead of the slow degradation.
  private llmGenerateCount = 0;
  private static readonly RECYCLE_AFTER_GENERATES = 100;
  // --- Health metrics for degradation observation (read-only; no behavior
  // change). Reset on each (re)spawn so they describe the CURRENT process's
  // lifetime — that lifetime is exactly what we suspect degrades. ---
  private spawnedAt: number | null = null;
  private transcribeCount = 0;
  private generateCountTotal = 0;
  private totalTranscribeWallMs = 0;
  private totalTranscribeSamples = 0;
  private lastTranscribeRtf: number | null = null;
  private logger = createScopedLogger("qwen3-helper");
  private helperPath: string;
  // Set during a prepare() call to surface the helper's "[DL] NN% status" lines.
  private onDownloadProgress?: (fraction: number, status: string) => void;

  constructor() {
    this.helperPath = this.determineHelperPath();
  }

  private determineHelperPath(): string {
    const binaryName = "stt-helper";
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "bin", binaryName);
    }

    // Dev mode: probe both candidate anchors — app.getAppPath() resolves to
    // `apps/desktop` in some Electron launch paths and `apps/desktop/.vite/build`
    // in others. See native-bridge-service.determineHelperPath for the full
    // explanation. Keep the two helper resolvers in sync.
    const appPath = app.getAppPath();
    const candidates = [
      path.join(
        appPath,
        "..",
        "..",
        "packages",
        "native-helpers",
        "stt-helper",
        "bin",
        binaryName,
      ),
      path.join(
        appPath,
        "..",
        "..",
        "..",
        "..",
        "packages",
        "native-helpers",
        "stt-helper",
        "bin",
        binaryName,
      ),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  }

  /** True if the helper binary exists and is executable (built for this platform). */
  isAvailable(): boolean {
    try {
      fs.accessSync(this.helperPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * MLX/Metal init hangs (uninterruptible) when the binary is launched from an
   * external/mounted volume — e.g. a repo checked out on a USB drive under
   * /Volumes. Copy the helper (binary + its mlx-swift_Cmlx.bundle) to an internal
   * app dir and run from there. No-op when already on the boot volume. Re-copies
   * when the source binary is newer or a different size.
   */
  private stageHelperIfExternal(): void {
    if (!this.helperPath.startsWith("/Volumes/")) return;

    const srcDir = path.dirname(this.helperPath);
    const destDir = path.join(app.getPath("userData"), "stt-helper-bin");
    const destBinary = path.join(destDir, path.basename(this.helperPath));

    try {
      const srcStat = fs.statSync(this.helperPath);
      let needCopy = true;
      try {
        const destStat = fs.statSync(destBinary);
        needCopy =
          destStat.mtimeMs < srcStat.mtimeMs || destStat.size !== srcStat.size;
      } catch {
        needCopy = true;
      }
      if (needCopy) {
        this.logger.info(
          "Staging stt-helper from external volume to internal disk",
          { srcDir, destDir },
        );
        fs.rmSync(destDir, { recursive: true, force: true });
        fs.cpSync(srcDir, destDir, { recursive: true });
      }
      this.helperPath = destBinary;
    } catch (error) {
      this.logger.error(
        "Failed to stage stt-helper to internal disk; using original path",
        { error },
      );
    }
  }

  private ensureSpawned(): void {
    if (this.proc) return;

    this.stageHelperIfExternal();

    if (!this.isAvailable()) {
      throw new Error(
        `stt-helper not found at ${this.helperPath}. Build it with: pnpm build:stt-helper`,
      );
    }

    this.logger.info("Spawning stt-helper", { helperPath: this.helperPath });
    this.proc = spawn(this.helperPath, [], { stdio: ["pipe", "pipe", "pipe"] });

    // Reset health metrics: they describe THIS process instance's lifetime.
    this.spawnedAt = performance.now();
    this.transcribeCount = 0;
    this.generateCountTotal = 0;
    this.totalTranscribeWallMs = 0;
    this.totalTranscribeSamples = 0;
    this.lastTranscribeRtf = null;

    this.proc.stdout.pipe(split2()).on("data", (line: string) => {
      if (!line.trim()) return;
      let message: RpcResponse;
      try {
        message = JSON.parse(line);
      } catch (e) {
        this.logger.error("Failed to parse stt-helper stdout line", {
          line: line.slice(0, 500),
          error: e,
        });
        return;
      }
      const pending = message.id ? this.pending.get(message.id) : undefined;
      if (!pending) {
        this.logger.warn("stt-helper response with no pending request", {
          id: message.id,
        });
        return;
      }
      clearTimeout(pending.timeoutHandle);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(`stt-helper "${pending.method}" failed: ${message.error}`),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
    });

    this.proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      this.logger.debug("stt-helper stderr", { message: text.trim() });
      const handler = this.onDownloadProgress;
      if (handler) {
        // Lines look like: "stt-helper: [DL]  80% Loading weights..."
        for (const line of text.split("\n")) {
          const m = line.match(/\[DL\]\s*(\d+)%\s*(.*)/);
          if (m) handler(parseInt(m[1], 10) / 100, m[2].trim());
        }
      }
    });

    this.proc.on("error", (err) => {
      this.logger.error("stt-helper process error", { error: err });
      this.rejectAll(err);
      this.proc = null;
      this.spawnedAt = null;
    });

    this.proc.on("close", (code, signal) => {
      this.logger.info("stt-helper process closed", { code, signal });
      this.rejectAll(
        new Error(`stt-helper exited (code: ${code}, signal: ${signal})`),
      );
      this.proc = null;
      this.spawnedAt = null;
    });
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<RpcResultPayload> {
    this.ensureSpawned();
    const proc = this.proc;
    if (!proc || !proc.stdin.writable) {
      return Promise.reject(new Error("stt-helper not available"));
    }

    const id = uuid();
    return new Promise<RpcResultPayload>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`stt-helper "${method}" timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.pending.set(id, { method, resolve, reject, timeoutHandle });

      proc.stdin.write(JSON.stringify({ id, method, params }) + "\n", (err) => {
        if (err) {
          clearTimeout(timeoutHandle);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * Load (and on first run download) the model. Idempotent in the helper.
   * onProgress, if given, receives the helper's download/load progress
   * (fraction 0..1 + a human-readable status) parsed from its stderr.
   */
  async prepare(
    modelId?: string,
    onProgress?: (fraction: number, status: string) => void,
  ): Promise<void> {
    this.onDownloadProgress = onProgress;
    try {
      await this.call("prepare", { modelId }, PREPARE_TIMEOUT_MS);
    } finally {
      this.onDownloadProgress = undefined;
    }
  }

  /**
   * Transcribe 16kHz mono Float32 PCM. language: undefined/"auto" => auto-detect.
   * context: optional domain vocabulary injected into Qwen3-ASR's system prompt
   * to bias recognition (see qwen3-context.ts / Qwen3DecodingOptions.context).
   */
  async transcribe(
    pcm: Float32Array,
    sampleRate: number,
    language?: string,
    modelId?: string,
    context?: string,
  ): Promise<string> {
    const pcmBase64 = Buffer.from(
      pcm.buffer,
      pcm.byteOffset,
      pcm.byteLength,
    ).toString("base64");
    const startedAt = performance.now();
    const result = await this.call(
      "transcribe",
      { pcmBase64, sampleRate, language, modelId, context },
      TRANSCRIBE_TIMEOUT_MS,
    );
    this.recordTranscribeMetrics(
      performance.now() - startedAt,
      pcm.length,
      sampleRate,
    );
    return result.text ?? "";
  }

  // ----- LLM (proofreading) -----
  // Same process / same MLX runtime as ASR. The pipeline runs ASR then formatting
  // serially, so the two never infer at once. The memory strategy decides whether
  // to keep the LLM resident (call loadLLM once) or free it after each format
  // (call unloadLLM), but generate() loads on demand regardless, so it's safe
  // either way.

  /**
   * Load (and on first run download) an LLM for proofreading. Idempotent in the
   * helper. onProgress, if given, receives download/load progress (fraction 0..1
   * + status) parsed from the helper's stderr — same channel as ASR prepare().
   */
  async loadLLM(
    modelId: string,
    onProgress?: (fraction: number, status: string) => void,
  ): Promise<void> {
    this.onDownloadProgress = onProgress;
    try {
      await this.call("loadLLM", { modelId }, LOAD_LLM_TIMEOUT_MS);
    } finally {
      this.onDownloadProgress = undefined;
    }
  }

  /** Free the LLM weights, keeping ASR loaded. Used by the "low memory" strategy. */
  async unloadLLM(): Promise<void> {
    await this.call("unloadLLM", {}, UNLOAD_LLM_TIMEOUT_MS);
  }

  /**
   * Proofread/format text. systemPrompt/userPrompt come from the existing TS
   * formatter-prompt builder, so app-type rules + vocabulary transfer verbatim
   * from the cloud/Ollama path. Loads the model first if needed. Returns the
   * model's raw text; XML-tag extraction happens on the caller side.
   */
  async generate(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens?: number,
  ): Promise<string> {
    // Recycle BEFORE generating, never mid-inference. Formatting runs between
    // dictations (after a recording finalizes), so disposing here can't interrupt
    // an active transcription; the next call() respawns and the helper reloads
    // the model on demand.
    if (this.llmGenerateCount >= Qwen3HelperClient.RECYCLE_AFTER_GENERATES) {
      this.logger.info("Preventively recycling stt-helper", {
        afterGenerates: this.llmGenerateCount,
      });
      this.dispose();
      this.llmGenerateCount = 0;
    }
    const result = await this.call(
      "generate",
      { modelId, systemPrompt, userPrompt, maxTokens },
      GENERATE_TIMEOUT_MS,
    );
    this.llmGenerateCount++;
    this.generateCountTotal++;
    return result.text ?? "";
  }

  private recordTranscribeMetrics(
    wallMs: number,
    samples: number,
    sampleRate: number,
  ): void {
    this.transcribeCount++;
    this.totalTranscribeWallMs += wallMs;
    this.totalTranscribeSamples += samples;
    const audioMs = sampleRate > 0 ? (samples / sampleRate) * 1000 : 0;
    this.lastTranscribeRtf = audioMs > 0 ? wallMs / audioMs : null;
  }

  /** Child pid of the running helper, or undefined when not spawned. */
  getPid(): number | undefined {
    return this.proc?.pid;
  }

  /**
   * Read-only health snapshot for degradation observation. Never spawns or
   * mutates. RTF = wall-clock ms / audio ms (>1 = slower than real time); a
   * single helper process's RTF drifting up over its lifetime is the signal we
   * are looking for. avgTranscribeRtf assumes 16kHz (the only rate used).
   */
  getHealthSnapshot(): {
    alive: boolean;
    pid: number | undefined;
    uptimeMs: number | null;
    transcribeCount: number;
    generateCountTotal: number;
    lastTranscribeRtf: number | null;
    avgTranscribeRtf: number | null;
  } {
    const audioMs = (this.totalTranscribeSamples / 16000) * 1000;
    return {
      alive: this.proc !== null,
      pid: this.proc?.pid,
      uptimeMs:
        this.spawnedAt !== null ? performance.now() - this.spawnedAt : null,
      transcribeCount: this.transcribeCount,
      generateCountTotal: this.generateCountTotal,
      lastTranscribeRtf: this.lastTranscribeRtf,
      avgTranscribeRtf:
        audioMs > 0 ? this.totalTranscribeWallMs / audioMs : null,
    };
  }

  dispose(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.rejectAll(new Error("stt-helper disposed"));
  }
}
