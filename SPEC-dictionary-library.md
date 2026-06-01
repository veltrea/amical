# SPEC: 辞書ライブラリ (Dictionary Library) — モデル B

**ステータス:** 設計確定 / 実装やり直し中
**派生元:** `develop` (HEAD = `55e7d4f` 時点)
**改訂理由:** 初版 (モデル A) は同梱辞書を `vocabulary` テーブルに展開する設計だったが、`vocabulary.word` の UNIQUE 制約と衝突し、「手動登録済みの単語と同じ辞書を有効化すると skip され、永久に未インストール表示のまま」という実害が出た。辞書の有効状態を**単語単位ではなく辞書単位**で持つモデル B に全面変更する。

---

## 0. モデル A がなぜ破綻したか (記録)

初版実装 (develop に merge 済み、commit `53276a8`〜`b3ba23d`) は:

- `vocabulary` に `source` (TEXT) と `isActive` (BOOLEAN) カラムを追加
- 「有効化」= 同梱辞書 JSON の entries を `vocabulary` に `source=library:<id>` タグ付きで insert (skip モード)
- カードの state = `vocabulary` の source 別集計から算出

**破綻:**

1. `vocabulary.word` は **UNIQUE**。1 単語 = 1 行 = 1 source しか持てない。
2. ユーザーが手動 import 済み (source=NULL) の単語と同じ辞書を「有効化」すると、skip モードで全部スキップ → `source=library:<id>` の行が 1 件も入らない → state が永久に `not-installed`。
3. 実 DB で確認: 681 行すべて source=NULL、`library:*` 行はゼロ。
4. 「所有権」問題: 同じ単語が手動と辞書のどちらに属すか、UNIQUE 制約下では表現不能。

**結論:** 同梱辞書を `vocabulary` に展開する設計が根本的に誤り。辞書は**束 (バンドル) のまま on/off** するべきで、単語テーブルに流し込んではいけない。

---

## 1. モデル B の核心

### 1.1 データの持ち方

| 層 | 何を持つ | どこに |
|---|---|---|
| 手動 vocabulary | ユーザーが手で追加 / import / 誤認識候補から登録した単語 | `vocabulary` テーブル (既存) |
| 同梱辞書の中身 | 分野別の単語リスト (read-only) | `apps/desktop/assets/dictionaries/*.json` (DB に展開しない) |
| 辞書の有効状態 | どの同梱辞書 id を有効にしたか **だけ** | `app_settings` の JSON カラム内 `activeDictionaries: string[]` |

**ポイント:** 同梱辞書の単語は **DB に一切入らない**。`vocabulary` テーブルは手動登録分だけのまま軽い。有効状態は辞書 id の配列 1 つ。

### 1.2 ASR パイプラインでの合成

ASR が vocabulary を読むとき (`transcription-service.ts`):

```
有効な語彙 = 手動 vocabulary (全件)
           ∪ 有効化された各辞書 JSON の entries
```

- 手動分は `getAllVocabulary()` で取得 (← `getActiveVocabulary()` から戻す)
- 有効辞書分は `activeDictionaries` の各 id について JSON を読み、entries を展開
- **重複は union 時に dedupe** (手動 "Twitter" と辞書 "Twitter" が両方あっても 1 つに)。手動分を優先 (ユーザーが置換先を設定している可能性があるため)

### 1.3 利点

- UNIQUE 制約との衝突が**構造的に発生しない** (辞書単語は DB に入らないので)
- 「有効化 / 無効化」= `activeDictionaries` 配列の 1 要素 add/remove = 一瞬。数千行の出し入れなし
- 削除/無効化で手動単語は**無傷**
- `vocabulary` テーブルが手動分だけで軽いまま (= ASR パイプラインの DB 負荷が辞書数に依存しない)
- 「アニメ実況の日だけアニメ辞書 on」がフラグ toggle で済む
- 同梱辞書 JSON は read-only 資産。ユーザーが個別 edit する想定をしない (= mixed 状態が消えてカード状態が active/inactive の 2 値に単純化)

---

## 2. データモデル

### 2.1 app_settings 拡張

`AppSettingsData` (`apps/desktop/src/db/schema.ts`) に追加 (mcpServer と同じ要領、**migration 不要** — JSON カラムへの追加):

```ts
export interface AppSettingsData {
  // ... 既存 (formatterConfig, mcpServer, ...)
  /** 有効化された同梱辞書の id リスト。例: ["services", "anime"] */
  activeDictionaries?: string[];
}
```

### 2.2 vocabulary テーブルの source / isActive カラム

