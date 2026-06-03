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
- **On-device proofreading (MLX LLM)** — a local LLM cleans up the transcript (punctuation, casing, filler, your own rules) in the same helper, fully offline. See below.
- **Dictionary library** — bundled domain dictionaries (medical, legal, programming, anime, cooking, …) you switch on per-bundle so niche terms get recognised. See below.
- **MCP server** — expose your vocabulary and dictation history to Claude Code over local HTTP. See below.
- **Reliable foreground from the tray** — picking **Open Console** from the menu bar tray brings Amical to the front, even when another app (Claude Desktop, a browser, …) was frontmost. This matters when Amical is running without a Dock icon (`Show in Dock` off in Preferences) and the tray is your only way back into the main window.

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

## On-device proofreading (MLX LLM)

After Qwen3-ASR transcribes, an on-device LLM cleans the text up — punctuation, capitalisation, filler removal — in the same MLX helper process, fully offline. No cloud, and no separate runtime (Ollama etc.) to install.

- **Language-aware recommended models** — pick a small local LLM per language: **ja** `LFM2.5-1.2B-JP` (~1.3 GB) or `Llama-3.1-Swallow-8B`; **en** `Phi-4-mini` or `Llama-3.2-3B`; **zh** `Qwen2.5-3B`. Any Hugging Face MLX repo can be pasted in as a custom model.
- **Your own rules** — a free-form textarea layers your rules on top of the built-in formatter (e.g. "always use です/ます", "keep technical terms in English"). The built-in safety rules (no rewriting, no translation, preserve content) always take precedence.
- **Memory strategy** (balanced / fast / low) — choose how aggressively the LLM stays resident between dictations, so it can coexist with other local LLMs like LM Studio.

Enable it in **Settings → Dictation → Formatting**. Models download from Hugging Face on first use.

## Dictionary library

Bundled, domain-specific dictionaries you switch on per-bundle. When active, their entries are merged into the vocabulary Qwen3-ASR sees, so niche terms in that domain are transcribed correctly. Whole bundles are toggled as a unit — they are **not** flattened into your word list, so your hand-added vocabulary is never touched.

Thirteen bundles ship in-app (1,140 entries total):

| Bundles | Category |
|---|---|
| Online Services · AI Companies · Software & Tools | general |
| Programming | developer |
| Anime & Manga · Light Novels · Video Games | creator |
| Cooking · Fishing | general |
| Medical & Healthcare · Law & Legal · Accounting & Finance · Construction & Real Estate | professional |

Turn bundles on/off in **Settings → Dictionary Library**. Toggling is instant — no thousand-row import, and disabling a bundle leaves your manual entries intact.

## MCP server (Claude Code integration)

Amical can expose its vocabulary and dictation history to Claude Code (or any HTTP-MCP client) over a local Streamable-HTTP endpoint.

It is **off by default**. To turn it on:

1. **Settings → MCP Server** in Amical → flip the toggle to **Enable**.
2. Copy the URL (`http://127.0.0.1:7878/mcp`) and the bearer token.
3. Register it with Claude Code:

   ```bash
   claude mcp add amical \
     --transport http \
     --url http://127.0.0.1:7878/mcp \
     --header "Authorization: Bearer <token>"
   ```

The server binds **loopback-only**; it is not reachable from the LAN. Once enabled, Claude gets the following tools:

- `vocabulary_list`, `vocabulary_add`, `vocabulary_update`, `vocabulary_delete`, `vocabulary_bulk_add`, `vocabulary_search`
- `transcriptions_recent`, `transcriptions_search`

**Privacy note.** `transcriptions_recent` exposes your dictation history to whichever LLM is on the other side. Dictation history often contains very personal text — only enable this if you understand what gets shared.

You can sanity-check the wire protocol without launching Amical via the smoketest script:

```bash
pnpm exec tsx scripts/mcp-smoketest.ts
# then in another shell:
curl -s -X POST http://127.0.0.1:7878/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Roadmap (planned, not yet implemented)

The directions this fork is still exploring — all on-device / agent-integrated AI:

- **Auto-learn from history** — have the AI analyze transcription history, detect mis-transcribed words, and register them to the dictionary automatically.

## Credit

Built on **[Amical](https://github.com/amicalhq/amical)** by the Amical team ([amical.ai](https://amical.ai)). All credit for the base application goes to them. For the general-purpose, broadly-compatible app, use upstream.

## License

MIT, same as upstream Amical.
