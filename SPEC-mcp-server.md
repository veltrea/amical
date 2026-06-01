# SPEC: Amical MCP サーバー

**ステータス:** 設計のみ (未実装)
**派生元:** `feat/mlx-proofreading` (HEAD = `a3f2400` 時点)
**着手:** 別セッションで並行開発予定
**並行する別 SPEC:** `SPEC-dictionary-library.md`

---

## 1. 目的

Amical 内に **HTTP MCP サーバー**を立て、Claude (Claude Code / Claude Desktop) が tool 経由で Amical の vocabulary・履歴・候補プールを直接読み書きできるようにする。

### 1.1 解決したい課題

1. 「Claude に JSON 作ってもらって、ユーザーが手で Amical の UI から import」というワークフローの中継ステップを省略する
2. 辞書整理 (重複削除、表記揺れマージ、カテゴリ整理) を Claude セッションで完結させる
3. 「最近の発話履歴から誤変換っぽいのを拾って辞書登録」を Claude に丸投げできるようにする
4. フロンティアモデル (Claude) はローカル MLX より精度高いので、辞書登録ロジックを LLM 側に外出しできる

### 1.2 想定するユーザー操作フロー

ユーザーが Claude Code セッションで:

```
ユーザー: 「Amical の最新 20 件の発話を取って、誤認識っぽいの拾って辞書に登録して」

Claude:
  mcp__amical__transcriptions_recent({ limit: 20 })  → text[] 取得
  内容分析 → 誤認識ペア抽出
  mcp__amical__vocabulary_bulk_add({ entries: [...], mode: "skip" })  → 登録

ユーザー: 「次の dictation でちゃんと効いてるか教えて」
```

### 1.3 非目的

- Claude 以外の MCP クライアント対応 (汎用性は副次的)
- transcription のリアルタイムストリーミング (将来検討)
- vocabulary の trigger イベント通知 (Resource / Subscription、将来検討)
- ユーザー認証 (シングルユーザー前提、token のみ)

---

## 2. アーキテクチャ概要

```
┌──────────────────────────────┐
│  Claude Code / Desktop       │
│  (MCP client)                │
└──────────┬───────────────────┘
           │ HTTP /mcp (Streamable HTTP)
           │ Authorization: Bearer <token>
           ▼
┌──────────────────────────────┐
│  Amical (Electron)           │
│  ┌────────────────────────┐  │
│  │  HTTP server           │  │
│  │  127.0.0.1:<port>      │  │
│  │  Node http or Express  │  │
│  └────────┬───────────────┘  │
│           │                  │
│  ┌────────▼───────────────┐  │
│  │  NodeStreamableHTTP-   │  │
│  │  ServerTransport       │  │
│  └────────┬───────────────┘  │
│           │                  │
│  ┌────────▼───────────────┐  │
│  │  McpServer             │  │
│  │  - vocabulary_*        │  │
│  │  - transcriptions_*    │  │
│  │  - misrec_candidates_* │  │
│  └────────┬───────────────┘  │
│           │                  │
│  ┌────────▼───────────────┐  │
│  │  既存 DB アクセサ        │  │
│  │  (db/vocabulary.ts 等)  │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

---

## 3. Transport

### 3.1 採用: Streamable HTTP (公式 SDK の最新方式)

`@modelcontextprotocol/sdk` の `NodeStreamableHTTPServerTransport` を使う。Node 標準の `http` モジュールで HTTP サーバーをホスト。Express は使わない (依存最小化)。

### 3.2 サンプルコード骨格

```ts
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/node-streamable-http.js";

const server = new McpServer({ name: "amical", version: "1.0.0" });

// tool 登録は §6 を参照
server.registerTool("vocabulary_list", { ... }, async (input) => { ... });

