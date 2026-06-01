# SPEC: 辞書ライブラリ (Dictionary Library)

**ステータス:** 設計のみ (未実装)
**派生元:** `develop` (旧 `feat/mlx-proofreading`、SPEC 着手時点 HEAD = `a3f2400`)
**着手:** 別セッションで並行開発予定
**並行する別 SPEC:** `SPEC-mcp-server.md`

---

## 1. 目的

ユーザーが分野別のプリセット辞書を **マトリックス UI から 1 click で有効化** できるようにする。アプリ同梱型 (アセット同梱) のため、ネット環境不要・ダウンロード処理不要・JSON 軽量 (数十 KB)。

「カスタム辞書登録は面倒」というハードルを、**「分野を選んで色を点灯」** で下げる。

### 1.1 解決したい課題

1. ASR が誤認識する固有名詞 (技術用語、企業名、サービス名、AI モデル名等) を、ユーザーが手で 1 件ずつ登録するのは現実的でない
2. 本家 Amical はカスタム辞書を奥まった設定に隠している = 機能の存在感が薄い
3. fork (veltrea/amical) は逆に **辞書を主役にする** ポジショニングを取る
4. ただし、辞書を増やしすぎると ASR パイプラインへの負荷が上がる → アクティブ/非アクティブ切替が必要

### 1.2 非目的

- 辞書コンテンツのオンライン更新 (将来検討、初回はアプリ同梱で十分)
- ユーザー投稿型辞書ライブラリ (将来検討)
- 辞書の差分インクリメンタル更新 (初回は丸ごと適用/削除)

---

## 2. データモデル

### 2.1 schema 改修

`vocabulary` テーブルに 2 カラム追加:

```ts
// apps/desktop/src/db/schema.ts
export const vocabulary = sqliteTable("vocabulary", {
  // ... 既存カラム
  source: text("source"),                              // どの辞書由来か。NULL = user-authored
  isActive: integer("is_active", { mode: "boolean" })  // ASR パイプラインで使うか
    .notNull()
    .default(true),
});
```

#### マイグレーション

`drizzle-kit generate` で `0008_*.sql` を自動生成:

```sql
ALTER TABLE `vocabulary` ADD `source` text;
ALTER TABLE `vocabulary` ADD `is_active` integer NOT NULL DEFAULT 1;
```

既存行は `source = NULL`, `isActive = TRUE` で migrate (= 既存ユーザーの環境を壊さない)。

### 2.2 source の値の規約

- `NULL` = user-authored (手動追加、誤認識候補から登録、import (mode: skip/overwrite) 経由)
- `"library:<dictionary-id>"` = 同梱辞書由来 (例: `"library:services"`, `"library:ai-companies"`)

prefix `library:` で「同梱辞書から来た行」を識別可能。将来 `"mcp:<source>"` 等の他経路も追加できる構造。

---

## 3. 同梱辞書ファイル

### 3.1 ディレクトリ構造

```
apps/desktop/assets/dictionaries/
├── index.json
├── services.json
├── ai-companies.json
├── ai-models.json
├── software.json
├── programming.json
├── anime-2026.json
├── light-novel-titles.json
├── cooking.json
└── ...
```

### 3.2 index.json

利用可能な辞書のメタ情報を列挙:

```json
{
  "version": 1,
  "dictionaries": [
    {
      "id": "services",
      "name": "Online Services",
      "name_ja": "オンラインサービス",
      "description": "Twitter, Notion, Slack, Spotify, etc.",
      "description_ja": "Twitter, Notion, Slack, Spotify など",
      "category": "general",
      "language": "ja",
      "tags": ["service", "social", "saas"],
      "entryCount": 100,
      "file": "services.json"
    }
  ]
}
```

#### category

- `"general"`: 全般 (サービス、AI企業、ソフトウェア)
- `"developer"`: 開発者向け (プログラミング、Git)
- `"creator"`: クリエイター向け (アニメ、ラノベ、料理)
- `"professional"`: 専門職 (医療、法律 - 将来)

UI ではこの category でフィルタ/グループ化。

### 3.3 個別辞書ファイル

既存の vocabulary export 形式と互換 (`importJson` がそのまま使える):

```json
{
  "version": 1,
  "exportedAt": "2026-06-01T00:00:00.000Z",
  "entries": [
    { "word": "Twitter", "replacementWord": null, "isReplacement": false },
    { "word": "ツイッター", "replacementWord": "Twitter", "isReplacement": true }
  ]
}
```

