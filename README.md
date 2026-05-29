**Read this in other languages:** [日本語](README.ja.md)

# Amical — on-device Qwen3-ASR fork

**A focused fork of [Amical](https://github.com/amicalhq/amical).** This fork bets on one bleeding-edge goal: fully on-device, cloud-free speech-to-text with **Qwen3-ASR (MLX)** on Apple Silicon — the kind of sharp, experimental direction that's harder to carry in the main project.

If you want broad compatibility (Intel Macs included) and the general-purpose experience, use **upstream [Amical](https://github.com/amicalhq/amical)** — it's excellent and has you covered. This fork is for people who want to run the newest local AI right on their Apple Silicon Mac.

## What this fork adds

- **On-device Qwen3-ASR (MLX)** — multilingual speech-to-text (52 languages incl. Japanese) running entirely on your Mac. No cloud, no API keys.
- **Two model sizes, switchable** — `Qwen3-ASR 0.6B` (~680 MB) and `Qwen3-ASR 1.7B` (~2.1 GB). Trade speed for accuracy.
- **Download / progress / delete UI** — manage the on-device models like the bundled Whisper models, with live download progress.
- **Warm by launch** — the model loads and pre-compiles its Metal kernels at startup, so the first transcription is as fast as the rest.
- **Isolated inference process** — MLX runs in a dedicated Swift helper (`stt-helper`), separate from the real-time keyboard/accessibility helper, so heavy inference never blocks input handling.

Whisper (local) and Amical Cloud remain available, exactly as upstream.

## Requirements

- **Apple Silicon Mac (M-series).** Qwen3-ASR runs on **MLX**, which is Apple-Silicon-only — it does not run on Intel Macs. On Intel, use upstream Amical.
- macOS 15 or later.

## Install

1. Download the latest `.dmg` from [Releases](https://github.com/veltrea/amical/releases).
2. Open the DMG and drag **Amical** to **Applications**.
3. This build is **ad-hoc signed** (not notarized with an Apple Developer ID), so on first launch macOS Gatekeeper will warn. Allow it one of these ways:
   - Right-click the app → **Open**, or
   - **System Settings → Privacy & Security → Open Anyway**, or
   - Terminal: `xattr -dr com.apple.quarantine /Applications/Amical.app`
4. Grant **Microphone** and **Accessibility** when prompted (System Settings → Privacy & Security).

> Want a notarized build? Fork it and build with your own Developer ID — see "Build from source".

## Build from source

```bash
pnpm install
pnpm --filter @amical/desktop make:dmg:arm64
```

The build **ad-hoc signs** the app automatically when no Developer ID is set. For a signed + notarized release, set `CODESIGNING_IDENTITY`, `APPLE_ID`, `APPLE_APP_PASSWORD`, and `APPLE_TEAM_ID`, then run the same command.

Qwen3-ASR uses [soniqo/speech-swift](https://github.com/soniqo/speech-swift) (MLX). Models download from Hugging Face on first use and cache to `~/Library/Caches/qwen3-speech/`.

## Roadmap (planned, not yet implemented)

The directions this fork is exploring — all on-device / agent-integrated AI:

- **Embedded AI formatting (MLX)** — run the AI formatting/cleanup LLM through MLX built into the app, so it works with no separate runtime (e.g. Ollama) to install.
- **AI-driven dictionary editing (MCP/ACP)** — expose the custom dictionary over MCP/ACP so an AI agent can add domain-specific terminology automatically, instead of manual entry.
- **Auto-learn from history** — have the AI analyze transcription history, detect mis-transcribed words, and register them to the dictionary automatically.

## Credit

Built on **[Amical](https://github.com/amicalhq/amical)** by the Amical team ([amical.ai](https://amical.ai)). All credit for the base application goes to them. For the general-purpose, broadly-compatible app, use upstream.

## License

MIT, same as upstream Amical.
