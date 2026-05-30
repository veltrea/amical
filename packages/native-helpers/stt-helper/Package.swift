// swift-tools-version:6.0
import PackageDescription

// Dedicated STT helper (mac-only) running Qwen3-ASR via MLX (soniqo/speech-swift).
// Kept as a SEPARATE process from SwiftHelper so heavy/experimental MLX inference
// never blocks the real-time accessibility / keyboard / paste helper.
//
// Swift 5 language mode: speech-swift's Qwen3ASRModel is a non-Sendable class
// ("not thread-safe"), which trips Swift 6 strict-concurrency. CaptionCraft builds
// it under Xcode's Swift 5 mode; we match that.
let package = Package(
    name: "STTHelper",
    platforms: [
        .macOS(.v15)
    ],
    dependencies: [
        // Pinned to the exact revision CaptionCraft uses (branch main @ 4c927a6).
        .package(
            url: "https://github.com/soniqo/speech-swift",
            revision: "4c927a6bb34cd6b27719521ed7484f7d3b31f366"
        ),
        // On-device LLM for post-transcription proofreading. mlx-swift-lm ships
        // MLXLLM — a GENERIC HF model loader (Llama/Qwen/Gemma/... by repo id), so
        // users can one-click a recommended model OR paste any HF repo URL. It pins
        // mlx-swift to ">=0.31.3 <0.32.0", the SAME range speech-swift resolves
        // (0.31.3), so both libraries share ONE MLX runtime in this single process.
        .package(
            url: "https://github.com/ml-explore/mlx-swift-lm",
            from: "3.31.3"
        ),
        // Default HF hub client + tokenizer loader behind MLXLLM's generic loader.
        // Already transitively resolved by mlx-swift-lm; declared directly so the
        // helper can import them for the #huggingFaceLoadModelContainer macro.
        .package(
            url: "https://github.com/huggingface/swift-transformers",
            from: "1.3.0"
        ),
        .package(
            url: "https://github.com/huggingface/swift-huggingface",
            from: "0.9.0"
        )
    ],
    targets: [
        .executableTarget(
            name: "stt-helper",
            dependencies: [
                .product(name: "Qwen3ASR", package: "speech-swift"),
                .product(name: "AudioCommon", package: "speech-swift"),
                // Bundled zero-setup "recommended" proofreading model
                // (Qwen3.5-0.8B, INT4/INT8). This is a Qwen3.5-specific
                // implementation, NOT a generic loader — hence MLXLLM below too.
                .product(name: "Qwen3Chat", package: "speech-swift"),
                // Generic on-device LLM: load ANY HF repo (e.g. 1.7B 4bit) by id.
                .product(name: "MLXLLM", package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                // #huggingFaceLoadModelContainer needs the default HubClient
                // (HuggingFace) + AutoTokenizer loader (Tokenizers).
                .product(name: "MLXHuggingFace", package: "mlx-swift-lm"),
                .product(name: "HuggingFace", package: "swift-huggingface"),
                .product(name: "Tokenizers", package: "swift-transformers")
            ]
        )
    ],
    swiftLanguageModes: [.v5]
)