### 3.4 同梱方法 (forge.config)

`apps/desktop/forge.config.ts` の `extraResource` には既に `"./assets"` が含まれているため、**追加設定不要**。`assets/dictionaries/` を置けば自動的に `<App>.app/Contents/Resources/assets/dictionaries/` へコピーされる。

### 3.5 実行時パス解決

```ts
// apps/desktop/src/services/dictionary-library/paths.ts
import { app } from "electron";
import path from "node:path";

export function dictionariesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "dictionaries");
  }
  return path.join(app.getAppPath(), "assets", "dictionaries");
}
```

---

## 4. DB アクセサ

### 4.1 新規追加

`apps/desktop/src/db/vocabulary.ts`:

```ts
/** ASR パイプライン用: isActive=true の vocabulary だけ返す */
export async function getActiveVocabulary(): Promise<Vocabulary[]> {
  return await db.select().from(vocabulary).where(eq(vocabulary.isActive, true));
}

/** 設定画面で source タグ単位の集計を返す */
export interface VocabularySourceSummary {
  source: string;       // 例: "library:services"
  totalCount: number;   // その source の行数
  activeCount: number;  // その source のうち isActive=true
}
export async function getVocabularySourceSummaries(): Promise<VocabularySourceSummary[]>;

/** library:<id> の全行を delete (UI の「完全削除」用) */
export async function deleteVocabularyBySource(source: string): Promise<{ deleted: number }>;

/** library:<id> の全行を isActive で update */
export async function setVocabularySourceActive(
  source: string,
  isActive: boolean,
): Promise<{ updated: number }>;
```

### 4.2 既存 `importVocabularyEntries` の改修

`source` を受け取れるよう拡張:

```ts
export async function importVocabularyEntries(
  entries: VocabularyImportEntry[],
  mode: "skip" | "overwrite",
  source: string | null = null,   // ← 追加
): Promise<VocabularyImportResult>;
```

- `source` が指定された場合、新規 insert 時に source カラムにその値をセット
- 既存 export/import (UI 経由) は `source = null` のまま

---

## 5. ASR パイプライン変更

### 5.1 修正対象

[`apps/desktop/src/services/transcription-service.ts:772`](apps/desktop/src/services/transcription-service.ts:772) で `getAllVocabulary()` を呼んでいる。これを `getActiveVocabulary()` に差し替える。

```diff
- const vocabEntries = await getAllVocabulary();
+ const vocabEntries = await getActiveVocabulary();
```

影響範囲:
- 置換 (isReplacement) → `isActive=false` の置換ルールは適用されない
- 非置換 (LLM hint) → `isActive=false` のヒントは LLM に渡されない

### 5.2 既存 `getAllVocabulary` の用途

- export 機能 (`vocabulary.exportAll`): 全件 (active/inactive 両方) を返す現状維持
- 設定画面の vocabulary 一覧 (`vocabulary.getVocabulary`): 全件返す現状維持 + active フィルタオプション追加

→ `getAllVocabulary` は削除しない、`getActiveVocabulary` を新規追加するパターン。

---

## 6. tRPC API

### 6.1 新規 router: `dictionaryLibrary`

`apps/desktop/src/trpc/routers/dictionary-library.ts`:

```ts
export const dictionaryLibraryRouter = createRouter({
  // index.json + 各辞書の installation/active 状態を返す
  list: procedure.query(async () => {
    return await listBundledDictionariesWithState();
  }),

  // 適用 (= source タグ付きで bulk_add、mode: "skip")
  // NB: procedure 名を `apply` にしない。tRPC は Function.prototype の名前
  // (apply/call/bind/...) を予約語として弾く ("Reserved words used in
  // `router({})` call: apply" で main process が即クラッシュする)。
  applyDictionary: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return await applyBundledDictionary(input.id);
    }),

  // 完全削除 (DELETE WHERE source = library:<id>)
  remove: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return await removeBundledDictionary(input.id);
    }),

  // isActive を切り替え (UPDATE WHERE source = library:<id>)
  setActive: procedure
    .input(z.object({ id: z.string(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      return await setBundledDictionaryActive(input.id, input.isActive);
    }),
});
```

### 6.2 戻り値の型 (`list` query)

```ts
interface DictionaryWithState {
  id: string;
  name: string;
  name_ja?: string;
  description: string;
  description_ja?: string;
  category: string;
  language: string;
  tags: string[];
  entryCount: number;
  state: "not-installed" | "active" | "inactive";  // 現在のインストール状態
  installedEntries?: number;                        // installed の場合、実際に入った件数 (skip でスキップされた分があるので index.entryCount と一致しない可能性)
}
```

