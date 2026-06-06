#!/usr/bin/env bash
#
# ⚠️ 一時的な「配布シミュレーション」スクリプト（使い捨て。smoke-test 正典ではない）
# ============================================================================
#
# これは わざと 非効率・目視前提 の検証ハーネス。一般ユーザーがリリース版で
# 実際にやる手順を、まるごと同じ順番で再現する:
#
#   1. .app をフルリビルド
#   2. .dmg にパッケージ（= 本物の配布物そのもの）
#   3. その .dmg を「見えるように」マウント（デスクトップ／Finder に出す。
#      -nobrowse は 使わない）し、DMG をダブルクリックした時と同じく
#      Finder ウィンドウも自動で開く
#   4. /Applications へ手動コピー（ユーザーが Applications にドラッグ＆
#      ドロップするのと同じ＝ ditto）
#   5. コピーした実体を「ダブルクリック相当」で起動（`open` は使わない。
#      open はバンドル ID 解決なので別パスの Amical が起動しうる）
#   6. DMG は アンマウントしない（マウントしたまま残す）
#
# 目的は「配布物が一般ユーザーの環境でちゃんと使えるか」を、ユーザーと同じ
# トラブル（特に Sequoia の /Applications ad-hoc アプリ TCC silent-revoke）
# ごと体験し、全工程を自分の目で見て確認すること。
#
# 一時停止は「状態が変わった節目」だけ（マウント後／コピー後／起動後）。
# 中間ファイルの場所確認のような無駄な停止はしない。表示パスは全部 絶対パス。
#
# ── 使い方 ───────────────────────────────────────────────────────────────
#   ./scripts/install-dev.sh              # フルリビルドから
#   SKIP_BUILD=1 ./scripts/install-dev.sh # 直近ビルド済みの DMG を再利用
#                                         #   （マウント工程からすぐ試せる）
#
# >>> 使い捨て。コミットしないこと。終わったら正典に戻す:
# >>>     git checkout scripts/install-dev.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APP_NAME="Amical"
# パスは全部 絶対 で持つ（表示も絶対パスになる）。
BUILD_OUTPUT_DIR="${REPO_ROOT}/apps/desktop/out/${APP_NAME}-darwin-arm64"
MAKE_DIR="${REPO_ROOT}/apps/desktop/out/make"
DEST_APP="/Applications/${APP_NAME}.app"

pause() {
  echo ""
  echo "  ────────────────────────────────────────────────────────────"
  read -rp "  ▶ $1 — 確認したら Enter で次へ… " _ || true
  echo ""
}

# ── STEP 1/6 ──────────────────────────────────────────────────────────────
# 既存インスタンスを終了（out 版・/Applications 版どちらの single-instance
# ロックも解放しておかないと、コピー版が静かに exit 0 して起動しない）。
echo "[STEP 1/6] 既存の ${APP_NAME} を終了…"
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
pkill -f "/Applications/${APP_NAME}.app/Contents/MacOS/${APP_NAME}" 2>/dev/null || true
pkill -f "${BUILD_OUTPUT_DIR}/${APP_NAME}.app/Contents/MacOS/${APP_NAME}" 2>/dev/null || true
for _ in 1 2 3 4 5; do
  pgrep -fx ".*/${APP_NAME}.app/Contents/MacOS/${APP_NAME}" >/dev/null 2>&1 || break
  sleep 1
done

# ── STEP 2/6 ──────────────────────────────────────────────────────────────
# フルリビルド＋DMG 作成。`make` は package → ad-hoc deep-sign(postPackage)
# → 各 maker を回す。darwin では zip と dmg が出る。配布物は dmg。
# SKIP_BUILD=1 のときは作らず、直近の DMG をそのまま使う。
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "[STEP 2/6] SKIP_BUILD=1 → ビルドを飛ばし、直近の DMG を再利用します"
else
  echo "[STEP 2/6] フルリビルド＋DMG 作成（pnpm --filter @amical/desktop make）…"
  echo "           ※ 数分かかります。これが「配布物そのもの」を作る工程です。"
  pnpm --filter @amical/desktop make
fi

# 生成された DMG（最新の mtime のもの）を 絶対パス で特定。
DMG="$(ls -t "${MAKE_DIR}"/*.dmg 2>/dev/null | head -1 || true)"
if [[ -z "${DMG}" || ! -f "${DMG}" ]]; then
  echo "  ✗ DMG が見つかりません（${MAKE_DIR}/*.dmg）" >&2
  exit 1
