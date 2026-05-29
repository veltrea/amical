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
        )
    ],
    targets: [
        .executableTarget(
            name: "stt-helper",
            dependencies: [
                .product(name: "Qwen3ASR", package: "speech-swift"),
                .product(name: "AudioCommon", package: "speech-swift")
            ]
        )
    ],
    swiftLanguageModes: [.v5]
)