---

## 7. UI 設計

### 7.1 ルート

新規ページ: `apps/desktop/src/renderer/main/pages/settings/dictionary-library/index.tsx`
ルート: `apps/desktop/src/renderer/main/routes/_app/settings/dictionary-library.tsx`
`settings-navigation.ts` で「カスタム辞書」の隣に「辞書ライブラリ」を追加。

### 7.2 レイアウト (ASCII ワイヤフレーム)

```
┌─────────────────────────────────────────────────────────┐
│ 辞書ライブラリ                                            │
│ 分野別のプリセット辞書を 1 click で有効化できます。       │
│                                                         │
│ [すべて] [一般] [開発者] [クリエイター]                  │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │ サービス  │ │ AI 企業  │ │ プログラム│ │ アニメ    │    │
│ │ 100 件    │ │  76 件   │ │ 198 件   │ │  60 件    │    │
│ │ 一般      │ │ 一般     │ │ 開発者   │ │ クリエイター│    │
│ │           │ │          │ │          │ │           │    │
│ │ [有効化]  │ │ [有効]✓ │ │ [無効]  │ │ [有効化]  │    │
│ │           │ │  色変化  │ │  グレー  │ │           │    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│                                                         │
│ ┌──────────┐ ...                                        │
│ │ ラノベ    │                                            │
│ │  ...      │                                            │
│ └──────────┘                                            │
└─────────────────────────────────────────────────────────┘
```

### 7.3 カードの状態

| 状態 | 色 | アクション |
|---|---|---|
| `not-installed` | デフォルト (border のみ) | 「有効化」ボタン → `apply` |
| `active` | アクティブカラー (primary, 塗りつぶし or border 強調) | 「無効化」ボタン → `setActive(false)` 、「削除」アイコン → `remove` |
| `inactive` | グレーアウト | 「有効化」ボタン → `setActive(true)`、「削除」アイコン → `remove` |

「適用 (有効化)」と「アクティブ化」を分けない: `not-installed` → `apply` (= bulk_add + isActive=true)、その後は `setActive(true/false)` でトグル。

### 7.4 インタラクション

- カード全体をクリック可能領域に (チェックマークではなくタイル全体タップで状態変化)
- 複数選択モード (`Cmd-Click` or 「複数選択」モードボタン) → 一括有効化
- ホバーで詳細 (entries の最初の 5 件プレビュー)
- カテゴリフィルタタブで絞り込み

### 7.5 i18n キー (en + ja)

```
settings.dictionaryLibrary.title
settings.dictionaryLibrary.description
settings.dictionaryLibrary.filter.all
settings.dictionaryLibrary.filter.general
settings.dictionaryLibrary.filter.developer
settings.dictionaryLibrary.filter.creator
settings.dictionaryLibrary.card.entryCount   ({{count}} 件)
settings.dictionaryLibrary.card.state.notInstalled
settings.dictionaryLibrary.card.state.active
settings.dictionaryLibrary.card.state.inactive
settings.dictionaryLibrary.card.action.activate    // 有効化
settings.dictionaryLibrary.card.action.deactivate  // 無効化
settings.dictionaryLibrary.card.action.delete      // 完全削除
settings.dictionaryLibrary.toast.applied
settings.dictionaryLibrary.toast.removed
settings.dictionaryLibrary.toast.activated
settings.dictionaryLibrary.toast.deactivated
settings.dictionaryLibrary.toast.failed
settings.dictionaryLibrary.confirmDelete.title
settings.dictionaryLibrary.confirmDelete.message    // この辞書由来の {{count}} 件をすべて削除します。
```

---

## 8. 実装ステップ (5 commit)

各 commit の後で **必ず `scripts/install-dev.sh` で .app build 検証**。型 check 通過は build 通過ではない。

### Commit 1: schema migration

- `vocabulary` に `source` + `isActive` カラム追加
- `pnpm db:generate` で migration ファイル生成
- 既存行はデフォルト値で migrate
- type check + .app build 検証

### Commit 2: ASR パイプラインを isActive フィルタに切り替え

- `getActiveVocabulary()` を `db/vocabulary.ts` に追加
- `transcription-service.ts` の `getAllVocabulary()` → `getActiveVocabulary()` 差し替え
- 既存 export / 設定画面用 `getAllVocabulary()` は無変更
- .app build 検証 + 動作確認 (既存環境が壊れていないこと)

