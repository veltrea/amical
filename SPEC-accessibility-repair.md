# SPEC: Accessibility / Microphone 権限リペアフロー

`feat/accessibility-repair-flow` ブランチで実装する。`feat/mlx-proofreading`
とは独立に進める（PR も分ける）。

## 動機

ad-hoc 署名のアプリは macOS Sequoia 以降、リビルドのたびに cdHash が変わり
TCC が silent revoke する（"toggle ON / 実態 revoked"）。`/Applications/` に
配置するとさらに `com.apple.provenance` xattr で App Management 配下に置かれ、
挙動が厳しくなる。ユーザー側で手動 reset → 再許可をしないと音声入力や貼り付け
が無音で失敗する。

FloatingMacro が同じ問題に対し「アプリ内『修復』ボタンに 1 アクション集約」
というアーキテクチャに到達した（[knowledge/macos_accessibility_permission.md][k]）。
Amical でも同等の体験を提供する。

[k]: /Volumes/DISK/dev/knowledge/macos_accessibility_permission.md

## 既存資産（main ブランチ時点）

スカフォルディングは入っている。

- `packages/native-helpers/swift-helper/Sources/SwiftHelper/services/PermissionsService.swift`
  - `getStatus()` → `{hasPermission, isEnabled}` を返す
  - `requestPermission()` → `AXIsProcessTrustedWithOptions(prompt: true)`
- `packages/native-helpers/swift-helper/Sources/SwiftHelper/utils/AXHelpers.swift:407`
  - `checkAccessibilityPermissions(prompt:)`
- RPC: `getAccessibilityStatus` / `requestAccessibilityPermission` 双方
- TS 側 `NativeBridge.getAccessibilityStatus()` / `requestAccessibilityPermission()`
- tRPC: `onboarding.requestAccessibilityPermission` mutation
- React: `PermissionsScreen.tsx` の onboarding で status 表示

足りないのは「silent revoke 検出」「cdHash 変化検出」「reset → relaunch フロー」。

## 修正方針

### A. deploy 先は `/Applications/Amical.app` のまま維持

ユーザーの daily-driver パスを尊重する。`com.apple.provenance` で silent revoke
が起きる頻度は高いが、「修復」ボタン 1 クリックで解決するなら許容範囲。

### B. SwiftHelper を強化

#### 1. `AccessibilityChecker.swift` 新規（probe-based 判定）

`PermissionsService.checkPermissions()` は `AXIsProcessTrustedWithOptions` だけに
頼っており、cdHash mismatch 後も stale TRUE を返す問題がある。FloatingMacro の
[AccessibilityChecker.swift][fm-checker] を移植して **AX probe 併用** に変更。

```swift
public static func isTrusted(prompt: Bool = false) -> Bool {
    if prompt { _ = AXIsProcessTrustedWithOptions([...]: true) }
    if !AXIsProcessTrusted() { return false }
    // Probe: silent revoke では .apiDisabled が返る
    let systemWide = AXUIElementCreateSystemWide()
    var v: AnyObject?
    let err = AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute as CFString, &v)
    return err != .apiDisabled
}
```

判定マトリクス（FloatingMacro と同じ）:
| AXIsProcessTrusted | AX probe        | 結果                  |
|--------------------|-----------------|----------------------|
| false              | (skip)          | false                |
| true               | success         | true                 |
| true               | apiDisabled     | false ← silent revoke|
| true               | other error     | true ← transient 無視 |

`PermissionsService.getStatus()` をこの新ロジック経由に差し替える。

[fm-checker]: /Volumes/DISK/dev/FloatingMacro/Sources/FloatingMacroCore/Permissions/AccessibilityChecker.swift

#### 2. `BinaryIdentity.swift` 新規（cdHash 変化検出）

[FloatingMacro の同名ファイル][fm-bid] を移植。

