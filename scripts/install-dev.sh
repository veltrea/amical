#!/usr/bin/env bash
#
# Build the Amical .app, install it to /Applications/Amical.app (overwriting
# whatever is there), and launch it.
#
# This is the ONLY supported way to do manual smoke testing of Amical
# changes. Dev launch (electron-forge start / scripts/dev.sh) is forbidden
# because it churns the bundle's cdHash every run and silent-revokes the TCC
# (mic / accessibility) permissions of the user's daily-driver Amical.app.
#
# The .app must keep its name (`Amical.app`) and its path
# (`/Applications/Amical.app`) — never rename, never put it elsewhere.
# Renaming creates parallel TCC entries that eventually corrupt the TCC
# database to a state where the only recovery is wiping all permissions.
#
# Idempotent: safe to re-run. Quits the running Amical first, waits briefly
# for it to exit, then overwrites the bundle and re-launches.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APP_NAME="Amical"
APP_PATH="/Applications/${APP_NAME}.app"
BUILD_OUTPUT_DIR="apps/desktop/out/${APP_NAME}-darwin-arm64"
BUILT_APP="${BUILD_OUTPUT_DIR}/${APP_NAME}.app"

echo "[install-dev] Quitting ${APP_NAME} if running…"
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
# Wait up to ~5s for the bundle's main process to exit before we overwrite.
for _ in 1 2 3 4 5; do
  if ! pgrep -f "${APP_PATH}/Contents/MacOS/${APP_NAME}\$" >/dev/null 2>&1; then
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

echo "[install-dev] Installing to ${APP_PATH} (overwrite)…"
ditto "${BUILT_APP}" "${APP_PATH}"

echo "[install-dev] Verifying code signature…"
codesign --verify "${APP_PATH}"

echo "[install-dev] Launching ${APP_PATH}…"
open "${APP_PATH}"

echo "[install-dev] Done."
