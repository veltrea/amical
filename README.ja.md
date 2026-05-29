**他の言語で読む:** [English](README.md)

# Amical — オンデバイス Qwen3-ASR フォーク

**[Amical](https://github.com/amicalhq/amical) の、尖ったフォーク。** このフォークは1つの最先端のゴールに振り切っています——完全オンデバイス・ノークラウドの音声認識を、Apple Silicon 上の **Qwen3-ASR（MLX）** で実現すること。本家では取り組みづらい、攻めた挑戦です。

幅広い互換性（Intel Mac 含む）や汎用的な使い勝手が欲しい人は、本家 **[Amical](https://github.com/amicalhq/amical)** をどうぞ——十分に便利で、ちゃんとカバーしてくれます。このフォークは、最新のローカル AI を自分の Apple Silicon Mac で動かしたい人のためのものです。

## このフォークが足したもの

- **オンデバイス Qwen3-ASR（MLX）** — 多言語音声認識（日本語含む52言語）を Mac 上だけで実行。クラウドも API キーも不要。
- **2つのモデルサイズを切替** — `Qwen3-ASR 0.6B`（約 680 MB）と `Qwen3-ASR 1.7B`（約 2.1 GB）。速度と精度で選べる。
- **ダウンロード/進捗/削除 UI** — 同梱の Whisper モデルと同じように、オンデバイスモデルを管理。ダウンロード進捗もリアルタイム表示。
- **起動時ウォームアップ** — 起動の段階でモデルをロードし Metal カーネルを事前コンパイルするので、初回の文字起こしも2回目以降と同じ速さ。
- **推論プロセスの分離** — MLX は専用の Swift ヘルパー（`stt-helper`）で動き、リアルタイムのキーボード/アクセシビリティ用ヘルパーとは別プロセス。重い推論が入力処理を止めない。

Whisper（ローカル）と Amical Cloud は本家どおりそのまま使えます。

## 要件

- **Apple Silicon Mac（M シリーズ）。** Qwen3-ASR は **MLX** で動き、MLX は Apple Silicon 専用です——Intel Mac では動きません。Intel の方は本家 Amical をどうぞ。
- macOS 15 以降。

## インストール

1. [Releases](https://github.com/veltrea/amical/releases) から最新の `.dmg` をダウンロード。
2. DMG を開き、**Amical** を **アプリケーション** にドラッグ。
3. このビルドは **ad-hoc 署名**（Apple Developer ID による notarize なし）なので、初回起動時に macOS Gatekeeper が警告します。次のいずれかで許可してください:
   - アプリを右クリック → **開く**、または
   - **システム設定 → プライバシーとセキュリティ → このまま開く**、または
   - ターミナル: `xattr -dr com.apple.quarantine /Applications/Amical.app`
4. 求められたら **マイク** と **アクセシビリティ** を許可（システム設定 → プライバシーとセキュリティ）。

> notarize 済みビルドが欲しい? フォークして自分の Developer ID でビルドしてください——「ソースからビルド」を参照。

## ソースからビルド

```bash
pnpm install
pnpm --filter @amical/desktop make:dmg:arm64
```

Developer ID が未設定なら、ビルドが自動で **ad-hoc 署名**します。署名＋ notarize 済みのリリースが欲しい場合は、`CODESIGNING_IDENTITY`・`APPLE_ID`・`APPLE_APP_PASSWORD`・`APPLE_TEAM_ID` を設定して同じコマンドを実行してください。

Qwen3-ASR は [soniqo/speech-swift](https://github.com/soniqo/speech-swift)（MLX）を使います。モデルは初回利用時に Hugging Face からダウンロードされ、`~/Library/Caches/qwen3-speech/` にキャッシュされます。

## Roadmap（構想・未実装）

このフォークが探求していく方向です——いずれも オンデバイス／エージェント連携の AI:

- **MLX 組み込みの AI 校正** — AI の校正/整形 LLM を MLX でアプリに組み込み、別ソフト（Ollama 等）のインストール無しで動くようにする。
- **MCP/ACP による AI 辞書編集** — カスタム辞書を MCP/ACP 経由で公開し、AI エージェントが各分野の専門用語を自動追加。手入力をなくす。
- **履歴からの自動学習** — AI に文字起こし履歴を分析させ、誤変換した単語を検出して辞書へ自動登録。

## クレジット

Amical チーム（[amical.ai](https://amical.ai)）による **[Amical](https://github.com/amicalhq/amical)** を土台にしています。ベースアプリの功績はすべて彼らのものです。汎用的で幅広く動くアプリが欲しい場合は本家をどうぞ。

## ライセンス

MIT。本家 Amical に準拠。