モデル A で追加された `source` / `isActive` カラム (migration `0007_green_nova.sql`) は**モデル B では使わない**。

**方針: 残す (drop migration を新規に切らない)。**
- `source` カラム: 将来 MCP 経由の登録元タグ付け等に使える余地がある。NULL のまま放置。
- `isActive` カラム: 不要だが、drop には migration が要る。残しても害はない (常に true)。
- ただし **ASR パイプラインは `getActiveVocabulary()` をやめて `getAllVocabulary()` に戻す** (§5)。`isActive` でフィルタしない。

> 補足: もし将来クリーンにしたければ、別途 `0008` migration で 2 カラムを drop する。今回はスコープ外。

### 2.3 同梱辞書 JSON

モデル A から**変更なし**。`apps/desktop/assets/dictionaries/` の `index.json` + 各辞書ファイルをそのまま使う。`catalog.ts` の読み出しロジック (`readBundledIndex`, `readBundledDictionaryFile`) も再利用。

---

## 3. サービス層

### 3.1 残す (catalog.ts)

`apps/desktop/src/services/dictionary-library/catalog.ts`:
- `readBundledIndex()` — index.json を読む。**そのまま使う**
- `readBundledDictionaryFile(id)` — 個別辞書 JSON を読む。**そのまま使う**
- `librarySourceTag(id)` — モデル B では不要。削除可 (または残置)
- 型 `BundledDictionary`, `DictionaryEntry`, `DictionaryFile` — そのまま使う

### 3.2 作り直し (operations.ts)

`apps/desktop/src/services/dictionary-library/operations.ts` を全面書き換え:

```ts
// state は active / not-active の 2 値に単純化
export type DictionaryState = "active" | "inactive";

export interface DictionaryWithState extends BundledDictionary {
  state: DictionaryState;   // activeDictionaries に id が含まれるか
}

/** index.json の全辞書 + 各々の有効状態を返す */
export async function listBundledDictionariesWithState(): Promise<DictionaryWithState[]> {
  const [index, active] = await Promise.all([
    readBundledIndex(),
    getActiveDictionaryIds(),   // app_settings から
  ]);
  const activeSet = new Set(active);
  return index.dictionaries.map((meta) => ({
    ...meta,
    state: activeSet.has(meta.id) ? "active" : "inactive",
  }));
}

/** 辞書を有効化 = activeDictionaries に id を追加 */
export async function activateDictionary(id: string): Promise<void> {
  // id が実在する辞書か検証 (index.json にあるか) してから追加
}

/** 辞書を無効化 = activeDictionaries から id を削除 */
export async function deactivateDictionary(id: string): Promise<void>;

/**
 * 有効化された全辞書の entries を展開して返す。ASR パイプラインが
 * 手動 vocabulary と union するために使う。
 */
export async function getActiveDictionaryEntries(): Promise<DictionaryEntry[]> {
  const active = await getActiveDictionaryIds();
  const all: DictionaryEntry[] = [];
  for (const id of active) {
    try {
      const { file } = await readBundledDictionaryFile(id);
      all.push(...file.entries);
    } catch {
      // 辞書 id が index にあるが file が読めない場合はスキップ (ログ)
    }
  }
  return all;
}
```

### 3.3 app_settings アクセサ

`getActiveDictionaryIds()` / `setActiveDictionaryIds(ids)` を app-settings サービス経由で実装。既存の app_settings 読み書きパターン (`mcpServer` の取得方法) に倣う。

---

## 4. DB アクセサのロールバック

`apps/desktop/src/db/vocabulary.ts`:
- `getActiveVocabulary()` — **使わなくなる**。削除 or 残置 (transcription-service が呼ばなくなれば dead code)。
- `getVocabularySourceSummaries()` / `deleteVocabularyBySource()` / `setVocabularySourceActive()` — モデル A 専用。**削除**してよい (どこからも呼ばれなくなる)。ただし削除前に grep で参照ゼロを確認。
- `importVocabularyEntries(..., source?)` の `source` 引数 — import/export 機能 (手動) では NULL のまま使われる。**引数は残す** (将来用)。

---

## 5. ASR パイプライン変更

`apps/desktop/src/services/transcription-service.ts` の vocab 読み込み箇所 (現在 line 773 付近):

### 5.1 現状 (モデル A)

```ts
const vocabEntries = await getActiveVocabulary();
for (const entry of vocabEntries) {
  if (entry.isReplacement) {
    context.sharedData.replacements.set(entry.word, entry.replacementWord || "");
  }
}
context.sharedData.vocabulary.push(...selectVocabularyHints(vocabEntries));
```

