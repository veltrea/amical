# バンドル辞書 実機ロールアウト 実装計画書

> **この1枚で作業に入れる自己完結ドキュメント。** 目的: 2026-06-06 に追加した48辞書（計61辞書・
> 3239 置換エントリ）を、実機の Amical「辞書ライブラリ」で実際に有効化して音声入力に使える状態にする。
> データ追加・コミット・push は完了済み（origin/main）。本書は **実機検証** と **任意のUX改善** の計画。

## 0. 結論（先に読む）

**「使えるようにする」ために必須のコード実装は無い。** 追加した辞書は `assets/dictionaries/*.json` +
`index.json` のデータ追加だけで、既存の汎用実装が以下を全部やる:

- 辞書ライブラリ画面に **61辞書すべてを表示**（`list` が `index.json` を全件返す）
- カードの有効化ボタンで **有効化/無効化**（`activeDictionaries` に ID を出し入れするだけ）
- 音声入力時に **有効辞書を ASR パイプラインに union して適用**（置換 + 語彙ヒント）

→ 必要なのは **(A) ビルドして実機確認（必須）** と **(B) 61辞書規模に向けた検索UXの追加（任意）** のみ。

## 1. なぜ実装が要らないか（仕組みの確認）

| 機能 | 実装場所（触らない） | 挙動 |
|---|---|---|
| 一覧表示 | `renderer/.../dictionary-library/index.tsx` の `api.dictionaryLibrary.list` | catalog が `index.json` を全件読み、61辞書をカード表示 |
| カテゴリ絞り込み | 同 `FILTER_CATEGORIES`（all/general/developer/creator/professional） | `category` でフィルタ。新辞書は既存4カテゴリに収めてあるので全タブで出る |
| 有効化 | `services/dictionary-library/operations.ts` `activateDictionary` | `app_settings.activeDictionaries` に ID 追加（DBの語彙テーブルは触らない＝モデルB） |
| 適用 | `services/transcription-service.ts:830` 付近 | 有効辞書の置換を `word→replacementWord` の完全一致 Map に、登録語を LLM ヒントに |
| 配布同梱 | `forge.config.ts` `extraResource: "./assets"` | ディレクトリごと同梱。新ファイルは自動で `Resources/assets/dictionaries/` に入る |

**結論の裏付け**: 上記はすべて辞書 ID/ファイルに依存しない汎用実装。データを足した時点で機能する。

## 2. フェーズ1 — 実機検証（必須）

### 2.1 ビルド & 起動
CLAUDE.md / メモリの方針に従い **`scripts/install-dev.sh` のみ**で行う（配布シミュレーション）。
手動で `electron-forge` / `cp` / `open` をバラバラに打たない。

```bash
# Claude/CI など Automation 権限の無いシェルでは先にプロセスを落とす
pkill -f "/Applications/Amical.app/Contents/MacOS/Amical" || true
scripts/install-dev.sh
```

- 注意: `/Applications` へコピーするため **ad-hoc 署名アプリは cdHash 変化で TCC（マイク/アクセシビリティ）が
  silent revoke される**（トグル ON のまま無効）。これは一般ユーザーもアップデートで踏む既知現象。
  対処はシステム設定で Amical を **削除→再登録**（`tccutil reset` を手で乱発しない）。

### 2.2 確認項目（受け入れ基準）
1. 設定 → 辞書ライブラリ に **61辞書が表示**される（カテゴリタブ all で全件、各タブで分類表示）。
2. 代表辞書の **説明・件数（entryCount）・タグ**が正しい（例: GitHub & Git (English) = 119、Tech & AI Figures = 327）。
3. 任意の辞書を **有効化** → トグルが active になり、再起動後も維持される。
4. 有効化した辞書の語を音声入力し、**正しい表記に変換**される:
   - `github-git` 有効 → 「ぎっとこみっと」→ `git commit`
   - `tech-people` 有効 → 「さむあるとまん」→ `Sam Altman`
   - `cocktails` 有効 → 「モヒート」がカタカナ維持される
5. 複数辞書を同時有効化しても破綻しない（置換競合ゼロは検証済み）。