fi
echo "  → 配布 DMG: ${DMG}"

# ── STEP 3/6 ──────────────────────────────────────────────────────────────
# DMG を「見えるように」マウント。-nobrowse を 付けない ので、デスクトップ
# （ShowExternalHardDrivesOnDesktop=1 のとき）と Finder サイドバーに出る。
# さらに DMG をダブルクリックした時と同じく、中身のウィンドウを自動で開く。
echo "[STEP 3/6] DMG を可視マウント（-nobrowse なし）して中身ウィンドウを開きます…"
ATTACH="$(hdiutil attach "${DMG}")"
echo "${ATTACH}"
# hdiutil の出力はタブ区切り。/Volumes を含む行の最終フィールド＝マウント先。
MOUNT_POINT="$(echo "${ATTACH}" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
if [[ -z "${MOUNT_POINT}" || ! -d "${MOUNT_POINT}" ]]; then
  echo "  ✗ マウントポイントを特定できません" >&2
  exit 1
fi
SRC_APP="${MOUNT_POINT}/${APP_NAME}.app"
echo "  → マウント先(絶対パス): ${MOUNT_POINT}"
# ユーザーが DMG をダブルクリックしたとき自動で開くウィンドウと同じものを開く。
open "${MOUNT_POINT}" || true
pause "デスクトップのディスクアイコンと、開いた DMG ウィンドウを目で確認"

# ── STEP 4/6 ──────────────────────────────────────────────────────────────
# /Applications へ手動コピー。Finder のドラッグ＆ドロップに最も近いのは ditto
# （メタデータ・署名シールを保ったままコピー）。既存があれば置き換え。
echo "[STEP 4/6] /Applications へコピー（ドラッグ＆ドロップ相当 = ditto）…"
if [[ ! -d "${SRC_APP}" ]]; then
  echo "  ✗ DMG 内に ${SRC_APP} がありません" >&2
  exit 1
fi
if [[ -d "${DEST_APP}" ]]; then
  echo "  既存の ${DEST_APP} を削除（置き換えインストール相当）…"
  rm -rf "${DEST_APP}"
fi
ditto "${SRC_APP}" "${DEST_APP}"
echo "  → コピー完了(絶対パス): ${DEST_APP}"
echo "  （参考）コピー後の署名検証:"
codesign --verify --verbose=2 "${DEST_APP}" 2>&1 | sed 's/^/      /' || true
pause "Finder の「アプリケーション」に Amical が入ったか目で確認"

# ── STEP 5/6 ──────────────────────────────────────────────────────────────
# 「ダブルクリック相当」で起動。`open`（バンドル ID 解決＝別パスのものが起動
# しうる）は使わず、Finder にコピー先の実体パスを開かせる。これが本当の
# ダブルクリックに最も近い（launchd 親で GUI 起動）。Finder の Automation
# 許可ダイアログが初回に出たら許可する＝それも配布検証で見るべき工程。
echo "[STEP 5/6] ダブルクリック相当で起動（Finder に実体を開かせる。open は使いません）…"
echo "           起動対象(絶対パス): ${DEST_APP}"
if ! osascript -e "tell application \"Finder\" to open (POSIX file \"${DEST_APP}\" as alias)"; then
  echo "  ⚠ Finder 経由起動に失敗（Automation 未許可など）。実体を直接 exec でフォールバック…"
  "${DEST_APP}/Contents/MacOS/${APP_NAME}" >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
echo "  → 起動を要求しました"
pause "起動・TCC（アクセシビリティ／マイク）ダイアログ・権限の挙動を目で確認"

# ── STEP 6/6 ──────────────────────────────────────────────────────────────
# DMG は意図的にアンマウントしない。配布工程を最後まで目視するため。
echo "[STEP 6/6] 完了。"
echo ""
echo "  ⚠ ディスクイメージはマウントしたまま残しています（アンマウントしません）:"
echo "        ${MOUNT_POINT}"
echo "    手動で外すとき:  hdiutil detach \"${MOUNT_POINT}\""
echo ""
echo "  ⚠ /Applications の ad-hoc アプリは Sequoia で TCC が silent-revoke され得ます。"
echo "    システム設定 → プライバシーとセキュリティ → アクセシビリティ／マイク で"
echo "    Amical のトグル状態と実挙動が一致しているか、目で確認してください。"
echo ""
echo "  ⚠ これは使い捨ての配布シミュレーションです。コミットしないでください。"
echo "    smoke-test 正典へ戻す:  git checkout scripts/install-dev.sh"
