#!/usr/bin/env bash
#
# Build the Amical .app and launch it FROM THE BUILD OUTPUT DIRECTORY.
#
# This is the ONLY supported way to do manual smoke testing of Amical
# changes. Two things are deliberately avoided:
#
#   1. Dev launch (electron-forge start / scripts/dev.sh) — churns the
#      bundle cdHash every run; not a real .app.
#
#   2. Copying to /Applications — macOS tags anything under /Applications
#      with the com.apple.provenance xattr and treats it as App Management.
#      Under Sequoia, ad-hoc-signed apps in App Management have their TCC
#      (accessibility / mic) permission SILENTLY revoked on every rebuild
#      (cdHash change), and eventually the System Settings toggle stops
#      working entirely — the only recovery is removing the entry and
#      re-adding the app by hand. FloatingMacro hit this and settled on
#      launching straight from its build output dir. We do the same.
#
# So: build, ad-hoc deep-sign in place, and `open` the bundle right where
# electron-forge produced it. No copy, no /Applications.
#
# Idempotent: quits a running instance first, then rebuilds and relaunches.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APP_NAME="Amical"
BUILD_OUTPUT_DIR="apps/desktop/out/${APP_NAME}-darwin-arm64"
BUILT_APP="${BUILD_OUTPUT_DIR}/${APP_NAME}.app"

echo "[install-dev] Quitting ${APP_NAME} if running…"
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
# Wait up to ~5s for the main process to exit before we rebuild.
for _ in 1 2 3 4 5; do
  if ! pgrep -fx ".*/${APP_NAME}.app/Contents/MacOS/${APP_NAME}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[install-dev] Building .app via pnpm --filter @amical/desktop package…"
pnpm --filter @amical/desktop package

if [[ ! -d "${BUILT_APP}" ]]; then
  echo "[install-dev] Expected build output not found at ${BUILT_APP}" >&2
  exit 1
fi

# electron-forge's postPackage hook already ad-hoc deep-signs the bundle,
# but re-sign once more here as a guard in case the tree was touched after
# packaging. --timestamp=none is the ad-hoc convention.
echo "[install-dev] Ad-hoc deep-signing in place…"
codesign --sign - --deep --force --timestamp=none "${BUILT_APP}"

echo "[install-dev] Verifying code signature…"
codesign --verify "${BUILT_APP}"

ABS_APP="${REPO_ROOT}/${BUILT_APP}"
echo "[install-dev] Launching ${ABS_APP}…"
open "${ABS_APP}"

echo "[install-dev] Done. (launched from build output, not /Applications)"
