# Silent-Revoke 復旧ダイアログ 実装計画

> **この1枚で実装できるように書いた自己完結ドキュメント。** 新しいセッションでは、まず
> `/Volumes/DISK/dev/knowledge/macos_accessibility_permission.md` を読んでから着手すること
> （アクセシビリティ権限を触る前の必読資料。グローバル CLAUDE.md のルール）。

## 0. 一行で言うと

ad-hoc 署名アプリは **リビルド／アップデートで cdHash が変わると、macOS の TCC がアクセシビリティ権限を
silent-revoke する**（システム設定のトグルは ON のまま、実態は無効）。これを **アプリ起動時に検出して、
ネイティブダイアログで「復旧しますか?」と出す**。復旧 = 既存の `repair`（tccutil reset → 再起動 → 権限プロンプト）。

## 1. なぜ作るか（背景）

- **症状**: システム設定 → アクセシビリティで Amical のトグルが ON なのに、実際には権限が効いていない。
  ユーザーから見ると「許可してるのに動かない＝壊れてる」に見えて、離脱する。
- **原因**: TCC は ad-hoc 署名アプリを **cdHash** で記録する。リビルド／アップデートで cdHash が変わると、
  古い許可レコードが「別アプリのもの」になり、黙って無効化される（silent revoke）。
- **誰が踏むか**:
  - 開発中の自分（リビルドのたび）。
  - **一般ユーザーも、Amical をアップデートするたびに踏む** ← これが本番。配布検証で炙り出された穴。
- **現状の欠落**: 復旧機能（`repair`）は実装済みだが、UI が **設定 → 詳細設定** の奥にしかない。
  silent revoke で詰まったユーザーは、オンボーディングを抜けられない＝設定画面に到達できない＝
  **復旧ボタンに永久に辿り着けない**。必要な瞬間に、手段が届かない。

## 2. 設計方針（採用案: A = メインプロセス + ネイティブダイアログ）

| 観点 | 内容 |
|---|---|
| UX | 画面の隙間にボタンを足しても気づかれない。**ダイアログ**なら確実に目に入る |
| 保守性（最重要） | **本家のレンダラー（React）を 1 行も触らない**。追加はすべてメインプロセス側に隔離。本家 upstream 追従時にコンフリクトしない |
| 検出方式 | 「時間差で後出し」は **不可**（一度ダメだとユーザーは諦めて離脱する）。**起動時点で AX probe により判定**し、最初から出す/出さないを決める |
| 復旧 | 新規実装しない。既存の `repair`（tccutil reset → relaunch）を再利用 |

### 触ってはいけないもの（厳守）
- `apps/desktop/src/renderer/onboarding/components/screens/PermissionsScreen.tsx` ← 本家のオンボーディング画面。**変更禁止**
- その他 `src/renderer/` 配下の本家由来コードは、原則いじらない（追従性を壊さないため）

## 3. silent-revoke 判定ロジック（知識ファイルの判定マトリクス）

`/Volumes/DISK/dev/knowledge/macos_accessibility_permission.md` の表に従う：

| `AXIsProcessTrusted()` | AX probe (`AXUIElementCopyAttributeValue` で `kAXFocusedApplicationAttribute`) | 判定 | ダイアログ |
|---|---|---|---|
| false | (skip) | 初回 or 通常拒否 | **出さない**（通常のオンボーディングに任せる） |
| true | success | 正常に権限あり | 出さない |
| true | `.apiDisabled` | **silent-revoke** | **出す** |
| true | その他 error | transient（sandboxed app / login window 等）| 出さない（誤発火防止） |

ポイント: `AXIsProcessTrusted()` は silent-revoke 後も **stale TRUE** を返すことがある。
だから `AXIsProcessTrusted()` だけで判定してはいけない。**AX probe の `.apiDisabled` が silent-revoke の唯一の確証**。

## 4. 既存の資産（再利用できるもの）

