#!/usr/bin/env bash
# Rebuild deps (types + native helpers) and launch the desktop app via
# electron-forge. Thin wrapper around `pnpm --filter @amical/desktop start`
# so that the day-to-day "blow it all away and run it" flow is one command.
#
# Usage:
#   scripts/dev.sh                  # incremental: build:deps + electron-forge start
#   scripts/dev.sh --clean          # wipe native-helper + types build artifacts first
#   scripts/dev.sh --no-helper      # skip native helper build (JS-only fast loop)
#   scripts/dev.sh --quiet          # don't tee log to terminal (still saved to file)
#   scripts/dev.sh --no-log         # don't write a log file at all (terminal only)
#   scripts/dev.sh --keep-installed # do NOT auto-quit /Applications/Amical.app
#   scripts/dev.sh -- --inspect=9229  # pass through to electron-forge
#   scripts/dev.sh --clean -- --inspect=9229
#
# Why we auto-quit /Applications/Amical.app: Electron enforces a single-instance
# lock per bundleId, so a dev build silently exits (with code 0!) when the
# installed app is already running. The user relies on Amical for daily
# dictation, so the installed app is almost always running — quitting it
# automatically is the only sane default. Pass --keep-installed to override.
#
# All flags can be combined. Anything after `--` is forwarded verbatim to
# electron-forge start. Per-run logs land in logs/dev-YYYYMMDD-HHMMSS.log
# under the repo root (gitignored).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLEAN=0
QUIET=0
NO_LOG=0
NO_HELPER=0
KEEP_INSTALLED=0
FORGE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)          CLEAN=1; shift ;;
    --quiet)          QUIET=1; shift ;;
    --no-log)         NO_LOG=1; shift ;;
    --no-helper)      NO_HELPER=1; shift ;;
    --keep-installed) KEEP_INSTALLED=1; shift ;;
    --)               shift; FORGE_ARGS=("$@"); break ;;
    -h|--help)        sed -n '2,24p' "$0"; exit 0 ;;
    *)
      echo "[dev.sh] Unknown argument: $1" >&2
      echo "[dev.sh] (Use --help or put unknown args after --)" >&2
      exit 2
      ;;
  esac
done

# Auto-quit the installed app so the single-instance lock doesn't silently
# kill our dev build. macOS-only — `osascript` is a no-op stub elsewhere.
if [[ $KEEP_INSTALLED -eq 0 ]] && [[ "$(uname -s)" == "Darwin" ]]; then
  if pgrep -fq "/Applications/Amical.app/Contents/MacOS/Amical"; then
    echo "[dev.sh] Quitting /Applications/Amical.app (single-instance lock)…"
    # `tell application "Amical" to quit` triggers a graceful shutdown; it
    # waits for the app to finish before returning, so by the next line the
    # lock is released.
    osascript -e 'tell application "Amical" to quit' >/dev/null 2>&1 || true
    # Belt-and-suspenders: short wait in case the graceful quit is slow.
    for _ in 1 2 3 4 5; do
      pgrep -fq "/Applications/Amical.app/Contents/MacOS/Amical" || break
      sleep 0.5
    done
  fi
fi

LOG_FILE=""
if [[ $NO_LOG -eq 0 ]]; then
  mkdir -p logs
  LOG_FILE="logs/dev-$(date +%Y%m%d-%H%M%S).log"
fi

# run_cmd: respect --quiet and --no-log. Source of truth precedence:
#   --no-log         → terminal only, never write a file
#   --quiet          → file only, no terminal output
#   neither          → tee to both
run_cmd() {
  if [[ $NO_LOG -eq 1 ]]; then
    "$@"
  elif [[ $QUIET -eq 1 ]]; then
    "$@" >>"$LOG_FILE" 2>&1
  else
    "$@" 2>&1 | tee -a "$LOG_FILE"
  fi
}

echo "[dev.sh] Repo:     $REPO_ROOT"
[[ -n "$LOG_FILE" ]] && echo "[dev.sh] Logfile:  $LOG_FILE"
[[ $CLEAN     -eq 1 ]] && echo "[dev.sh] Mode:     clean rebuild"
[[ $NO_HELPER -eq 1 ]] && echo "[dev.sh] Mode:     skip native helper build"
[[ ${#FORGE_ARGS[@]} -gt 0 ]] && echo "[dev.sh] Forge:    ${FORGE_ARGS[*]}"

if [[ -n "$LOG_FILE" ]]; then
  {
    echo "=== dev.sh @ $(date -u +%FT%TZ) ==="
    echo "clean=$CLEAN quiet=$QUIET no_helper=$NO_HELPER forge_args=(${FORGE_ARGS[*]:-})"
  } >>"$LOG_FILE"
fi

if [[ $CLEAN -eq 1 ]]; then
  echo "[dev.sh] Cleaning build artifacts…"
  # Wipe Swift helper builds and Electron renderer cache. Keep stt-helper's
  # vendor/ (vendored MLX submodules) — re-fetching is slow and pointless.
  paths=(
    packages/native-helpers/stt-helper/.build
    packages/native-helpers/stt-helper/bin
    packages/native-helpers/swift-helper/.build
    packages/native-helpers/swift-helper/bin
    apps/desktop/dist-helpers
    apps/desktop/.vite
    packages/types/dist
  )
  if [[ -n "$LOG_FILE" ]]; then
    rm -rf "${paths[@]}" >>"$LOG_FILE" 2>&1 || true
  else
    rm -rf "${paths[@]}" || true
  fi
fi

# Pick the right pnpm script. `build:deps` runs types+helper; we override it
# when --no-helper is set so the JS-only loop is fast.
if [[ $NO_HELPER -eq 1 ]]; then
  # Build only the types package, then call electron-forge directly so the
  # `build:deps` chain doesn't re-trigger the helper build.
  run_cmd pnpm --filter @amical/types build
  run_cmd pnpm --filter @amical/desktop exec electron-forge start "${FORGE_ARGS[@]}"
else
  if [[ ${#FORGE_ARGS[@]} -gt 0 ]]; then
    # `pnpm start` doesn't accept arbitrary extra args, so when forge args are
    # provided we run build:deps and then electron-forge ourselves.
    run_cmd pnpm --filter @amical/desktop build:deps
    run_cmd pnpm --filter @amical/desktop exec electron-forge start "${FORGE_ARGS[@]}"
  else
    run_cmd pnpm --filter @amical/desktop start
  fi
fi
