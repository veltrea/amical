# 辞書ライブラリ エディタ — 実装計画書

**ステータス:** 計画承認済み（2026-06-07）／実装中
**ブランチ:** `main`（push 先 `origin` = veltrea/amical）

## Context（なぜ・何を）

Amical のバンドル辞書ライブラリ（`apps/desktop/assets/dictionaries/` の 61 辞書）は、現状
UI から **有効/無効トグルとカテゴリフィルタしかできず、中身（登録語）が一切見えない**。各辞書の
エントリは件数（`entryCount`）しか表示されない。ユーザー（＝開発者本人）は 61 辞書を手書き
JSON で育てており（`node` で competing/dup 検証 → コミット）、その作業を **GUI 化**したい。

**確定方針（ユーザーに確認済み）:**
1. **対象 = 開発者向け辞書オーサリング。** dev ビルドで `assets/dictionaries/*.json` を**直接
   書き換え**、次のリリースに含める。一般配布版（packaged の `Resources/assets`）は **read-only
   なので閲覧のみ**。
2. **スコープ = 最大。** ①各辞書のエントリ一覧（閲覧）②エントリ CRUD ③辞書メタデータ編集
   ④新規辞書の作成（＋対称性のため削除）。手書き JSON 作業を丸ごと GUI に置き換える。

設計仕様書 [`SPEC-dictionary-library.md`](SPEC-dictionary-library.md) §1.3 は「同梱辞書 JSON は
read-only 資産。ユーザーが個別 edit する想定をしない」と書くが、これは**エンドユーザー前提**の
記述。本計画は**開発者が dev ビルドで辞書を編集する**用途であり、ASR 合成・有効/無効モデル B の
設計（辞書を束のまま on/off）は一切変えない。閲覧・編集は別系統として上に載せる。

---

## アーキテクチャ概要

```
[レンダラー] 詳細/編集ページ ──tRPC──> [メイン] authoring.ts ──> serialize.ts(純関数)
   一覧 → カードクリック → /settings/dictionary-library/$id        ──> fs.writeFile(assets)
                                          │                         ──> catalog キャッシュ無効化
                                  editable() = !app.isPackaged       (packaged は assertEditable で throw)
```

- **閲覧**（read）は全ビルドで動く（既存 `readBundledDictionaryFile` 再利用）。
- **編集**（write）は dev 限定。`app.isPackaged` を見て、packaged では tRPC が throw、UI も非表示。
- **正しさの核** = 整形維持シリアライザと CRUD ロジックを**純関数**に切り出し、vitest で固定。

---

## 1. サービス層（メインプロセス）

### 1.1 新規 `services/dictionary-library/serialize.ts`（純関数・fs 非依存）

既存 JSON の**整形を完全維持**するのが最重要（git で辞書管理 → 整形が崩れると全行 diff になり
手作業メンテと混ざる）。既存整形は `JSON.stringify(obj, null, 2)` では再現できない独自形式：

- 辞書ファイル: `entries` の各要素が**1 行** → `{ "word": "減価償却", "replacementWord": null, "isReplacement": false },`
- index.json: 各辞書ブロックは 2 スペース展開だが **`tags` 配列だけ 1 行** → `"tags": ["service", "social", "saas"],`

専用フォーマッタを実装（フィールド順序固定: 辞書ファイルは word→replacementWord→isReplacement、
index は id→name→name_ja→description→description_ja→category→language→tags→entryCount→file）：

```ts
function formatEntry(e: DictionaryEntry): string {
  return `{ "word": ${JSON.stringify(e.word)}, "replacementWord": ${JSON.stringify(e.replacementWord)}, "isReplacement": ${JSON.stringify(e.isReplacement)} }`;
}
export function serializeDictionaryFile(file: DictionaryFile): string { /* ヘッダ + entries を join */ }
export function serializeIndex(index: BundledDictionaryIndex): string { /* tags 1 行 */ }
```

純粋な変換関数も同居（index 操作）:
- `upsertIndexEntry(index, meta)` / `removeIndexEntry(index, id)` / `setEntryCount(index, id, n)`
- エントリ CRUD: `addEntry(entries, e)` / `updateEntry(entries, originalWord, e)` / `removeEntry(entries, word)`
  （キー = `word`。辞書内 word 一意を前提。重複時は先頭一致を更新／要 vitest ケース）

### 1.2 新規 `services/dictionary-library/authoring.ts`（fs I/O ＋ dev ガード）

```ts
export function assertEditable(): void {            // packaged なら throw
  if (app.isPackaged) throw new Error("Dictionary editing is only available in development builds.");
}
export async function writeDictionaryEntries(id, entries) { assertEditable(); /* serialize → writeFile → index の entryCount 更新 → キャッシュ無効化 */ }
export async function createDictionary(meta, entries = []) { assertEditable(); /* 新ファイル + upsertIndexEntry */ }
export async function updateDictionaryMeta(id, patch)      { assertEditable(); /* index 更新（id 変更は別ファイル名 rename を含むので当面 id 不変） */ }
export async function removeDictionary(id)                 { assertEditable(); /* ファイル削除 + removeIndexEntry + activeDictionaries から掃除 */ }
```