### 2.3 変換されない読みが出たら
辞書を**育てる**運用（最初から完璧を狙わない）。実際の ASR 出力（カタカナ優勢）を見て、
該当辞書の `entries` に読み（`word`）のゆれを 1 行足してコミット。表記が逆が良い語は
その 1 語の `replacementWord` だけ直す。

## 3. フェーズ2 — 61辞書規模のUX改善（任意・本家 renderer を変更）

61辞書あるとカテゴリタブ + グリッドだけでは探しにくい（`general` だけで20弱）。**検索ボックス**を足すと実用性が上がる。

> ⚠️ **fork 方針の判断ポイント**: これまで辞書追加は「データのみ・本家コード非接触」で upstream 追従を
> 守ってきた。検索UXは `renderer/.../dictionary-library/index.tsx` を**触る**ので、fork の独自拡張になる
> （upstream 追従時にこのファイルだけコンフリクトしうる）。**必須ではない**。やるなら最小差分で。

### 3.1 検索ボックス（最小実装案）
`index.tsx` に検索 state を足し、`filtered` に名前/タグのマッチを加えるだけ:

```tsx
const [search, setSearch] = useState("");

const filtered = useMemo(() => {
  let all = listQuery.data ?? [];
  if (filter !== "all") all = all.filter((d) => d.category === filter);
  const q = search.trim().toLowerCase();
  if (q) {
    all = all.filter(
      (d) =>
        localizedName(d, i18n.language).toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  return all;
}, [listQuery.data, filter, search, i18n.language]);
```

- カテゴリタブ行の上に `<Input value={search} onChange={...} placeholder={t("...search")} />` を1つ置く。
- i18n 文字列 `settings.dictionaryLibrary.search`（en/ja）を locale ファイルに追加。
- これだけで「ギター」「python」「whisky」等で即絞り込める。

### 3.2 任意の追加候補（やらなくてよい）
- カテゴリタブに件数バッジ（`general (20)`）。
- 「有効のみ表示」トグル。
- タグクリックで同タグ絞り込み。

## 4. リスク・注意

- **silent revoke**: §2.1 の通り。配布検証では意図的に踏み、削除→再登録で復旧確認する。
- **カタカナ表記の精度**: 一般的な表記を採用済み。実機の ASR 出力次第でゆれを足す前提（§2.3）。
- **検索実装（フェーズ2）**: 本家ファイルを触るため、`feat/dict-search` 等の小さな変更に留め、
  data 追加コミットとは分けてコミットする（追従時の切り分けのため）。

## 5. 作業ステップ（チェックリスト）

- [ ] フェーズ1: `pkill` → `scripts/install-dev.sh` でビルド・起動
- [ ] §2.2 の受け入れ基準1〜5を確認
- [ ] 変換漏れの読みがあれば該当辞書に追記してコミット
- [ ]（任意）フェーズ2: 検索ボックスを `index.tsx` に最小差分で追加 + i18n 文字列
- [ ]（任意）検索の動作確認 → `feat(dictionary-library): add search box` で別コミット

## 6. 関連ファイル

**データ（追加済み・触る対象外）**
- `apps/desktop/assets/dictionaries/index.json`（61辞書のメタデータ）
- `apps/desktop/assets/dictionaries/*.json`（各辞書本体）

**仕組み（読む・原則触らない）**
- `apps/desktop/src/services/dictionary-library/{catalog,operations}.ts`
- `apps/desktop/src/services/transcription-service.ts`（適用、830付近）
- `apps/desktop/src/renderer/main/pages/settings/dictionary-library/index.tsx`（フェーズ2でのみ触る）

**検証スクリプト**: 辞書間の置換競合 / entryCount 一致は `node` で検証（手順は
`~/.claude/.../memory/dictionary-library-authoring.md` 参照）。

---

**要約**: データは全部入っている。`scripts/install-dev.sh` でビルドして §2.2 を確認すれば「使える」。
検索UX（フェーズ2）は 61辞書を快適に扱うための任意の上積みで、やるなら fork 独自拡張として最小差分で。