const http = createServer(async (req, res) => {
  // ① 認証チェック
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${currentToken}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  // ② MCP 用エンドポイントだけ受ける
  if (req.url !== "/mcp") {
    res.statusCode = 404;
    res.end();
    return;
  }
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,  // ステートレス: リクエストごとに新規セッション
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

http.listen(port, "127.0.0.1");  // ← loopback only
```

### 3.3 stdio transport は採用しない

理由:
- Amical は常駐 Electron アプリ。子プロセスとして起動される stdio 方式と相性が悪い
- グローバル CLAUDE.md にあった「stdio transport で Content-Length ヘッダーを付けない」罠を回避できる (HTTP では関係ない)
- ユーザーは複数の Claude セッションから同時接続したい可能性がある (stdio は 1:1)

---

## 4. ライフサイクル

### 4.1 起動

- Amical のメインプロセス起動時、設定で「MCP サーバー有効化」が ON なら自動起動
- 設定 OFF なら起動しない (デフォルト OFF — opt-in)
- 起動失敗時 (ポート占有等) はトーストで通知、リトライ可能

### 4.2 停止

- アプリ終了時 (`app.before-quit`) に MCP サーバーを stop (graceful shutdown)
- 設定で OFF に切り替えた時にも stop

### 4.3 再起動

- ポート変更 / token regenerate 時は stop → start

### 4.4 同時接続

- ステートレス HTTP のため、複数クライアントからの同時接続は問題ない (各リクエストごとに transport を新規作成)

---

## 5. 認証

### 5.1 方式: Bearer トークン

- Amical 起動時にランダム token を生成 (32 文字 URL-safe base64 程度)
- 設定画面でユーザーに表示 (コピペで取れる、目視できる入力欄)
- 「Regenerate Token」ボタンで再生成可能 (= 既存接続は無効化)
- ヘッダー `Authorization: Bearer <token>` で検証
- トークンの永続化は不要 (アプリ起動ごとに変えても良い) — ただし UX のため app_settings に保存 (再生成しない限り同じ)

### 5.2 ローカルバインドのみ

- `http.listen(port, "127.0.0.1")` で **loopback のみ**
- LAN / Wi-Fi 経由のアクセスは不可能
- 同マシンの他ユーザー (multi-user macOS) からはアクセス可 → token があれば。逆に token なしなら 401
- ファイアウォール透過の設定は不要

### 5.3 セキュリティ上の補足

- token は app_settings の JSON カラム内に平文保存 (Keychain は将来検討)
- HTTPS は採用しない (loopback only のため平文 OK)
- レートリミットは初回実装では入れない (将来 abuse 検出があれば追加)

---

## 6. MCP Tools 仕様

### 6.1 vocabulary 系

#### `vocabulary_list`

```yaml
description: "List vocabulary entries with optional search/filter. Returns full vocabulary rows."
inputSchema:
  search: string?         # word の部分一致 (LIKE %search%)
  source: string?         # "library:services" 等で絞り込み、"user" で source=NULL のみ
  isActive: boolean?      # 省略時は全件、true/false で絞り込み
  limit: number?          # default 100, max 500
  offset: number?         # default 0
output:
  entries: Array<{
    id: number
    word: string
    replacementWord: string | null
    isReplacement: boolean
    source: string | null
    isActive: boolean
    dateAdded: string  // ISO
    usageCount: number
  }>
  total: number
```

#### `vocabulary_add`

```yaml
description: "Add a single vocabulary entry. Returns the inserted row. Fails on duplicate `word`."
inputSchema:
  word: string                    # required
  replacementWord: string?        # 置換先
  isReplacement: boolean?         # default false
output:
  entry: Vocabulary
```

#### `vocabulary_update`

```yaml
description: "Update an existing vocabulary entry by id."
inputSchema:
  id: number
  word: string?
  replacementWord: string | null?
  isReplacement: boolean?
  isActive: boolean?
output:
  entry: Vocabulary
```

#### `vocabulary_delete`

```yaml
description: "Delete a single vocabulary entry by id."
inputSchema:
  id: number
output:
  deleted: number   # 0 or 1
```

#### `vocabulary_bulk_add`

```yaml
description: "Add many vocabulary entries at once with skip/overwrite duplicate handling. Reuses the existing importVocabularyEntries DB layer."
inputSchema:
  entries: Array<{
    word: string
    replacementWord: string | null?
    isReplacement: boolean?
  }>                           # max 5000 per call
  mode: "skip" | "overwrite"   # required
  source: string?              # 例: "mcp:claude-2026-06-01" など、後で識別したいなら
output:
  inserted: number
  updated: number
  skipped: Array<ImportEntry>
```

#### `vocabulary_search`

```yaml
description: "Find vocabulary entries matching a word (lowercase exact or prefix)."
inputSchema:
  word: string                   # 完全一致 (lowercase)
  prefix: boolean?               # default false; true なら前方一致 LIKE
output:
  entries: Array<Vocabulary>
```

### 6.2 transcriptions 系

#### `transcriptions_recent`

```yaml
description: "Return the most recent transcription rows, optionally since a timestamp."
inputSchema:
  limit: number?      # default 20, max 200
  since: string?      # ISO timestamp; この時刻より新しい行のみ
output:
  rows: Array<{
    id: number
    text: string
    timestamp: string     # ISO
    language: string | null
    detectedLanguage: string | null
    confidence: number | null
    duration: number | null
    speechModel: string | null
    formattingModel: string | null
  }>
```

#### `transcriptions_search`

```yaml
description: "Search transcription text by substring."
inputSchema:
  query: string
  limit: number?      # default 50, max 500
output:
  rows: Array<Transcription>
```

### 6.3 misrecognition_candidates 系 (v1 既存実装用)

> 注: feat/mlx-proofreading に v1 の検出器実装は残っている (本家由来)。それを操作する tool。

#### `misrec_candidates_list`

```yaml
description: "List active misrecognition candidates from the pool."
inputSchema:
  limit: number?       # default 100
  offset: number?
  sortBy: "occurrenceCount" | "lastSeenAt" | "word"?
output:
  candidates: Array<{ id, word, normalizedKey, occurrenceCount, lastSeenAt }>
```

#### `misrec_candidates_register`

```yaml
description: "Register a misrecognition candidate as a vocabulary replacement and remove the candidate row."
inputSchema:
  id: number
  replacementWord: string
output:
  registered: number
```

#### `misrec_candidates_dismiss`

```yaml
description: "Dismiss candidates so they don't resurface."
inputSchema:
  ids: number[]
output:
  dismissed: number
```

---

## 7. 設定画面

### 7.1 ルート

新規ページ: `apps/desktop/src/renderer/main/pages/settings/mcp-server/index.tsx`
ルート: `apps/desktop/src/renderer/main/routes/_app/settings/mcp-server.tsx`
`settings-navigation.ts` に「MCP サーバー」を追加 (Advanced 系の隣)。

### 7.2 レイアウト (ASCII ワイヤフレーム)

```
┌─────────────────────────────────────────────────────────────┐
│ MCP サーバー                                                  │
│ Claude などの外部 LLM から Amical の辞書・履歴を操作できます。│
│                                                             │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ ⚠ 注意:                                                │  │
│ │ MCP サーバーを有効化すると、辞書・発話履歴・候補プールを│  │
│ │ 接続したクライアント (Claude 等) が読み書きできます。   │  │
│ │ 発話履歴には個人的な内容を含む可能性があります。       │  │
│ └───────────────────────────────────────────────────────┘  │
│                                                             │
│ [ ⚪ 有効化  →  🔘 有効化 ]                                  │
│                                                             │
│ 接続情報 (Claude Code に設定するもの)                        │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ URL:    http://127.0.0.1:7878/mcp                     │  │
│ │ Token:  ●●●●●●●●●●●●●●●●●● [👁 表示] [📋 コピー]      │  │
│ └───────────────────────────────────────────────────────┘  │
│                                                             │
│ [ 🔄 トークン再生成 ] [ ⚙ ポート変更 ]                       │
│                                                             │
│ Claude Code の設定例:                                        │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ claude mcp add amical --transport http \              │  │
│ │   --url http://127.0.0.1:7878/mcp \                   │  │
│ │   --header "Authorization: Bearer <ここに token>"     │  │
│ └───────────────────────────────────────────────────────┘  │
│ [ 📋 コピー ]                                                │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 i18n キー

```
settings.mcpServer.title
settings.mcpServer.description
settings.mcpServer.warning              # ⚠ ブロックの本文
settings.mcpServer.enable               # 有効化トグル
settings.mcpServer.status.enabled       # 動作中
settings.mcpServer.status.disabled      # 停止中
settings.mcpServer.status.error
settings.mcpServer.connection.url
settings.mcpServer.connection.token
settings.mcpServer.connection.showToken
settings.mcpServer.connection.copyToken
settings.mcpServer.action.regenerateToken
settings.mcpServer.action.changePort
settings.mcpServer.claudeCodeExample
settings.mcpServer.toast.tokenRegenerated
settings.mcpServer.toast.copied
settings.mcpServer.toast.startFailed
```

---

## 8. データモデル

### 8.1 app_settings 拡張

`AppSettingsData` (`apps/desktop/src/db/schema.ts`) に追加:

```ts
export interface AppSettingsData {
  // ... 既存
  mcpServer?: {
    enabled: boolean;          // default false
    port: number;              // default 7878
    token: string;             // ランダム生成された Bearer token
    bindAddress: "127.0.0.1";  // 将来拡張用、現状固定
  };
}
```

migration 不要 (JSON カラムへの追加なので)。

### 8.2 初期化

アプリ初回起動時に `mcpServer` が undefined なら、token のみ生成して `enabled: false` で保存。「有効化」を押した時にサーバー起動。

---

## 9. 実装ステップ (5〜6 commit)

各 commit の後で **必ず `scripts/install-dev.sh` で .app build 検証**。

### Commit 1: 依存追加 + lifecycle スケルトン

- `pnpm add @modelcontextprotocol/sdk` を `apps/desktop` に
- `apps/desktop/src/services/mcp-server/server.ts` を新規作成 (start / stop / regenerate メソッド、最初は tool ゼロで「サーバー起動できる」だけ確認)
- メインプロセスの app lifecycle hook で start/stop を仕込む
- app_settings に `mcpServer` セクション追加
- token 生成ユーティリティ (`crypto.randomBytes(24).toString("base64url")`)
- 認証ミドルウェア (Bearer token チェック)
- type check + .app build 検証

### Commit 2: vocabulary 系 tool

- `apps/desktop/src/services/mcp-server/tools/vocabulary.ts` を作成
- vocabulary_list / add / update / delete / bulk_add / search の 6 tool 登録
- 既存 `db/vocabulary.ts` のアクセサを再利用
- input schema は Zod (MCP SDK と互換)
- 動作確認: install-dev.sh で .app 起動 → curl で /mcp に直接打って tool list が見えるか

### Commit 3: transcriptions 系 tool

- `tools/transcriptions.ts` 作成
- transcriptions_recent / search の 2 tool
- 既存 `db/transcriptions.ts` のアクセサを使う (なければ新規追加)

### Commit 4: misrec_candidates 系 tool

- `tools/misrec-candidates.ts` 作成
- list / register / dismiss の 3 tool
- 既存 `db/misrecognition.ts` のアクセサを使う

### Commit 5: 設定画面 UI

- `apps/desktop/src/renderer/main/pages/settings/mcp-server/index.tsx` 新規
- ルート + navigation 追加
- enable toggle、port input、token 表示/コピー/再生成、Claude Code 設定例
- tRPC procedure (start/stop/regenerate/getConfig) を `apps/desktop/src/trpc/routers/mcp-server.ts` で公開
- i18n キー (en + ja)

### Commit 6 (optional): 統合テスト + ドキュメント

- README に「MCP サーバーを使う」セクション追加
- 簡単な動作確認スクリプト (`scripts/mcp-smoketest.ts`) — Amical 起動後に curl で各 tool を叩く

---

## 10. 動作確認手順

### 10.1 アプリ側

```bash
scripts/install-dev.sh
# Amical 起動 → 設定 > MCP サーバー
# [有効化] トグル ON
# URL と Token をコピー
```

### 10.2 Claude Code 側

```bash
claude mcp add amical \
  --transport http \
  --url http://127.0.0.1:7878/mcp \
  --header "Authorization: Bearer <token>"

claude mcp list   # amical が enabled で出ること
```

### 10.3 Claude セッションで tool 呼び出し

Claude セッション内で:
```
あなた: 「Amical の vocabulary を 5 件取得して」

Claude:
  mcp__amical__vocabulary_list({ limit: 5 })
  → 結果を表示
```

### 10.4 curl での疎通確認

```bash
# tools/list
curl -X POST http://127.0.0.1:7878/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# vocabulary_list
curl -X POST http://127.0.0.1:7878/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vocabulary_list","arguments":{"limit":5}}}'
```

### 10.5 認証エラー確認

token なし → 401

```bash
curl -i http://127.0.0.1:7878/mcp -X POST -d '{}'
# HTTP/1.1 401 Unauthorized
```

---

## 11. リスクと既知の論点

### 11.1 プライバシー

`transcriptions_recent` 経由で Claude (= Anthropic) に発話履歴が送られる。Amical は dictation app なので、履歴には極めて private な内容を含みうる (思考メモ、メッセージ下書き、パスワード口述等)。

対策:
- デフォルトで MCP サーバー OFF (opt-in)
- 設定画面で警告表示 (§7.2 の ⚠ ブロック)
- ユーザーは「これを有効化する = 接続された Claude に履歴が見える」を理解した上で ON にする
- 将来: `transcriptions_recent` を session token で更に gate (一時的に許可、N 分後に自動 revoke) する案

### 11.2 token の保存場所

現案: `app_settings` の JSON カラムに平文保存。
- Pro: シンプル、既存 DB に乗る
- Con: DB ファイルを盗まれると token が読める

将来案: macOS Keychain / Windows Credential Manager に保存。実装複雑度上がるので初回は app_settings。

### 11.3 ポート衝突

`port: 7878` (default) が他アプリで使われている場合、起動失敗。ユーザーが設定画面でポートを変更できる。

### 11.4 Electron の Node 環境制約

`@modelcontextprotocol/sdk` は Node.js 環境を想定。Electron のメインプロセスで動かす想定 (renderer ではない)。
- 確認事項 (実装中): SDK のパッケージが Electron で問題なく import できるか
- 万一問題があれば: `forge.config.ts` の `EXTERNAL_DEPENDENCIES` に `@modelcontextprotocol/sdk` を追加して Vite bundle から除外

### 11.5 MCP SDK のバージョン

執筆時点 (2026 年 6 月):
- 公式 repo: `https://github.com/modelcontextprotocol/typescript-sdk`
- v1.x 系で `NodeStreamableHTTPServerTransport` が提供される
- 実装時に latest を確認、もし API が変わっていれば本 SPEC を更新

---

## 12. 未決事項 (実装中にユーザーに確認)

1. デフォルトポート 7878 で良いか (Amical 関連の他ポートと衝突しないか — `pgrep` で確認)
2. token 表示の UX (常時マスク / クリックで unmask / 一回コピーしたら自動マスク戻し 等)
3. transcriptions_recent の `since` パラメータの粒度 (ISO timestamp で十分か、id ベースが要るか)
4. tool 名は snake_case (`vocabulary_list`) と camelCase (`vocabularyList`) のどちらが MCP 慣習か (今回は snake_case で書いた)
5. `vocabulary_bulk_add` で `source` 引数を受け取るが、library:* に予約 prefix を作って衝突避けるか
6. v1 misrec_candidates 系 tool は「廃止予定の v1 実装」に依存するので、いずれ archive ブランチに同期して新検出器ができたら復活させる、で OK か (それまでは tool 群を一時保留する選択肢もあり)