書き込みパスは既存 `dictionariesDir()` をそのまま使う（dev = `app.getAppPath()/assets/dictionaries`
＝ソースツリー、packaged = `Resources`＝書かせない）。書き込みは temp ファイル → rename の
アトミック書き込み。

### 1.3 `catalog.ts` を最小改変

- `cachedIndex` はプロセス内キャッシュ。**書き込み後に無効化**が必要 → `export function invalidateIndexCache()` を追加（`cachedIndex = null`）。authoring の各 write が末尾で呼ぶ。
- 既存 `readBundledIndex` / `readBundledDictionaryFile` / 型はそのまま再利用。

---

## 2. tRPC（`trpc/routers/dictionary-library.ts` 拡張）

既存 `list` / `activateDictionary` / `deactivateDictionary` に追加（**予約語回避**: apply/call/bind/delete を避け、下記名にする）：

| 手続き | 種別 | ビルド | 用途 |
|---|---|---|---|
| `getEntries` | query `{id}` | 全 | 閲覧。`{meta, entries}` を返す（`readBundledDictionaryFile`） |
| `editable` | query | 全 | `!app.isPackaged` を返す。UI の編集出し分け用 |
| `addEntry` | mutation `{id, entry}` | dev | エントリ追加（即保存） |
| `updateEntry` | mutation `{id, originalWord, entry}` | dev | エントリ編集 |
| `deleteEntry` | mutation `{id, word}` | dev | エントリ削除 |
| `updateMeta` | mutation `{id, patch}` | dev | メタ編集 |
| `createDictionary` | mutation `{meta}` | dev | 新規辞書 |
| `removeDictionary` | mutation `{id}` | dev | 辞書削除 |

dev mutation は内部で `assertEditable()` を通す（UI を騙しても二重防御）。エントリ編集は
**個別即保存**（vocabulary の UX と一致、ローカル一括 state を持たない）。

---

## 3. レンダラー UI

### 3.1 一覧画面拡張 `pages/settings/dictionary-library/index.tsx`

- 各カードを**クリックで詳細へ遷移**（`useNavigate` → `/settings/dictionary-library/$id`）。
  既存の有効/無効トグルボタンは `stopPropagation` でカード遷移と分離。
- `editable` query が true（dev）のとき、ヘッダーに**「新規辞書を作成」**ボタン → メタ入力ダイアログ。

### 3.2 新規 詳細・編集ページ

- ルート: `routes/_app/settings/dictionary-library.$dictionaryId.tsx`（`notes.$noteId.tsx`
  と同型。`Route.useParams()` で id 取得。**routeTree.gen.ts は自動生成**＝手編集不要）。
- ページ実装: `pages/settings/dictionary-library/detail.tsx`
  - `getEntries(id)` でメタ＋エントリ取得。
  - メタ表示（dev なら「メタを編集」ボタン → メタ編集ダイアログ）。
  - エントリ一覧（検索付きリスト。`word → replacementWord` 表示は vocabulary の行 UI を流用）。
  - dev なら各行に編集/削除、ヘッダー（`settings-header-actions-context`）に「語を追加」。
  - packaged（`editable=false`）なら read-only＋注記「編集は開発ビルドのみ」。
  - 戻る導線（一覧へ）。

### 3.3 ダイアログ（dev）

- **エントリ追加/編集**: `VocabularyDialog`（[vocabulary/index.tsx:90](apps/desktop/src/renderer/main/pages/settings/vocabulary/index.tsx:90)）が
  ほぼそのまま使える（isReplacement トグル＋word/replacementWord 入力）。共通コンポーネント
  `components/entry-dialog.tsx` に抽出して両方から使う。
- **メタ編集／新規作成**: name・name_ja・description・description_ja・category（既存 4 つ
  general/developer/creator/professional のセレクト）・language（既定 ja）・tags（カンマ区切り）。

### 3.4 `getPageTitle` 修正 `routes/_app/route.tsx`

`pathname.startsWith("/settings/dictionary-library")` → `"Dictionary Library"` を追加
（動的セグメント対応。既存の未登録もれも同時に解消）。

---

## 4. i18n（`i18n/locales/{ja,en}.json` 必須、de/es/zh-TW は英語フォールバック許容）

`settings.dictionaryLibrary.*` に追記（既存構造 [ja.json:1124](apps/desktop/src/i18n/locales/ja.json:1124)）：
- `detail.*`（戻る・列見出し・検索・空・メタラベル）
- `editor.*`（追加/編集/削除ダイアログ、保存、新規辞書フォーム、削除確認）
- `readOnlyNote`（packaged 時の注記）

