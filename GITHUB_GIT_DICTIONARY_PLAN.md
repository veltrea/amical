# GitHub / Git 辞書 追加 ハンドオーバー

> **この1枚で作業に入れる自己完結ドキュメント。** 目的: Amical の音声入力で、git コマンドと
> GitHub 用語（commit / rebase / Pull Request / コンフリクト 等）を正しい表記に変換できる
> 辞書を追加する。次のリリースの `feat` 候補。

## 0. 一行で言うと

`apps/desktop/assets/dictionaries/` に **`github-git.json` を1つ追加**し、**`index.json` に
メタデータ1ブロックを登録**するだけ。**本家のコード（サービス/ルーター/UI）は一切触らない＝データ追加のみ**
（fork の upstream 追従を壊さない）。fork.6 の専門辞書（医療・法律・会計・建設）と完全に同じ仕組み。

## 1. 辞書の仕組み（把握済み・確定事実）

### ディレクトリ
- データ: `apps/desktop/assets/dictionaries/*.json`
- 一覧管理: `apps/desktop/assets/dictionaries/index.json`
- 読む側（**触らない**）: `apps/desktop/src/services/dictionary-library/`、
  `apps/desktop/src/trpc/routers/dictionary-library.ts`、
  `apps/desktop/src/renderer/main/pages/settings/dictionary-library/`

### `index.json` のメタデータ形式（既存エントリに倣う）
```json
{
  "id": "github-git",
  "name": "GitHub & Git",
  "name_ja": "GitHub / Git",
  "description": "Git commands and GitHub terms (commit, rebase, pull request, merge conflict).",
  "description_ja": "git コマンドと GitHub 用語 (commit, rebase, Pull Request, コンフリクト 等)。",
  "category": "developer",
  "language": "ja",
  "tags": ["git", "github", "vcs"],
  "entryCount": <実際のエントリ数を入れる>,
  "file": "github-git.json"
}
```
- `category`: 既存の `programming` と同じ **"developer"** を使う（医療等は "professional"）。
- `entryCount`: **github-git.json の `entries` 配列の実数**を入れる（既存も実数。例: accounting=87相当）。

### 辞書本体の形式（`accounting.json` に倣う）
```json
{
  "version": 1,
  "exportedAt": "2026-06-06T00:00:00.000Z",
  "entries": [
    { "word": "git commit", "replacementWord": null, "isReplacement": false },
    { "word": "ぎっとこみっと", "replacementWord": "git commit", "isReplacement": true }
  ]
}
```
- **2種類のエントリ:**
  1. **登録語** (`isReplacement: false`, `replacementWord: null`): 正しい表記そのもの。
  2. **置換ルール** (`isReplacement: true`, `replacementWord: "正しい表記"`): 読み（誤変換されやすい音）→ 正しい表記。
- 既存辞書では「登録語 + その読みの置換ルール」をペアで並べるのが基本。読みの誤変換が起きにくい語は登録語のみでも可（accounting.json 後半に前例あり）。

## 2. 設計判断（決定済み — ユーザーに再確認しない）

- **【重要】1つの読みに対して、置換先は1つだけ。** 同じ `word`（例「こんふりくと」）に複数の
  `replacementWord`（`conflict` と `コンフリクト`）を登録しても、変換結果は1つに**競合して片方しか
  出ない**。だから「両方入れる」は機能しない（2026-06-06 にこの誤案を撤回）。各語、表記を1つに決める。
- **決め方:「その語をふだん日本語の文章で書くとき、どう書くか」に合わせる（Claude が機械的に判断。
  ユーザーに表記を聞かない）。**
  - git コマンド（`git commit` / `git push` / `rebase` / `cherry-pick` 等）→ **英語**（カタカナで書かないため）。
  - ふだんカタカナで書く概念語（コンフリクト / ブランチ / マージ / プルリク / リベース / スタッシュ / リポジトリ）→ **カタカナ**。
  - 英語のまま使う語（`HEAD` / `origin` / `main` / `upstream` / `PR` / `CI/CD`）→ **英語**。
  - 迷ったら英語を優先（開発者の慣習）。
- **運用: 完成した辞書を実際に試用し、「この語だけ逆の表記がいい」が出たら、その1語の `replacementWord`
  だけ直す。** 最初から完璧を狙わず、使いながら1語ずつ直せる前提で作る。
