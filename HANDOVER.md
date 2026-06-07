# HANDOVER — MLX オンデバイス校正エンジン

次セッションはまずこのファイルを読むこと。`feat/mlx-proofreading` ブランチ。

## push 先（事実・必ず守る）
- origin   = https://github.com/veltrea/amical    ← 「push して」= ここ
- upstream = https://github.com/amicalhq/amical   ← 本家(fork元)。明示指示が無い限り push しない
- push 先を `gh auth status` 等の権限で判断しないこと（origin で確定済み）。

## 現状
ブランチ `feat/mlx-proofreading` を origin に push 済み（2 コミット: 2fbf4e3 本体 / e4716db 言語対応）。
型チェック通過。helper 単体での日本語校正は実機実証済み。コミットに AI 著作権表記を入れない。

## 完了済み
- stt-helper(Swift): LLM RPC loadLLM/unloadLLM/generate。ASR と LLM を同一プロセスで直列共有。
  Package.swift に mlx-swift-lm の MLXLLM(汎用 HF ローダー)+ speech-swift の Qwen3Chat を追加。
  mlx-swift は speech-swift 共有の 0.31.3（整合実証済み）。
- MlxFormatter(TS): qwen3-helper-client を統一クライアント化。
- model-service/trpc: おすすめ + 任意 HF repo の DL/削除/一覧。メモリ戦略 balanced/fast/low。
- 言語別おすすめ（constants/mlx-llm-models.ts, languages タグ, UI に言語バッジ）:
  ja=LFM2.5-1.2B-JP(第一・中国語混入なし・実機実証), Llama-3.1-Swallow-8B / en=Phi-4-mini,Llama-3.2-3B / zh=Qwen2.5-3B
- 言語別 few-shot 例（formatter-prompt.ts の UNIVERSAL_EXAMPLES_BY_LANG[ja]）。
  dictation 言語を formatter へ伝播（transcription-service.formatterLanguage → FormatParams.context.language）。

## 将来タスク（実機テスト中に出た改善案）

1. **MLX モデル DL 直後の自動デフォルト化**
   - 現状: モデルをダウンロードしても formatter のデフォルトモデルには勝手にならない。
     ユーザーが手動で formatter 設定で選ぶ必要がある。
   - 提案: ダウンロード直後に「インストール済み MLX 言語モデルがそれ 1 つだけ」の
     場合は自動でデフォルトに昇格させる。複数あるときは触らない（ユーザー選択優先）。
   - 関連: `apps/desktop/src/trpc/routers/models.ts` の `downloadMlxLlm` 系
     mutation の onSuccess、または `model-service` 側で SyncedModelsList 更新時に
     `setDefaultLanguageModel` を呼ぶ。

## 残タスク
1. ~~B方式: ユーザーが校正指示を環境設定に書けるように。~~ 完了。
   - FormatterConfig.userInstructions を追加（db schema / zod / 型）。
   - FormattingSettings.tsx に Textarea を追加（dictation 設定画面の formattingEnabled 内）。
   - hook の spread 保存に直し、mlxMemoryStrategy/userInstructions が他コントロールで消えないように。
   - core の system prompt に独立した "User Preferences" ブロックとして注入。
     CRITICAL RULES の下、few-shot 例の上に挿入し、安全ルールが優先されることを明記。
2. ~~buildFormattingPrompt の純粋分離。~~ 完了。
   - `formatter-prompt-core.ts` 新規（electron / `@amical/types` / pipeline-types 依存ゼロ）。
   - `formatter-prompt.ts` は薄ラッパー（detectApplicationType と constructFormatterPrompt）。
   - 実証: `npx tsx -e "import('./src/pipeline/providers/formatting/formatter-prompt-core')..."`
     で systemPrompt 生成できることを確認（length 4646、JA few-shot と User Preferences 含む）。
3. 実アプリ確認: `pnpm start` で日本語ディクテーション→校正（LFM2.5-JP 選択）。Electron 起動なので
   画面は AI から見えない。ユーザーの画面で確認する。
   - 確認項目: フォーマット設定画面に textarea が出ること、入力→保存→再オープンで保持されること、
     校正結果に user instructions が反映されること（例: 「です・ます調で出力」を入れて口語入力）。

## 重要ファイル
- packages/native-helpers/stt-helper/Sources/stt-helper/main.swift（LLM RPC）
- packages/native-helpers/stt-helper/Package.swift（mlx-swift-lm 依存）
- apps/desktop/src/pipeline/providers/transcription/qwen3-helper-client.ts（統一クライアント）
- apps/desktop/src/pipeline/providers/formatting/formatter-prompt-core.ts（**純粋**、tsx で単体実行可）
- apps/desktop/src/pipeline/providers/formatting/formatter-prompt.ts（electron 依存の薄ラッパー）
- apps/desktop/src/pipeline/providers/formatting/mlx-formatter.ts
- apps/desktop/src/renderer/main/pages/settings/dictation/{components/FormattingSettings.tsx,hooks/use-formatting-settings.ts}
- apps/desktop/src/constants/mlx-llm-models.ts
- apps/desktop/src/services/{model-service,transcription-service}.ts

## 注意・テスト
- 外部ボリューム(/Volumes)から helper 起動で MLX/Metal ハング → stageHelperIfExternal が内部ディスクへコピー。
- helper 単体テスト: .build/debug/stt-helper を /tmp/stt-helper-test にコピーし JSON-RPC を stdin へ流す。
- 型チェック: `pnpm --filter @amical/desktop type:check`。校正は temperature 0.1。
  小型モデルは few-shot 例が無いと素通し（日本語例で改善を実機確認）。

## 未解決のメタ問題（重要）
- `~/.claude/projects/-Volumes-2TB-USB-dev-amical/memory/MEMORY.md` に前セッションが書き込んだが、
  これが Claude Code 公式機能なのか、ユーザー自作のメモリ系(local-mem 等)なのか未確定のまま書いた。
  新セッションで読まれなかった。ユーザー指示があるまで MEMORY.md を勝手に使わないこと。
- ブログ記事ドラフトあり（「AI には判断させず事実を渡す」/ システムプロンプトは push の"タイミング"だけ
  指示し"push 先の決め方"は無指示 → その空白で AI が権限ベースの危険判断をした、という構造）。要修正反映。
