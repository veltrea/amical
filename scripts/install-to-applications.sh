#!/usr/bin/env bash
#
# TEST-ONLY: install the freshly built Amical INTO /Applications, replacing the
# daily-use build, so the running app shares the exact path + TCC entry the user
# grants in System Settings (the "Applications folder Amical" entry).
#
# This DELIBERATELY breaks the normal rule that scripts/install-dev.sh follows
# (launch from out/ to dodge Sequoia App-Management silent-revoke on every
# rebuild). It is justified ONLY for a single manual verification where the
# out/-path "different cdHash = different app" problem keeps the running build
# from matching the System Settings entry the user is toggling. The flow is:
# build once, copy once, grant once, observe. Do NOT loop rebuilds through this
# script — each rebuild changes cdHash and silently revokes the grant.
#
# Usage:
#   scripts/install-to-applications.sh           # reuse the existing out/ build
#   scripts/install-to-applications.sh --build   # rebuild first, then install
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APP_NAME="Amical"
BUILT_APP="apps/desktop/out/${APP_NAME}-darwin-arm64/${APP_NAME}.app"
DEST_APP="/Applications/${APP_NAME}.app"

if [[ "${1:-}" == "--build" ]]; then
  echo "[install-to-app] Building .app via pnpm --filter @amical/desktop package…"
  pnpm --filter @amical/desktop package
fi

if [[ ! -d "$BUILT_APP" ]]; then
  echo "[install-to-app] Built app not found: $BUILT_APP (run once with --build)" >&2
  exit 1
fi

echo "[install-to-app] Stopping any running Amical (both /Applications and out/ instances)…"
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
pkill -f "/Amical.app/Contents/MacOS/Amical" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8; do
  pgrep -fx ".*/Amical.app/Contents/MacOS/Amical" >/dev/null 2>&1 || break
  sleep 1
done

if [[ -d "$DEST_APP" ]]; then
  echo "[install-to-app] Removing old $DEST_APP…"
  rm -rf "$DEST_APP"
fi

echo "[install-to-app] Copying built bundle -> $DEST_APP…"
cp -R "$BUILT_APP" "$DEST_APP"

# cp breaks the code-signature seal; TCC ignores apps whose seal is broken, so
# re-sign ad-hoc deep in place. --timestamp=none is the ad-hoc convention.
echo "[install-to-app] Ad-hoc deep-signing $DEST_APP…"
codesign --sign - --deep --force --timestamp=none "$DEST_APP"
codesign --verify "$DEST_APP" && echo "[install-to-app] signature OK"

# Launch by DIRECT-EXEC of the binary, NOT `open`. `open` goes through
# LaunchServices, which resolves by bundle id — so a duplicate bundle id
# elsewhere (e.g. a leftover out/ build sharing ai.amical.desktop) can hijack
# the launch and start the WRONG bundle (exactly the bug we hit). Direct-exec
# guarantees THIS bundle runs. nohup+disown detaches it so it survives this
# shell. Electron steals focus even via direct-exec, which is fine here.
echo "[install-to-app] Launching $DEST_APP via direct-exec (bypassing LaunchServices)…"
nohup "$DEST_APP/Contents/MacOS/${APP_NAME}" >/dev/null 2>&1 &
disown 2>/dev/null || true
echo "[install-to-app] Done. Grant Accessibility/Mic to the /Applications Amical entry in System Settings; after that it runs in its normal widget-only state."