- 起動時に `/Applications/Amical.app/Contents/MacOS/Amical` の SHA256 を計算
- `~/Library/Application Support/Amical/last_binary_hash.txt` と比較
- 変化していたら **ログのみ**（reset は呼ばない — 起動時 reset は禁止）
- 結果を新 RPC `getBinaryIdentity` で TS 側に公開:
  - `{ currentHash, lastHash, hashChanged }`

[fm-bid]: /Volumes/DISK/dev/FloatingMacro/Sources/FloatingMacroApp/BinaryIdentity.swift

#### 3. `--prompt-accessibility` 起動引数

`main.swift` の起動時に argv を見て、フラグがあれば **1 回だけ**
`AccessibilityChecker.isTrusted(prompt: true)` を呼ぶ。それ以外では呼ばない。

ただし Amical の場合 SwiftHelper は Electron main プロセスから spawn される。
- Electron 側で `process.argv` に `--prompt-accessibility` があったら SwiftHelper
  spawn 時の args に伝播する
- SwiftHelper はそれを受けて 1 回だけ prompt

#### 4. Microphone 権限の状態取得

`AVCaptureDevice.authorizationStatus(for: .audio)` を新 RPC `getMicrophoneStatus`
で公開。Microphone は `AXUIElementCopyAttributeValue` の probe が効かないが、
cdHash 変化で同様に silent revoke しうるため、status + reset 対象として扱う。

### C. Electron main 側

#### 1. `accessibility-repair-service.ts` 新規

```ts
async repair(targets: ("accessibility" | "microphone")[]): Promise<void> {
  // 1. TCC リセット（複数同時可）
  for (const t of targets) {
    const tccService = t === "accessibility" ? "Accessibility" : "Microphone";
    await execAsync(`tccutil reset ${tccService} ai.amical.desktop`);
  }
  // 2. 再起動。新プロセスでだけ SwiftHelper に --prompt-accessibility を渡す
  app.relaunch({ args: process.argv.slice(1).concat(["--prompt-accessibility"]) });
  app.exit(0);
}
```

注意:
- `tccutil reset` 後にすぐ relaunch しないと、ポーリング中の旧プロセスが auto-prompt
  と衝突してループに入る（FloatingMacro の罠 #1）
- `tccutil reset` は子プロセスとして `child_process.exec` で十分（権限不要、bundleId
  さえ合っていれば動く）

#### 2. tRPC ルータ `accessibility` 新規

```ts
accessibility = router({
  getStatus: procedure.query(() => ({
    accessibility: nativeBridge.getAccessibilityStatus(),
    microphone:    nativeBridge.getMicrophoneStatus(),
    binaryIdentity: nativeBridge.getBinaryIdentity(),
  })),
  repair: procedure
    .input(z.object({ targets: z.array(z.enum(["accessibility", "microphone"])) }))
    .mutation(({ input }) => accessibilityRepairService.repair(input.targets)),
});
```

#### 3. SwiftHelper spawn args の伝播

`native-bridge-service.ts:startHelperProcess()` で SwiftHelper を spawn する際、
`process.argv.includes("--prompt-accessibility")` なら spawn args にも追加する。

#### 4. ポーリングして TCC 状態の変化を通知

既存の native-bridge が helper のイベントを受け取る仕組みがあるので、SwiftHelper
側に AX 状態の 3 秒間隔 polling を追加し、変化を helperEvent で通知する。
React 側は subscription で受信してバッジを更新。

### D. Renderer 側

#### 1. 既存 `PermissionsScreen.tsx`（onboarding）に「修復」ボタン追加

silent revoke 検出 or binaryIdentity.hashChanged なら表示。

```tsx
{(status.silentRevoked || status.hashChanged) && (
  <Button onClick={() => api.accessibility.repair.mutate({
    targets: ["accessibility", "microphone"]
  })}>
    アクセシビリティを修復
  </Button>
)}
```

#### 2. 設定画面にも常設の「修復」セクション