### 5.2 モデル B

```ts
// 手動 vocabulary は全件。
const manualEntries = await getAllVocabulary();
// 有効化された辞書の entries を展開。
const dictEntries = await getActiveDictionaryEntries();

// 置換ルール: 手動分を先に入れる (ユーザー設定優先)。辞書分は word が
// まだ無いものだけ追加 (dedupe)。
const replacementSeen = new Set<string>();
for (const e of manualEntries) {
  if (e.isReplacement) {
    context.sharedData.replacements.set(e.word, e.replacementWord || "");
    replacementSeen.add(e.word);
  }
}
for (const e of dictEntries) {
  if (e.isReplacement && !replacementSeen.has(e.word)) {
    context.sharedData.replacements.set(e.word, e.replacementWord || "");
    replacementSeen.add(e.word);
  }
}

// LLM ヒント: 手動 + 辞書の非置換語を union して selectVocabularyHints に渡す。
// 型を合わせるため DictionaryEntry を Vocabulary 風に正規化するヘルパを用意。
const hintWords = selectVocabularyHintsFromMixed(manualEntries, dictEntries);
context.sharedData.vocabulary.push(...hintWords);
```

### 5.3 selectVocabularyHints の調整

`apps/desktop/src/utils/vocabulary-hints.ts`:
- 現在 `Vocabulary[]` を受け、非置換語を最新順で `MAX_VOCABULARY_HINTS` 件返す。
- モデル B では「手動 + 辞書」の混合を受ける必要がある。
- 新ヘルパ `selectVocabularyHintsFromMixed(manual: Vocabulary[], dict: DictionaryEntry[]): string[]`:
  - 非置換語だけ集める (手動 + 辞書)
  - 重複 word を dedupe
  - cap (MAX_VOCABULARY_HINTS) 適用
  - 既存の `selectVocabularyHints` は単体テストがあれば壊さない (signature 維持、新ヘルパを追加する形)

> **注意 (性能):** 辞書を大量に有効化すると hint が MAX_VOCABULARY_HINTS を超える。cap があるので prompt は bounded だが、「どの hint を優先するか」のランキングは将来課題 (現状は手動優先 + 残りを辞書から)。

---

## 6. tRPC API

`apps/desktop/src/trpc/routers/dictionary-library.ts` を作り直し:

```ts
export const dictionaryLibraryRouter = createRouter({
  // 全辞書 + 有効状態
  list: procedure.query(async () => listBundledDictionariesWithState()),

  // 有効化。tRPC 予約語回避のため activate という名前 (apply は NG)
  activateDictionary: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await activateDictionary(input.id);
      return { ok: true };
    }),

  // 無効化
  deactivateDictionary: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await deactivateDictionary(input.id);
      return { ok: true };
    }),
});
```

> **重要:** procedure 名に tRPC 予約語 (`apply` / `call` / `bind` / `toString` / ...) を使わない。モデル A で `apply` を使って main process が起動時クラッシュした (commit `55e7d4f` で修正済み)。

remove (完全削除) は不要になる: 辞書は DB に展開されないので「削除」概念がなく、無効化で十分。

---

## 7. UI

`apps/desktop/src/renderer/main/pages/settings/dictionary-library/index.tsx` を調整:

### 7.1 カード状態 (2 値に単純化)

| 状態 | 色 | アクション |
|---|---|---|
| `inactive` | デフォルト (border のみ) | 「有効化」ボタン → `activateDictionary` |
| `active` | アクティブカラー (塗りつぶし / border 強調) | 「無効化」ボタン → `deactivateDictionary` |

- `not-installed` / `mixed` 状態は廃止。
- 「削除 (🗑)」アクションは廃止 (無効化で代替)。
- entryCount は index.json の値をそのまま表示 (DB 集計が不要に)。

### 7.2 mutation 後の invalidate

`activateDictionary` / `deactivateDictionary` 成功後に `utils.dictionaryLibrary.list.invalidate()`。`vocabulary.getVocabulary.invalidate()` は**不要** (辞書は vocabulary テーブルを触らないので)。

### 7.3 i18n キーの調整

既存の `settings.dictionaryLibrary.*` キーから:
- `card.state.notInstalled` / `card.state.mixed` を削除 (or 未使用化)
- `card.action.delete` を削除
- `toast.removed` / `toast.applied` の文言を「有効化しました / 無効化しました」に統一 (`activated` / `deactivated` に寄せる)
- `confirmDelete.*` を削除

---

## 8. 実装ステップ (commit 単位)

