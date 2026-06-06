/**
 * Pure dock-visibility reconciliation, kept free of any `electron` import so it
 * can be unit-tested in a plain Node/vitest environment. The Electron side
 * effect lives in SettingsService.syncDockVisibility, which calls this to
 * decide whether it actually needs to touch the dock.
 */
export type DockIntent = "show" | "hide" | "noop";

/**
 * Decide how to reconcile the macOS dock with the desired preference.
 *
 * Returns "noop" when the dock is already in the desired state so callers can
 * skip redundant show()/hide() calls. Repeatedly toggling the dock can leave a
 * duplicated/stranded icon (electron#21810); only acting on a real change
 * avoids that.
 */
export function resolveDockIntent(
  showInDock: boolean,
  currentlyVisible: boolean,
): DockIntent {
  if (showInDock === currentlyVisible) {
    return "noop";
  }
  return showInDock ? "show" : "hide";
}
