# SPEC — 誤認識候補プール（Misrecognition Candidates）

ブランチ: `feat/misrecognition-candidates`（main から派生 / 別ワークツリーで作業）
依存: なし（`feat/mlx-proofreading` とは独立。MLX 機能の有無に関わらず動く）

---

## 1. 目的と非目的

### 目的
- 過去の dictation 履歴(`transcriptions.text`)から「誤認識っぽい単語」を**機械的に抽出**し、ユーザーが**手入力で正解を紐付ける**ことで `vocabulary` の `isReplacement` 行を育てる作業を補助する。
- **辞書(vocabulary) には自動登録しない**。リアルタイム動作を壊さない。
- 同じ読みの揺れ（例: `アミカル / あみかる / アミ狩る`）を**まとめて1つの正解に畳む**操作を一発で済ませる。

### 非目的
- AI による「正解の自動推定」はしない（誤った正解で辞書を汚染するリスクを避けるため）。
- ユーザーが外部アプリで手修正したテキストの監視はしない（別軸）。
- `transcriptions` テーブルへの `raw_text` カラム追加はしない（既存 `text` のみで成立する設計にする）。

---

## 2. データモデル

### 新テーブル `misrecognition_candidates`

```ts
export const misrecognitionCandidates = sqliteTable("misrecognition_candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  word: text("word").notNull().unique(),           // 抽出された候補単語そのまま
  normalizedKey: text("normalized_key").notNull(), // 揺れマッチ用キー(後述: ひらがな化+音素近似)
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
  dismissedAt: integer("dismissed_at", { mode: "timestamp" }),
  lastScanTranscriptionId: integer("last_scan_transcription_id"), // 増分スキャン用カーソル
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
// index: normalizedKey, dismissed, occurrenceCount
```

### 新メタテーブル `misrecognition_scan_state`（単一行）
- `lastScannedTranscriptionId: integer` — 前回スキャン済みの最大 transcription id
- 増分スキャンでこの id より大きい行だけを処理する。
- 初回は 0 から始める。

### 既存 `vocabulary` は変更なし
- 「正解を入れて登録」アクションは既存の `createVocabularyWord({ word, isReplacement: true, replacementWord })` を呼ぶだけ。
- `word` = 誤認識（履歴に出てきた表記） / `replacementWord` = ユーザー入力の正解。

### マイグレーション
- `apps/desktop/src/db/migrations/0006_misrecognition_candidates.sql` を `drizzle-kit generate` で生成。

---

## 3. 抽出アルゴリズム（v1）

LLM は使わない。**ルール + 統計**で出す。誤検出は多めに出して、ユーザーがゴミ箱で消す前提。

### 入力
- 増分: `transcriptions` の `id > lastScannedTranscriptionId` の `text` をすべて。
- 全件再スキャン UI も用意（`lastScannedTranscriptionId` を 0 にリセット）。

### トークナイズ
- 文字種で分割（日本語専用 v1）:
  - **カタカナ連結**(`[゠-ヿー]+`)
  - **ひらがな連結**(`[぀-ゟー]+`)
  - **漢字+送り**(`[一-鿿]+[぀-ゟ]*`)
  - **英字連結**(`[A-Za-z][A-Za-z0-9]*`)
- 1文字トークン、句読点、数字単独は捨てる。
- 既存 `vocabulary.word` / `vocabulary.replacementWord` に**完全一致するトークンは除外**（既に扱い済み）。

### 候補スコアリング（v1 は単純にルール和）

トークンが**少なくとも1つ**満たせば候補入り:

1. **カタカナ揺れ**: 同じ `normalizedKey`（後述）を持つカタカナトークンが履歴全体で2種類以上存在し、かつそれらが互いに編集距離 ≤ 2。
2. **低頻度カタカナ/英字**: 全履歴で 1〜3 回だけ出現、かつ長さ ≥ 3。
3. **混在断片**: トークン内に英字と日本語が混ざる（`Apple果物` のような OCR ライクな破綻）。
4. **既存 vocabulary とのニアミス**: ある vocabulary 行と編集距離 1（同じ読みの誤変換が混じってる可能性）。

各候補に「ヒットしたルール」をデバッグ用にログ出力（UI には出さない、まず動かしてから判断）。

