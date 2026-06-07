# Dock 非表示バグ 修正計画書

> **用途:** 次セッションでこのファイルを読み、`showInDock` を OFF にしても Dock アイコンが消えないバグを修正する。context 無しで着手できるよう自己完結にまとめてある。
> **作成:** 2026-06-05 / **対象:** Amical（fork `v1.7.1-fork.6`、本家 `v1.7.6` も同症状）

## TL;DR（結論だけ読むなら）
- **症状:** 設定「Dockにアプリを表示」を OFF にしても Dock アイコンが消えない。期待動作は「OFF で Dock から消える（トレイは残りアプリは動作継続）」。
- **原因（確定）:** widget が `setVisibleOnAllWorkspaces(true)` を `skipTransformProcessType` 無しで呼ぶ → Electron が内部 `TransformProcessType` でプロセスを regular に固定 → `app.dock.hide()` を打ち消す（[electron#25368](https://github.com/electron/electron/issues/25368)）。
- **修正（推奨）:** `apps/desktop/src/main/core/window-manager.ts:394` の `setVisibleOnAllWorkspaces` オプションに `skipTransformProcessType: true` を **1行追加** → 実機検証。

## 1. 根本原因（確定済み）

| 要素 | 内容 |
|---|---|
| 直接原因 | `window-manager.ts:392-397` の widget 設定。`setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true})` に `skipTransformProcessType` 未指定。 |
| 機序 | Electron は `setVisibleOnAllWorkspaces(true)` の際、内部で `TransformProcessType` を実行しプロセスを **regular（Dock表示）** に固定。これが `app.dock.hide()`（accessory化）を上書きする。 |
| 実証 | `lsappinfo` = accessory(UIElement) なのに `killall Dock` 再描画でも残存（＝描画ラグではない）。本家 v1.7.6 もコード同一＝未修正。 |
| 無関係と判明 | dev.sh の /Applications 入替、fork 独自変更は本件と無関係。 |

## 2. 修正方針

### 推奨 A: skipTransformProcessType 付与（最小修正）
`apps/desktop/src/main/core/window-manager.ts:394-396`:
```ts
// 現状
this.widgetWindow.setVisibleOnAllWorkspaces(true, {
  visibleOnFullScreen: true,
});
// 修正後
this.widgetWindow.setVisibleOnAllWorkspaces(true, {
  visibleOnFullScreen: true,
  skipTransformProcessType: true, // Dock 状態を app.dock.show/hide のみに委ねる (#25368)
});
```
- **狙い:** widget の collectionBehavior（全ワークスペース表示）は維持しつつ、プロセスタイプ変更だけ抑止。Dock 表示は `showInDock`→`app.dock.show/hide` が唯一の決定者になる。
- **要検証リスク:** `skipTransformProcessType` で widget の「別 Space / フルスクリーン上での表示」が劣化しないか（§4 で確認）。

### フォールバック B: hide 時に widget を一時退避
`syncDockVisibility` で OFF 時 `setVisibleOnAllWorkspaces(false)` → `app.dock.hide()`、ON で戻す。**A が副作用を出した場合のみ**。状態管理が増え、再 show で再浮上リスク。

### 最終手段 C: LSUIElement ベースへ転換
`Info.plist` に `LSUIElement=1`（既定 accessory）、`showInDock=true` 時のみ `dock.show()`。起動シーケンス大改修。show 側で同じ #25368 を踏む懸念。

## 3. 実装手順
1. 案 A 適用（`window-manager.ts:394`）。
2. `settings-service.ts:434` `syncDockVisibility` に debounce/状態ガードを追加（OFF↔ON 連打時のアイコン二重化 [electron#21810](https://github.com/electron/electron/issues/21810) を予防）。
3. （任意・テスタビリティ）`syncDockVisibility` を「設定値→意図(show/hide) を返す純関数」＋「Electron 呼び出し」に分離し、純関数を vitest で単体テスト。
4. `pnpm --filter @amical/desktop type:check` 通過確認。

## 4. 検証チェックリスト（実機 = `scripts/install-dev.sh`）

**OFF にしたとき**
- [ ] Dock アイコンが消える（本丸）
- [ ] トレイ（メニューバー）アイコンは残り、音声入力が動作継続
- [ ] widget が通常デスクトップで表示される
- [ ] widget が**別の Space に切替えても**表示される ← `skipTransformProcessType` 副作用確認
- [ ] widget が**フルスクリーンアプリ上でも**表示される ← `visibleOnFullScreen` 維持確認

**ON にしたとき**
- [ ] Dock アイコンが出る／起動直後も出る（#21810 の重複なし）

**切替え**
- [ ] OFF→ON→OFF 反復でアイコンが重複/取り残されない

## 5. 現状確認コマンド（次セッションで状態を再確認する用）
```bash
# プロセス生死
pgrep -fl "/Applications/Amical.app/Contents/MacOS/Amical"
# activation type (Foreground=regular / UIElement=accessory)
lsappinfo info -app ai.amical.desktop | grep -iE "pid|type"
# 設定値 showInDock（app_settings.data の JSON 内 preferences.showInDock）
sqlite3 "$HOME/Library/Application Support/Amical/amical.db" "SELECT data FROM app_settings;" \
  | python3 -c "import sys,json; print('showInDock =', json.load(sys.stdin).get('preferences',{}).get('showInDock'))"
# dock 関連ログ
grep -i dock "$HOME/Library/Logs/Amical/amical.log" | tail
```

## 6. 関連ファイル

| ファイル | 役割 |
|---|---|
| `apps/desktop/src/main/core/window-manager.ts:392-397` | **修正の主対象**（widget の dock 影響設定: setAlwaysOnTop / setVisibleOnAllWorkspaces / setHiddenInMissionControl） |
| `apps/desktop/src/services/settings-service.ts:434-447` | `syncDockVisibility`（OFF/ON で `app.dock.hide/show`） |
| `apps/desktop/src/main/core/app-manager.ts:281-295` | 起動時の dock 適用（`preferences.showInDock`） |
| `apps/desktop/src/main/core/app-manager.ts:244` | 設定変更時に `syncDockVisibility` を呼ぶ箇所 |

## 7. ビルド/起動の注意（このプロジェクト固有）
- 動作確認は **`scripts/install-dev.sh` のみ**（ビルド→ad-hoc署名→`out/` から起動。`/Applications` コピー禁止 = Sequoia の TCC silent revoke）。
- `/Applications/Amical.app` 起動中だと single-instance ロックで dev が静かに exit 0 終了する。先に `pkill -f "/Applications/Amical.app/Contents/MacOS/Amical"` してから install-dev.sh。
- Dock タイルが「出ない」だけなら `killall Dock` で解消（本バグとは別の、bundle 入替直後の一過性）。

## 8. 参考 Electron issue
- [#25368](https://github.com/electron/electron/issues/25368) — `setVisibleOnAllWorkspaces(true)` が `app.dock.hide()` を妨げる（**本件の核心**）
- [#21810](https://github.com/electron/electron/issues/21810) — `dock.hide()`/`dock.show()` 連続呼び出しでアイコン重複
- [#16093](https://github.com/electron/electron/issues/16093) — `dock.hide()` と `app.hide()` 併用不可・App Switcher に出ない等の副作用

## 9. スコープ外 / 今後の判断
- 本家（amicalhq/amical）への Issue/PR 還元（本家も再現するはずなので報告価値あり）。
- 起動時 `LSUIElement` 未設定による「一瞬 Dock に出てから消える」既知挙動（軽微・許容）。
