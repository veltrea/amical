**他の言語で読む:** [English](CHANGELOG.md)

# 変更履歴

このフォークの主な変更をここに記録します。このフォーク（[veltrea/amical](https://github.com/veltrea/amical)）は本家 [Amical](https://github.com/amicalhq/amical) に追従しつつ、Apple Silicon 上で完全オンデバイス・エージェント連携の AI を足していきます。フォーマットは [Keep a Changelog](https://keepachangelog.com/) に準拠します。

## [1.7.1-fork.4] - 2026-06-02

「すべてオンデバイス」リリース。校正・辞書ライブラリ・Claude Code 連携の MCP サーバーが同時に着地します。（`1.7.1-fork.3` としてタグ付けした校正の作業は単体では公開せず、本リリースに含めます。）

### Added（追加）

- **オンデバイス校正（MLX LLM）。** ローカル LLM が Qwen3-ASR の文字起こしを整える——句読点・大文字小文字・フィラー除去——同じ MLX ヘルパープロセス内で、完全オフライン。
  - 言語別おすすめモデル: ja `LFM2.5-1.2B-JP`・`Llama-3.1-Swallow-8B`、en `Phi-4-mini`・`Llama-3.2-3B`、zh `Qwen2.5-3B`。任意の Hugging Face MLX リポジトリをカスタムモデルとして利用可。
  - 自由記述のユーザー校正ルールを組み込みフォーマッタの上に重ねられる。組み込みの安全ルール（書き換え禁止・翻訳禁止）が常に優先。
  - システムプロンプトを丸ごと差し替える上級者向けの抜け道（デフォルトは折りたたみ）。
  - メモリ戦略（balanced / fast / low）で他のローカル LLM と共存。
- **辞書ライブラリ。** 同梱の分野別辞書9個（749エントリ）を辞書単位で on/off。有効なバンドルは ASR の語彙に合成される。バンドルは単語リストに展開されないので、手動で追加した語彙は無傷。**設定 → 辞書ライブラリ** にカテゴリフィルタ付きのカードグリッド。
- **MCP サーバー（Claude Code 連携）。** ローカルの Streamable-HTTP エンドポイント（`127.0.0.1:7878`）、Bearer トークン認証、loopback 限定。`vocabulary_*`（6）・`transcriptions_*`（2）の tool を公開。デフォルト OFF。有効化トグル・ポート・トークン・セットアップスニペットを備えた設定ページ。
- **語彙の import / export。** 全語彙を JSON にエクスポート。skip / overwrite モードでインポート。
- **権限の修復。** ad-hoc 再ビルド後に古くなった macOS TCC（マイク / アクセシビリティ）エントリをワンクリックで修復。

### Fixed（修正）

- IME セーフな校正テキストエリア——日本語の変換中（例:「ITや」）が optimistic-update の prop で壊されなくなった。
- output-format テンプレート由来でフォーマッタが出力する前後の改行を除去。
- dev モードでのネイティブヘルパーのパス解決を堅牢化。
- 質問型の入力に対するアンサー型のフォーマッタ出力を破棄。

### Changed（変更）

- 開発時の TCC 安定性のため、`/Applications` ではなくビルド出力から起動するようにした。

## [1.7.1-fork.2] - 2026-05-29

### Added（追加）

- **オンデバイス Qwen3-ASR（MLX）。** Apple Silicon 上で完全オンデバイス・ノークラウドの音声認識（日本語含む52言語）、API キー不要。
  - 切替可能な2つのモデルサイズ: `Qwen3-ASR 0.6B`（約 680 MB）と `1.7B`（約 2.1 GB）。
  - オンデバイスモデルのダウンロード / 進捗 / 削除 UI。
  - 起動時ウォームアップ: 起動段階でモデルロード＋ Metal カーネル事前コンパイル。
  - 推論は専用の Swift MLX ヘルパープロセス（`stt-helper`）で分離。
- Apple Developer ID が無いとき自動で ad-hoc deep sign し、macOS TCC がマイク / アクセシビリティを受け付けるようにした。

## [1.7.1-fork.1] - 2026-05-28

### Added（追加）

- フローティングウィジェットの IPC ベースの手動ドラッグ。
- 文字起こし後に音声を削除するオプション。

### Fixed（修正）

- 長時間セッションの速度低下、文字起こしの停止、古いクリップボードのペースト。
- 録音中のドラッグ後もウィジェットを操作可能に保つ。

---

リリース: <https://github.com/veltrea/amical/releases>。汎用的で幅広く動くアプリ（Intel Mac 含む）は本家 [Amical](https://github.com/amicalhq/amical) をどうぞ。

[1.7.1-fork.4]: https://github.com/veltrea/amical/releases/tag/v1.7.1-fork.4
[1.7.1-fork.2]: https://github.com/veltrea/amical/releases/tag/v1.7.1-fork.2
[1.7.1-fork.1]: https://github.com/veltrea/amical/releases/tag/v1.7.1-fork.1