### `normalizedKey` の作り方
- カタカナ → ひらがな化
- 長音記号 `ー` → 直前の母音に展開 (`コーヒー` → `こおひい`)
- 小書きカナ → 通常カナ
- 濁点/半濁点を剥がす（`バス` ≡ `パス` ≡ `はす`）※過剰マッチ気味だが、揺れまとめの操作性優先
- 英字は lowercase そのまま

これで「アミカル / あみかる / アミ狩る」が同じキーに寄る。

### 出力
- 候補ごとに `misrecognition_candidates` に upsert（既存なら `occurrenceCount` 加算、`lastSeenAt` 更新）。
- `dismissed=true` の行は upsert しない（再浮上禁止）。

---

## 4. tRPC API

新ルーター `misrecognitionRouter` を `apps/desktop/src/trpc/routers/misrecognition.ts` に追加し、`router.ts` で `misrecognition: misrecognitionRouter` として公開。

```ts
listCandidates({
  limit?: number,
  offset?: number,
  sortBy?: "occurrenceCount" | "lastSeenAt" | "word",
  sortOrder?: "asc" | "desc",
  groupByNormalizedKey?: boolean, // true: 同読みグループを1行に集約して返す
}): Candidate[] | CandidateGroup[]

countCandidates(): number

dismissCandidate({ id }): void          // 1行ゴミ箱
dismissCandidates({ ids }): void        // 複数ゴミ箱

registerCandidate({                     // 1候補 → vocabulary 登録 + 候補削除
  id, replacementWord: string
}): void

bulkRegisterCandidates({                // 複数候補を同じ正解で一括登録
  ids: number[], replacementWord: string
}): { registered: number, skipped: number }

scanNow({ fullRescan?: boolean }): {    // 手動スキャン
  scannedTranscriptions: number,
  newCandidates: number,
  updatedCandidates: number,
}

getScanStatus(): { lastScannedTranscriptionId, lastScanAt, isRunning }
```

スキャンは tRPC 呼び出し内で同期実行（v1）。履歴件数が大きくなったら worker thread / background queue 化を検討（v2）。

---

## 5. 画面（renderer）

### ルート
- `apps/desktop/src/renderer/main/routes/_app/settings/misrecognition.tsx`（新規）
- `apps/desktop/src/renderer/main/pages/settings/misrecognition/index.tsx`（新規 — 実体）
- `settings-navigation.ts` に「誤認識候補」(`Misrecognition Candidates`) を vocabulary の隣に追加。
- ルートツリー再生成: `pnpm --filter @amical/desktop dev:routes` 相当（既存の生成手順に従う）。

### レイアウト（テキストワイヤ）

```
┌──────────────────────────────────────────────────────────────┐
│ 誤認識候補                                                    │
│ 履歴から自動抽出した「誤認識かも」な単語です。正解を入力すると │
│ 辞書(置換)に登録されます。リアルタイムには反映されません。     │
│                                                              │
│ [ 🔄 スキャン ] [ 🔁 全件再スキャン ]   最終: 2026-05-31 10:00│
│                                                              │
│ [ ☑ 全選択 ] [ 同読みでグループ化 ☐ ]  [ 選択削除 🗑 ]        │
│                                                [ 選択を一括登録 ] │
│ ┌──┬───────────────┬────────┬─────────────┬───────┬────────┐ │
│ │☐ │ アミカル(12)  │ 同読み │ [正解入力__]│ [登録]│ 🗑     │ │
│ │☐ │ あみかる (3)  │  ↑同   │ [正解入力__]│ [登録]│ 🗑     │ │
│ │☐ │ アミ狩る (1)  │  ↑同   │ [正解入力__]│ [登録]│ 🗑     │ │
│ │☐ │ コーヒ (5)    │        │ [正解入力__]│ [登録]│ 🗑     │ │
│ └──┴───────────────┴────────┴─────────────┴───────┴────────┘ │
│ ページネーション (50件/ページ)                                │
└──────────────────────────────────────────────────────────────┘
```