| ファイル | 中身 | 使い方 |
|---|---|---|
| `apps/desktop/src/trpc/routers/permissions.ts:62-83` | `repair` mutation（tccutilReset → `app.relaunch({args})` → `app.exit(0)`）と `tccutilReset()`、`PROMPT_PERMISSIONS_ARG` | 復旧の実体。ロジックを共有関数に切り出してメインからも呼ぶ |
| `apps/desktop/src/main/permissions-bootstrap.ts` | `maybePromptForRevokedPermissions()` = 再起動直後に AX/マイクの OS プロンプトを出す（`PROMPT_PERMISSIONS_ARG` のとき） | repair の「再起動後」を既に処理済み。新規ダイアログは「再起動前」を担当 |
| `apps/desktop/src/main/main.ts:104-112` | `app.whenReady()` → `appManager.initialize()` → `maybePromptForRevokedPermissions()` | **112 行の直後**が、silent-revoke チェックの挿し込み位置 |
| `apps/desktop/src/services/platform/native-bridge-service.ts:870,877` | `getAccessibilityStatus()`, `requestAccessibilityPermission()` | silent-revoke 判定を生やす足場 |
| `packages/native-helpers/swift-helper/Sources/SwiftHelper/` | `AXIsProcessTrustedWithOptions`（main.swift:23, AXHelpers.swift:409）, `AXUIElementCopyAttributeValue`（AccessibilityService.swift:64 ほか多数） | AX probe の部品は全部揃っている。判定関数を 1 つ書くだけ |
| `apps/desktop/src/renderer/main/pages/settings/advanced/index.tsx:92,485-523` | 既存の repair ボタン UI（確認ダイアログ + i18n キー `settings.advanced.permissions.repair.*`） | 文言・確認フローの参考。**触らない** |

## 5. 実装ステップ

### Step 1 — SwiftHelper に silent-revoke 判定を追加
- `AccessibilityService.swift`（または `utils/AXHelpers.swift`）に判定関数を追加：
  - `AXIsProcessTrusted()` が false → `{ trusted: false, silentRevoke: false }`
  - true → systemWide 要素に `AXUIElementCopyAttributeValue(_, kAXFocusedApplicationAttribute, _)` を投げ、
    戻りエラーが `.apiDisabled` なら `{ trusted: false, silentRevoke: true }`、それ以外は `{ trusted: true, silentRevoke: false }`
- SwiftHelper の JSON-RPC コマンドハンドラに新コマンド（例 `checkSilentRevoke`）を追加。
  - **実装前に確認**: `getAccessibilityStatus` 系コマンドが既に何を返しているか。流用 or 拡張で済むかもしれない。

### Step 2 — native-bridge にブリッジメソッドを追加
- `native-bridge-service.ts` に `async checkSilentRevoke(): Promise<{trusted:boolean; silentRevoke:boolean}>`
  を追加（`return this.call("checkSilentRevoke", {})` の形。既存メソッドに倣う）。
- 対応する params/result schema を、型定義（同ファイル 30-32, 65-67, 106 付近の作法）に追加。

### Step 3 — メインプロセスに「ガード」を新設（本家を触らない隔離先）
- 新規ファイル `apps/desktop/src/main/silent-revoke-guard.ts`（`permissions-bootstrap.ts` の作法に倣う）。
- `export async function maybeOfferAccessibilityRepair(): Promise<void>`:
  1. `process.platform !== "darwin"` なら return。
  2. **`process.argv.includes(PROMPT_PERMISSIONS_ARG)` なら return**（repair 直後の再起動。無限ループ防止）。
  3. nativeBridge の `checkSilentRevoke()` を呼ぶ。
  4. `silentRevoke === true` のときだけ `dialog.showMessageBox`（仕様は §6）。
  5. [復旧する] が押されたら、共有化した repair ロジック（Step 4）を呼ぶ。

### Step 4 — repair ロジックを共有関数化
- 現状 `repair` は tRPC procedure（`permissions.ts`）。メインから直接呼べるよう、
  中身（`tccutilReset("Accessibility"/"Microphone")` → `app.relaunch({args:[...,PROMPT_PERMISSIONS_ARG]})` → `app.exit(0)`）を
  共有関数（例 `runAccessibilityRepair()`）に切り出し、tRPC `repair` と `silent-revoke-guard.ts` の両方から呼ぶ。
- これで「設定 → 詳細設定の repair ボタン」と「起動時ダイアログ」が同じ実体を使う（DRY）。

### Step 5 — main.ts に 1 行挿す
- `main.ts:112` の `await maybePromptForRevokedPermissions();` の **直後**に
  `await maybeOfferAccessibilityRepair();` を追加。
- 順序の理由: repair 再起動直後は `maybePromptForRevokedPermissions()` がプロンプトを出す側なので、
  その後にガードが走っても Step 3-2 のガード（PROMPT_PERMISSIONS_ARG）で即 return する。