### Commit 3: 同梱辞書ファイル + DB アクセサ + tRPC

- `apps/desktop/assets/dictionaries/index.json` + 最初の 4 ファイル (services, ai-companies, software, programming) を配置 (今のセッションで Claude が `/Users/user/Downloads/` に書いた 4 ファイルを使う、リポジトリにコピー)
- `db/vocabulary.ts` に新規アクセサ (getVocabularySourceSummaries, deleteVocabularyBySource, setVocabularySourceActive, importVocabularyEntries に source 引数追加)
- `services/dictionary-library/` ディレクトリ作成、index.json 読み出しロジック + apply/remove/setActive 実装
- `trpc/routers/dictionary-library.ts` 新規
- root tRPC router (`apps/desktop/src/trpc/router.ts`) に `dictionaryLibrary` を mount

### Commit 4: UI

- 設定 navigation に「辞書ライブラリ」追加
- 新規ページ + route
- マトリックスレイアウト (Card grid)
- アクティブカラー / 状態切替
- カテゴリフィルタ
- i18n キー (en + ja)
- .app build 検証 (UI の見た目をユーザーが install-dev.sh で確認)

### Commit 5: 追加コンテンツ

- アニメ、ライトノベル、料理、釣り 等の分野別辞書 JSON を追加
- 各辞書は Claude (別セッション or 同セッション) が JSON 生成 → assets/dictionaries/ に配置
- index.json 更新

---

## 9. 動作確認手順 (各 commit で)

```bash
# 1. 型チェック
pnpm --filter @amical/desktop type:check

# 2. .app build + install + 起動
scripts/install-dev.sh

# 3. ユーザーが手動で確認:
# - 設定 > 辞書ライブラリ ページを開く
# - カードのグリッド表示
# - 「有効化」 → アクティブカラーになる
# - 「無効化」 → グレーアウト
# - 「削除」 → カードが 「未インストール」 に戻る
# - dictation 実行 → 有効な辞書由来の単語が ASR / LLM hint に反映される
```

---

## 10. リスクと既知の論点

### 10.1 性能 (vocabulary 件数増加)

辞書を 10〜20 個入れると vocabulary テーブルが数千〜数万行になる。`getActiveVocabulary` は全件読み込みなので、件数増加で遅くなる可能性。

対策の選択肢 (後で必要に応じて):
- index を `is_active` に追加
- 結果を transcription-service 側でキャッシュ (vocabulary 更新時に invalidate)
- 「全部有効化」を UI で防ぐ (ユーザーが必要なものだけ選ぶ運用を促す)

### 10.2 source タグの衝突

`source = "library:services"` で適用された行を、ユーザーが UI で手動 edit したらどうする?
- 案 A: 編集時に source を NULL に変える (= 「user-authored 扱い」に移管)
- 案 B: source を保持する (= 同梱辞書を「個別 customize した状態」として持つ)

実装最初は **案 B** (シンプル)、edit UI で「customize した」マーク表示。将来要望次第で A に変更。

### 10.3 同梱辞書の更新

アプリのバージョンアップで同梱辞書の内容を更新する場合、既にユーザーが「有効化」してインストール済みの行はどうする?
- 案 A: 既存 source の行を全削除 → 新内容で再 import (ユーザーの edit が消える)
- 案 B: 既存は維持、新規 entry だけ追加 (skip モード)
- 案 C: アプリ起動時に index.json の version を見て「更新あり」を表示、ユーザーが手動で「更新」ボタン

実装最初は **更新を扱わない** (アプリリリース時に同梱内容を変える前提で、ユーザー側は「削除 → 再適用」を選択)。将来要望次第。

### 10.4 言語タグ

`index.json` の `language` フィールド。今は `ja` 中心だが、将来英語ユーザーや中国語ユーザーへの対応。
- UI 側で「アプリ表示言語と一致する辞書」をデフォルト表示 + 「他言語の辞書も表示」トグル

---

## 11. 未決事項 (実装中にユーザーに確認)

1. `index.json` の category 一覧の最終形 (`general` / `developer` / `creator` / `professional` 以外?)
2. 「複数選択 → 一括有効化」モードを最初から実装するか、後回しか
3. カードのデザイン (色、サイズ、アイコン使用) — Amical 既存の design system に合わせる
4. 同梱辞書の更新ポリシー (アプリリリース時)
5. デフォルトで有効化されている辞書はあるか、それとも完全に opt-in か (現案: 完全 opt-in)
