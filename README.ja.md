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
- **オンデバイス校正（MLX LLM）** — ローカル LLM が文字起こし結果（句読点・大文字小文字・フィラー・自分のルール）を同じヘルパー内で整える。完全オフライン。（下記参照）
- **辞書ライブラリ** — 分野別のバンドル辞書（医療・法律・プログラミング・アニメ・料理…）を辞書単位で on にして、ニッチな用語を認識させる。（下記参照）
- **MCP サーバー** — 語彙・発話履歴をローカル HTTP 経由で Claude Code に公開。（下記参照）
- **トレイから設定画面を確実に前面化** — メニューバーのトレイから **コンソールを開く** を選ぶと、他のアプリ（Claude Desktop やブラウザ等）が前面にいるときでも Amical が必ず前面に出ます。`環境設定` で「Dock に表示」をオフにして運用しているとき、トレイが設定画面に戻る唯一の入口になるので効きます。

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

## オンデバイス校正（MLX LLM）

Qwen3-ASR が文字起こししたあと、オンデバイスの LLM がテキストを整えます——句読点、大文字小文字、フィラー除去——同じ MLX ヘルパープロセス内で、完全オフラインで動きます。クラウド不要、別ランタイム（Ollama 等）のインストールも不要。

- **言語別おすすめモデル** — 言語ごとに軽量ローカル LLM を選べます: **ja** `LFM2.5-1.2B-JP`（約 1.3 GB）または `Llama-3.1-Swallow-8B`、**en** `Phi-4-mini` または `Llama-3.2-3B`、**zh** `Qwen2.5-3B`。任意の Hugging Face MLX リポジトリをカスタムモデルとして貼り付けることもできます。
- **自分のルール** — 自由記述のテキストエリアで、組み込みフォーマッタの上に自分のルールを重ねられます（例:「常に です・ます調」「専門用語は英語のまま」）。組み込みの安全ルール（書き換え禁止・翻訳禁止・内容保持）が常に優先されます。
- **メモリ戦略**（balanced / fast / low） — ディクテーション間で LLM をどれだけ常駐させるかを選べます。LM Studio など他のローカル LLM と共存できます。

**設定 → ディクテーション → フォーマット** で有効化します。モデルは初回利用時に Hugging Face からダウンロードされます。

## 辞書ライブラリ

分野別のバンドル辞書を、辞書単位で on/off できます。有効にすると、その辞書のエントリが Qwen3-ASR の参照する語彙に合成され、その分野のニッチな用語が正しく文字起こしされます。辞書はバンドル丸ごとを単位として切り替わり、あなたの単語リストに**展開されません**。だから手動で追加した語彙には一切触れません。

アプリには13のバンドルが同梱されています（合計1,140エントリ）:

| バンドル | カテゴリ |
|---|---|
| オンラインサービス・AI企業・ソフトウェア/ツール | 一般 |
| プログラミング | 開発者 |
| アニメ/マンガ・ライトノベル・ゲーム | クリエイター |
| 料理・釣り | 一般 |
| 医療/医学・法律/法務・会計/税務/金融・建築/不動産 | 専門職 |

**設定 → 辞書ライブラリ** でバンドルを on/off します。切り替えは一瞬——数千行の import は無く、バンドルを無効化しても手動エントリはそのまま残ります。

## MCP サーバー（Claude Code 連携）

Amical は辞書・発話履歴を Claude Code（および任意の HTTP-MCP クライアント）にローカル Streamable-HTTP エンドポイント経由で公開できます。

**デフォルトは OFF** です。有効化手順:

1. Amical で **設定 → MCP サーバー** を開き、トグルを **有効化** に切替。
2. URL（`http://127.0.0.1:7878/mcp`）と Bearer トークンをコピー。
3. Claude Code に登録:

   ```bash
   claude mcp add amical \
     --transport http \
     --url http://127.0.0.1:7878/mcp \
     --header "Authorization: Bearer <token>"
   ```

サーバーは **loopback 限定**でバインドされます。LAN からはアクセス不能です。有効化すると Claude は次の tool を使えます:

- `vocabulary_list`, `vocabulary_add`, `vocabulary_update`, `vocabulary_delete`, `vocabulary_bulk_add`, `vocabulary_search`
- `transcriptions_recent`, `transcriptions_search`

**プライバシー上の注意:** `transcriptions_recent` は発話履歴を相手の LLM に渡します。発話履歴には極めて個人的な内容を含む可能性があります。何が送られるかを理解した上で有効化してください。

Amical を起動せずに wire protocol だけ確認したい場合はスモークテストスクリプトが使えます:

```bash
pnpm exec tsx scripts/mcp-smoketest.ts
# 別シェルで:
curl -s -X POST http://127.0.0.1:7878/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Roadmap（構想・未実装）

このフォークがこれからも探求していく方向です——いずれも オンデバイス／エージェント連携の AI:

- **履歴からの自動学習** — AI に文字起こし履歴を分析させ、誤変換した単語を検出して辞書へ自動登録。

## クレジット

Amical チーム（[amical.ai](https://amical.ai)）による **[Amical](https://github.com/amicalhq/amical)** を土台にしています。ベースアプリの功績はすべて彼らのものです。汎用的で幅広く動くアプリが欲しい場合は本家をどうぞ。

## ライセンス

MIT。本家 Amical に準拠。