---

## 5. 実装ステップ（コミット単位・各コミットで `type:check` + `test`）

1. **純関数（serialize + CRUD ロジック）+ vitest** — fs/UI 非依存。最もテスタブルな核を先に。
   `tests/utils/dictionary-serialize.test.ts`：**既存 61 辞書をラウンドトリップ**（read → parse →
   serialize が元と一致）で整形維持を保証。CRUD・entryCount 整合・index upsert/remove も網羅。
2. **authoring.ts（fs I/O + dev ガード）+ catalog キャッシュ無効化。**
3. **tRPC 拡張**（getEntries/editable/編集系）。
4. **閲覧 UI**（詳細ページ + ルート + 一覧からの導線 + getPageTitle）。read-only で先に動く。
   → **install-dev.sh（packaged）で閲覧を実機確認可**。
5. **編集 UI**（エントリ CRUD ダイアログ・メタ編集・新規作成・dev 出し分け）+ i18n。

---

## 6. 検証戦略（重要：編集は packaged で確認できない制約）

1. **vitest（主軸）**: `pnpm --filter @amical/desktop test`。整形ラウンドトリップ・CRUD・
   entryCount 整合を純関数で網羅。`tsc --noEmit` で型。← ユーザーの「テスタビリティ最優先／
   ロジックを純関数化して vitest」方針に合致。
2. **閲覧画面**: `scripts/install-dev.sh`（＝配布シミュレーション・packaged）で確認できる
   （`getEntries` は read なので packaged でも動く）。
3. **編集画面**: packaged は assets が read-only なので**原理的に install-dev.sh では確認不可**。
   実機 UI 確認には dev 起動（`electron-forge start`）が要る。これは CLAUDE.md／メモリの
   「動作確認は install-dev.sh 一本／start 廃止」と**構造的に衝突する**。
   → **本計画ではロジックを vitest で厚く担保**し、編集 UI の実機確認をどうするか（dev 起動を
   この機能に限り例外的に使う か、閲覧だけ install-dev.sh で見て編集はコードレビュー＋vitest で
   足切る か）は**実装入り口でユーザーに判断を仰ぐ**。勝手に start を常用しない。

---

## 7. 影響ファイル

**新規**
- `apps/desktop/src/services/dictionary-library/serialize.ts`（純関数）
- `apps/desktop/src/services/dictionary-library/authoring.ts`（fs I/O + dev ガード）
- `apps/desktop/src/renderer/main/routes/_app/settings/dictionary-library.$dictionaryId.tsx`
- `apps/desktop/src/renderer/main/pages/settings/dictionary-library/detail.tsx`
- `apps/desktop/src/renderer/main/pages/settings/dictionary-library/components/entry-dialog.tsx`
- `apps/desktop/src/renderer/main/pages/settings/dictionary-library/components/dictionary-meta-dialog.tsx`
- `apps/desktop/tests/utils/dictionary-serialize.test.ts`（ほか CRUD テスト）

**変更**
- `services/dictionary-library/catalog.ts`（`invalidateIndexCache` 追加）
- `services/dictionary-library/index.ts`（re-export）
- `trpc/routers/dictionary-library.ts`（手続き追加）
- `pages/settings/dictionary-library/index.tsx`（詳細導線 + 新規作成ボタン）
- `routes/_app/route.tsx`（getPageTitle）
- `i18n/locales/{ja,en,de,es,zh-TW}.json`（キー追加）
- `routeTree.gen.ts`（**自動生成**・手編集しない）

---

## 8. 未決・リスク（実装中に確認）

1. **編集 UI の実機確認手段**（§6）。install-dev.sh では packaged のため編集不可 ← 最重要。
2. **serialize の既存完全一致**: 手書きのゆらぎで一部ファイルがラウンドトリップ不一致の可能性。
   不一致は「初回 GUI 編集時に正規化」を許容するか、既存に厳密一致させるか（diff 最小化のため
   できる限り一致を目指す。vitest が検出する）。
3. **辞書削除（removeDictionary）**: 新規作成と対称で含める前提。`activeDictionaries` からの掃除も。
4. **word 一意の前提**: 更新/削除キーが word。辞書内重複時の挙動を vitest で固定。
5. **id 変更**: メタ編集での id 変更はファイル名 rename を伴うため当面**不可**（id 不変）。
6. **本家追従**: 本計画は本家コード（services/routers/renderer）に触れる＝ fork 独自機能。
   GITHUB_GIT_DICTIONARY_PLAN の「データのみ追加」方針とは別物（あれは辞書追加タスク）。fork を
   独自プロダクトとして育てる方針に沿う。コミットは英語・AI 著作権表記なし・push 先 origin。