各 commit の後で **必ず**:
1. `pnpm --filter @amical/desktop type:check`
2. `pnpm --filter @amical/desktop package` (build 通過 — ただし build 通過 ≠ 起動成功)
3. **節目で `scripts/install-dev.sh` で実際に起動**して、起動時クラッシュ (tRPC 予約語、初期化エラー) がないこと + 機能が動くことを確認。
   - 教訓: モデル A の `apply` クラッシュは build を通過し、起動して初めて発覚した。

### Commit 1: app_settings に activeDictionaries + アクセサ

- `AppSettingsData` に `activeDictionaries?: string[]`
- `getActiveDictionaryIds()` / `setActiveDictionaryIds()` を app-settings サービスに追加
- migration 不要
- type check + package

### Commit 2: operations.ts をモデル B に書き換え

- `listBundledDictionariesWithState` (active/inactive 2 値)
- `activateDictionary` / `deactivateDictionary`
- `getActiveDictionaryEntries`
- モデル A の `applyBundledDictionary` / `removeBundledDictionary` / `setBundledDictionaryActive` を削除
- type check + package

### Commit 3: tRPC router 作り直し

- `list` / `activateDictionary` / `deactivateDictionary`
- モデル A の `applyDictionary` / `remove` / `setActive` を削除
- type check + package

### Commit 4: ASR パイプライン合成

- `transcription-service.ts`: `getActiveVocabulary()` → `getAllVocabulary()` + `getActiveDictionaryEntries()` の union
- `vocabulary-hints.ts`: `selectVocabularyHintsFromMixed` 追加
- `db/vocabulary.ts`: モデル A 専用アクセサ (`getVocabularySourceSummaries` 等) を削除
- type check + package
- **install-dev.sh で起動確認** (ASR の vocab load が壊れていないこと)

### Commit 5: UI + i18n

- カードを active/inactive 2 値に
- delete アクション削除、状態色調整
- i18n キー整理 (en + ja)
- type check + package
- **install-dev.sh で起動 + 実機確認**:
  - 辞書カードの「有効化」→ 即座に「有効」表示 (DB 待ちなし)
  - 「無効化」→「未有効」表示
  - 有効化した辞書の単語が dictation で効く
  - 手動登録済みの単語と重複する辞書を有効化しても正しく「有効」表示される (モデル A の主バグが直っていること)

---

## 9. 動作確認 (Commit 5 後の受け入れ基準)

1. fresh な状態 (辞書未有効) でカードが全部「未有効 (inactive)」
2. 「サービス」カードの有効化 → 即「有効」表示 (手動 import 済みの単語と重複していても)
3. dictation で `Notion` 等が正しく変換される
4. 無効化 → カードが「未有効」に戻り、dictation で辞書語が効かなくなる (手動登録語は残る)
5. 複数辞書を同時有効化できる
6. アプリ再起動後も有効状態が保持される (app_settings 永続化)

---

## 10. モデル A 実装の撤去リスト

develop に merge 済みのモデル A から**消す / 変える**もの:

| 対象 | 処理 |
|---|---|
| `operations.ts` の apply/remove/setActive/source-based state | モデル B に書き換え |
| `db/vocabulary.ts` の `getVocabularySourceSummaries` / `deleteVocabularyBySource` / `setVocabularySourceActive` | 削除 (参照ゼロ確認後) |
| `db/vocabulary.ts` の `getActiveVocabulary` | 削除 or 残置 (transcription-service が呼ばなくなる) |
| `transcription-service.ts` の `getActiveVocabulary()` 呼び出し | `getAllVocabulary()` + 辞書 union に変更 |
| tRPC `applyDictionary` / `remove` / `setActive` | `activateDictionary` / `deactivateDictionary` に置換 |
| UI の not-installed/mixed 状態, delete アクション | 削除 |
| `vocabulary.source` / `isActive` カラム | 残置 (drop migration はスコープ外) |
| `catalog.ts` (JSON 読み出し) | **そのまま再利用** |
| `assets/dictionaries/*.json` | **そのまま再利用** |

---

## 11. 未決事項 (実装中にユーザーに確認)

1. `vocabulary.source` / `isActive` カラムを今 drop するか、残置か (現案: 残置)
2. 辞書 hint と手動 hint の優先順位 (現案: 手動優先 + 残りを辞書から、cap 適用)
3. デフォルトで有効化されている辞書はあるか (現案: 完全 opt-in、全部 inactive スタート)
4. 同じ単語が複数の有効辞書に出る場合の置換先の優先 (現案: 先に読んだ辞書 = activeDictionaries 配列の順)