## 6. ダイアログ仕様（`dialog.showMessageBox`）

```
type:    'warning'
title:   'アクセシビリティ権限'
message: 'アクセシビリティ権限が無効になっています'
detail:  'システム設定では「許可」に見えても、実際には無効化されています'
         '（アプリの更新後によく起こります）。'
         '「復旧」を押すと、権限をリセットして、許可し直しの案内を自動で表示します。'
buttons: ['復旧する', '後で']   // defaultId: 0, cancelId: 1
```
- [復旧する] → `runAccessibilityRepair()`（tccutil reset → 再起動 → 既存の `maybePromptForRevokedPermissions` が新プロセスでクリーンな OS ダイアログを出す）。
- [後で] → 閉じるだけ。
- i18n: 既存の `settings.advanced.permissions.repair.*` の文言トーンに合わせる。新キーが要るなら locale に追加（これは本家ファイルでなく i18n リソースなので OK）。

## 7. 実装時に必ず確認すること（着手後の TODO）
- [ ] `getAccessibilityStatus()`（native-bridge 870 / SwiftHelper 側）が既に AX probe しているか。していれば Step 1-2 を簡略化。
- [ ] SwiftHelper のコマンド登録方法（どのファイルで JSON-RPC メソッド名 → ハンドラを束ねているか）。
- [ ] `repair` を共有関数化したとき、tRPC 側の戻り（`{relaunching:true}`）が壊れないか。

## 8. テスト・検証（install-dev.sh での再現）
1. **silent-revoke を再現**: Amical をリビルド → DMG → `/Applications` に差し替え → 起動（cdHash 変化で silent-revoke 発生）。
   - ※ 検証フロー自体は `scripts/install-dev.sh` を使う（CLAUDE.md / メモリ参照。手動で electron-forge/cp/open を打たない）。
2. 起動時に **ダイアログが出る**ことを確認。
3. [復旧する] → tccutil reset → 再起動 → クリーンな OS 許可ダイアログ、まで通ることを確認。
4. **誤発火しないこと**: TCC をクリーン（初回相当）にした状態で起動 → **ダイアログが出ない**ことを確認。
5. repair 再起動直後（PROMPT_PERMISSIONS_ARG 付き）に **二重で出ない**ことを確認。

## 9. 注意事項（厳守）
- 着手前に `/Volumes/DISK/dev/knowledge/macos_accessibility_permission.md` を読む。
  - **起動時に自動で `tccutil reset` を打たない**。reset は [復旧する] を押したときだけ。
  - `prompt: true` は relaunch 後の新プロセスでのみ（既存 `maybePromptForRevokedPermissions` が担当済み）。
- **本家のレンダラー（PermissionsScreen.tsx 等）を触らない**。追加はメインプロセス + SwiftHelper + i18n に隔離。
- 各コミットで **`.app` ビルドを通す**（型 check 通過 ≠ ビルド通過。起動時 throw はビルドを素通りする）。
- コミットメッセージに **AI 著作権表記を入れない**。英語で書く。
- 作業ブランチは **main**（develop は廃止・復活させない）。push 先は origin（veltrea/amical）。

## 10. 関連ファイル一覧
**読む（必読）**
- `/Volumes/DISK/dev/knowledge/macos_accessibility_permission.md`

**既存（再利用・参考）**
- `apps/desktop/src/trpc/routers/permissions.ts`（repair / tccutilReset / PROMPT_PERMISSIONS_ARG）
- `apps/desktop/src/main/permissions-bootstrap.ts`（再起動後プロンプト）
- `apps/desktop/src/main/main.ts`（起動シーケンス 104-112）
- `apps/desktop/src/services/platform/native-bridge-service.ts`（getAccessibilityStatus 870 / requestAccessibilityPermission 877）
- `packages/native-helpers/swift-helper/Sources/SwiftHelper/`（AccessibilityService.swift, utils/AXHelpers.swift, main.swift）
- `apps/desktop/src/renderer/main/pages/settings/advanced/index.tsx`（既存 repair UI・文言の参考。**触らない**）

**新規作成**
- `apps/desktop/src/main/silent-revoke-guard.ts`（判定呼び出し + ダイアログ + repair 呼び出し）
- SwiftHelper 側の判定関数 + コマンド（Step 1）
- i18n リソースの新文言（必要なら）
