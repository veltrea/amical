**Read this in other languages:** [日本語](CHANGELOG.ja.md)

# Changelog

All notable changes to this fork are documented here. This fork ([veltrea/amical](https://github.com/veltrea/amical)) tracks upstream [Amical](https://github.com/amicalhq/amical) and adds on-device, agent-integrated AI on Apple Silicon. The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.7.1-fork.5] - 2026-06-03

### Fixed

- Tray menu's "Open Console" item now brings Amical to the front when another app was frontmost. Previously the main window opened behind the foreground app (e.g. Claude Desktop, a browser) and looked like nothing happened — `window.show()` + `window.focus()` is not enough on macOS when the app is in accessory mode (`app.dock.hide()`). Calls `app.focus({ steal: true })` on the existing-window path in addition to the per-window calls.

## [1.7.1-fork.4] - 2026-06-02

The "everything on-device" release: proofreading, a dictionary library, and a Claude Code MCP server land together. (The proofreading work tagged `1.7.1-fork.3` was never shipped on its own — it is included here.)

### Added

- **On-device proofreading (MLX LLM).** A local LLM cleans up the Qwen3-ASR transcript — punctuation, casing, filler removal — in the same MLX helper process, fully offline.
  - Language-aware recommended models: ja `LFM2.5-1.2B-JP`, `Llama-3.1-Swallow-8B`; en `Phi-4-mini`, `Llama-3.2-3B`; zh `Qwen2.5-3B`. Any Hugging Face MLX repo works as a custom model.
  - Free-form user proofreading rules, layered over the built-in formatter; the built-in safety rules (no rewriting, no translation) always win.
  - Advanced escape hatch to replace the system prompt entirely (collapsed by default).
  - Memory strategy (balanced / fast / low) so the LLM can coexist with other local LLMs.
- **Dictionary library.** Nine bundled domain dictionaries (749 entries) toggled per-bundle; active bundles are merged into the ASR vocabulary. Bundles are never flattened into your word list, so hand-added vocabulary is untouched. Card grid with category filters in **Settings → Dictionary Library**.
- **MCP server (Claude Code integration).** Local Streamable-HTTP endpoint (`127.0.0.1:7878`), bearer-token auth, loopback-only. Exposes `vocabulary_*` (6) and `transcriptions_*` (2) tools. Off by default; settings page with an enable toggle, port, token, and a setup snippet.
- **Vocabulary import / export.** Export all vocabulary to JSON; import with skip-vs-overwrite modes.
- **Permissions repair.** One-click repair for stale macOS TCC (Microphone / Accessibility) entries after ad-hoc rebuilds.

### Fixed

- IME-safe proofreading textarea — Japanese composition (e.g. "ITや") is no longer mangled by the optimistic-update prop.
- Strip leading/trailing newlines the formatter could echo from the output-format template.
- Robust native-helper path resolution in dev mode.
- Discard answer-shaped formatter output for question-shaped input.

### Changed

- Launch from the build output instead of `/Applications` for TCC stability during development.

## [1.7.1-fork.2] - 2026-05-29

### Added

- **On-device Qwen3-ASR (MLX).** Fully on-device, cloud-free speech-to-text on Apple Silicon (52 languages incl. Japanese), no API keys.
  - Two switchable model sizes: `Qwen3-ASR 0.6B` (~680 MB) and `1.7B` (~2.1 GB).
  - Download / progress / delete UI for the on-device models.
  - Warm-by-launch: model load + Metal kernel pre-compile at startup.
  - Inference isolated in a dedicated Swift MLX helper process (`stt-helper`).
- Auto ad-hoc deep-sign when no Apple Developer ID, so macOS TCC accepts microphone / accessibility.

## [1.7.1-fork.1] - 2026-05-28

### Added

- IPC-based manual drag for the floating widget.
- Option to delete audio after transcription.

### Fixed

- Long-session slowdown, transcription stalls, and stale clipboard paste.
- Keep the widget interactive after a drag during recording.

---

Releases: <https://github.com/veltrea/amical/releases>. For the general-purpose, broadly-compatible app (Intel Macs included), see upstream [Amical](https://github.com/amicalhq/amical).

[1.7.1-fork.5]: https://github.com/veltrea/amical/releases/tag/v1.7.1-fork.5
[1.7.1-fork.4]: https://github.com/veltrea/amical/releases/tag/v1.7.1-fork.4
[1.7.1-fork.2]: https://github.com/veltrea/amical/releases/tag/v1.7.1-fork.2
[1.7.1-fork.1]: https://github.com/veltrea/amical/releases/tag/v1.7.1-fork.1