- **読み（`word` 側）は、日本語音声認識が実際に吐く形**を想定する。ひらがな主体（「ぎっとこみっと」
  「ぷるりくえすと」）。実際の Amical の認識結果を見て、カタカナ／空白有無のゆれを後で足す。
- **大文字小文字・記号**: `Pull Request`、`CI/CD`、`.gitignore` など、正しいケース／記号で登録。

## 3. 入れる語のリスト案（次セッションで JSON 化する種）

**git コマンド（登録語 + 読み置換）:**
git / git commit / git push / git pull / git fetch / git clone / git merge / git rebase /
git checkout / git switch / git branch / git stash / git cherry-pick / git reset / git revert /
git add / git status / git log / git diff / git remote / git tag / git init / git fetch /
git worktree / git submodule / git bisect / git reflog / git blame

**git 概念・操作:**
HEAD / origin / upstream / staging / staged / unstaged / working tree / index /
fast-forward / squash / amend / force push / detached HEAD / merge conflict / conflict /
コンフリクト / ブランチ / マージ / リベース / チェックアウト / プッシュ / プル / フェッチ / クローン / スタッシュ

**GitHub 用語:**
Pull Request / PR / Issue / Repository / repo / リポジトリ / Fork / フォーク / Star /
Watch / GitHub Actions / Workflow / CI/CD / review / approve / request changes / draft /
milestone / label / assignee / README / gist / organization / Codespaces / Copilot /
Dependabot / release / changelog

**読み→表記の例（置換ルールの具体）:**
| word（音声で入りがちな読み） | replacementWord（正しい表記） |
|---|---|
| ぎっとこみっと | git commit |
| ぎっとぷっしゅ | git push |
| ぷるりくえすと | Pull Request |
| ぷるりく | PR |
| りべーす | rebase |
| ちぇりーぴっく | cherry-pick |
| すたっしゅ | stash |
| ふぉーすぷっしゅ | force push |
| こんふりくと | コンフリクト |
| りぽじとり | リポジトリ |
| ふぉーく | フォーク |
| ぶらんち | ブランチ |
| ますたー / めいん | main |
| おりじん | origin |
| あっぷすとりーむ | upstream |

> 目安: 60〜120 エントリ程度（既存の professional 辞書と同水準）。多すぎず、開発で頻出する語に絞る。

## 4. 実装ステップ

1. `apps/desktop/assets/dictionaries/github-git.json` を新規作成（§1 の形式、§3 の語を JSON 化）。
2. `index.json` の `dictionaries` 配列に、§1 のメタデータブロックを追加（末尾でよい）。
3. `entryCount` を `github-git.json` の実エントリ数に合わせる。
4. JSON の妥当性確認: `node -e "JSON.parse(require('fs').readFileSync('apps/desktop/assets/dictionaries/github-git.json','utf8'))"` と同 index.json。

## 5. テスト・検証

1. `scripts/install-dev.sh` で起動（= 配布シミュレーション。CLAUDE.md / メモリ参照）。
2. 設定 → 辞書ライブラリ に **「GitHub / Git」が出る**こと、説明・件数が正しいことを確認。
3. 有効化 → 音声入力で「ぎっとこみっと」等を話し、**`git commit` に変換される**ことを確認。
4. 変換されない読みがあれば、実際の認識結果を `word` 側に足す（辞書を育てる）。

## 6. やってはいけないこと / 注意
- **本家のコード（services / routers / renderer）を触らない。** 追加は `assets/dictionaries/` の
  データ2ファイルのみ（github-git.json 新規 + index.json への1ブロック追記）。upstream 追従を守る。
- コミットメッセージに **AI 著作権表記を入れない**。英語で。例:
  `feat(dictionary-library): add GitHub/Git dictionary for voice input`
- 作業ブランチは **main**（develop は廃止）。push 先は origin（veltrea/amical）。
- 各 commit で `.app` ビルドを通す（データ追加なので壊れにくいが、JSON 構文エラーは要注意）。

## 7. 関連ファイル
**参考（読む・倣う）**
- `apps/desktop/assets/dictionaries/index.json`（メタデータの形）
- `apps/desktop/assets/dictionaries/accounting.json` / `programming.json`（エントリの形。programming は category=developer の前例）

**新規作成**
- `apps/desktop/assets/dictionaries/github-git.json`

**追記**
- `apps/desktop/assets/dictionaries/index.json`（dictionaries 配列に1ブロック）

**先行コミット参考**
- `ddd65b6 feat(dictionary-library): add professional dictionaries` … 専門辞書4本を足したときのコミット。同じ要領。