### 「選択を一括登録」モーダル
- 選択中の候補リストを表示（全部同じ正解で登録します の警告つき）
- 正解単語の入力欄 1個（空欄不可、トリム）
- 「登録」ボタンで `bulkRegisterCandidates` 呼び出し → 成功したら候補テーブルからは消える

### 「同読みでグループ化」トグル
- ON にすると `normalizedKey` ごとに行が畳まれる（`アミカル / あみかる / アミ狩る` が1行）
- グループ行の正解入力欄に 1 回入れて「登録」すると、グループの全候補が同じ正解で `vocabulary` 行になる。
- これが**一番使う操作**になる想定なのでデフォルト ON で検討（ユーザーフィードバック次第）。

### バリデーション
- 正解の文字列が空・記号のみは登録不可。
- 正解と候補(word)が完全一致なら登録不可（意味がない）。
- 既存 vocabulary.word と同じ word を登録しようとしたらサーバ側で 409 を返し、トーストで通知。

---

## 6. i18n

`apps/desktop/src/i18n/locales/{en,ja}/settings.json` 等に以下キーを追加（実際のファイル構成は既存に従う）:

- `settings.misrecognition.title`
- `settings.misrecognition.description`
- `settings.misrecognition.scan` / `scanAll`
- `settings.misrecognition.groupByReading`
- `settings.misrecognition.replacementPlaceholder`
- `settings.misrecognition.register` / `bulkRegister` / `dismiss` / `dismissSelected`
- `settings.misrecognition.empty`（候補なし）
- `settings.misrecognition.scanResult`（スキャン結果トースト）
- 各種エラー / 確認ダイアログ文言

---

## 7. 実装手順（このまま順に進める）

1. **ワークツリー作成**
   ```bash
   git worktree add -b feat/misrecognition-candidates ../amical-misrec main
   cd ../amical-misrec
   pnpm install
   cp /Volumes/DISK/dev/amical/SPEC-misrecognition.md ./SPEC-misrecognition.md
   ```
2. **DB スキーマ** — `schema.ts` 追記 → `pnpm --filter @amical/desktop db:generate` でマイグレーション生成
3. **抽出ロジック** — `apps/desktop/src/services/misrecognition-scanner.ts` 新規
   - `tsx` で単体実行できる純粋な関数として書く（DB アクセスはインターフェース注入）
   - `normalizedKey` と `tokenize` を単体テスト可能に
4. **DB アクセサ** — `apps/desktop/src/db/misrecognition.ts` 新規
5. **tRPC ルーター** — `routers/misrecognition.ts` 新規 + `router.ts` 編集
6. **設定ナビ + ルート + ページ** — 上記ファイル群を追加
7. **i18n キー追加**
8. **型チェック** — `pnpm --filter @amical/desktop type:check`
9. **実機確認** — `scripts/dev.sh` で起動して、履歴がある状態で「スキャン」→ 候補表示 → 1件登録 → vocabulary 画面で確認
10. **コミット** — 機能単位に分割（schema / scanner / trpc / ui / i18n の 5 コミット程度）
11. **push** — `git push -u origin feat/misrecognition-candidates`（origin = veltrea/amical）

---

## 8. オープン質問（実装前に決めたい）

1. **「同読みでグループ化」のデフォルト**: ON / OFF どっち?（推奨: ON）
2. **濁点を剥がす正規化**: やる / やらない（推奨: やる。`バス↔パス` が同読みになるが操作性優先）。気になるなら v2 でトグル化。
3. **スキャン対象期間**: 全履歴 / 直近 N 日 のみ?（推奨: v1 は全履歴、件数が増えたら直近 90 日とかに絞る）
4. **MLX 校正ブランチへの依存**: なし(独立)で OK ですよね?（推奨: 独立。main から派生）
5. **「全選択」の対象**: 表示中ページのみ / 全候補(数百件)?（推奨: 表示中ページのみ。誤爆防止）

---

## 9. やらないこと（v2 以降に回す）

- 英語履歴の揺れ検出（小文字化と stemming くらいは要るが v1 はカタカナ揺れ優先）
- 中国語履歴の処理
- スキャンのバックグラウンド実行（v1 は手動ボタン）
- 候補に対する「これは正常」ホワイトリスト（dismiss で代用）
- transcriptions への raw_text カラム追加