`settings/advanced` あたりに「権限の修復」セクションを新設し、状態表示 + 修復
ボタンを置く。新規ユーザーは onboarding で済むが、リビルドごとの再許可はここで
セルフサービス可能にする。

#### 3. i18n キー追加

`accessibility.repair.label` 等を en/ja に追加。

### E. テスト計画

1. **cdHash 変化検出**: 旧 .app と新 .app を入れ替える → 起動時に
   `last_binary_hash.txt` と新 SHA256 が違うとログに出る。「修復」UI が表示される
2. **silent revoke 検出**: AX 一覧で Amical のトグル ON だが旧 cdHash の状態
   → `AXIsProcessTrusted() == true` ながら probe が `.apiDisabled`
   → status が "revoked" を返す
3. **修復フロー**: 「修復」ボタン押下 → `tccutil reset` → relaunch → OS ダイアログ
   1 回表示 → ユーザー許可 → 即座に音声入力／貼り付けが動く
4. **マイク並行修復**: targets に両方含めて 1 クリックで両方 grant し直せる
5. **無限ループ回避**: 自動 reset を起動時にしない（FloatingMacro の罠）

## 関連ファイル（実装で触る）

**SwiftHelper:**
- `packages/native-helpers/swift-helper/Sources/SwiftHelper/services/PermissionsService.swift` (差し替え)
- `packages/native-helpers/swift-helper/Sources/SwiftHelper/utils/AXHelpers.swift` (probe 追加)
- 新規 `Permissions/AccessibilityChecker.swift`
- 新規 `BinaryIdentity.swift`
- `main.swift` (argv 解釈)
- `RpcHandler.swift` (新 RPC method 追加)
- `models/generated/models.swift` (新 RPC 名追加 — `@amical/types` を更新後 codegen)

**`@amical/types`:**
- 新 RPC schema: `GetBinaryIdentity`, `GetMicrophoneStatus`, `RepairPermissions`

**Electron main:**
- 新規 `apps/desktop/src/services/accessibility-repair-service.ts`
- `apps/desktop/src/services/platform/native-bridge-service.ts` (spawn args 伝播 + 新 RPC ラッパー)
- `apps/desktop/src/trpc/routers/accessibility.ts` 新規（または `onboarding.ts` に統合）

**Renderer:**
- `apps/desktop/src/renderer/onboarding/components/screens/PermissionsScreen.tsx`
- `apps/desktop/src/renderer/main/pages/settings/advanced/` に新セクション
- `apps/desktop/src/i18n/locales/{en,ja}.json`

## 参考実装

- FloatingMacro `Sources/FloatingMacroCore/Permissions/AccessibilityChecker.swift`
- FloatingMacro `Sources/FloatingMacroApp/BinaryIdentity.swift`
- FloatingMacro `Sources/FloatingMacroApp/App.swift` (`applicationDidFinishLaunching`)
- FloatingMacro `scripts/reset_accessibility.sh`
- 知識ファイル `knowledge/macos_accessibility_permission.md`

## やってはいけない（罠まとめ）

| 罠 | 症状 | 正解 |
|----|------|------|
| 起動時に自動 `tccutil reset` | OS ダイアログ無限ループ | 起動時は reset しない |
| `prompt: true` を reset 直後に同プロセスで呼ぶ | OS ダイアログループ | reset 後は別プロセスで prompt |
| `openSystemPreferences()` を OS ダイアログと並行で呼ぶ | OS ダイアログのボタン無反応 | OS ダイアログのボタンを使わせる |
| 自前 alert を OS ダイアログと並べて出す | 3 ウィンドウで混乱 | 自前 alert は出さない |
| Probe-only polling で判定 | false positive | `AXIsProcessTrusted()` も併用 |
| Polling 間隔を伸ばしてループ回避 | grant 後バッジが消えるまで遅すぎ | Polling 3 秒、reset を起動時にしない |
| Auto self-relaunch で「綺麗な」自動復旧 | やはりループ | 修復は人間が押すボタンに集約 |
