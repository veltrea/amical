import { shell, systemPreferences } from "electron";
import { logger } from "./logger";

/**
 * CLI arg the repair flow uses to signal "this instance was just relaunched
 * after a tccutil reset; help the user re-grant now". Defined in the shared
 * repair module; re-exported here for backwards compatibility.
 */
import { PROMPT_PERMISSIONS_ARG } from "./accessibility-repair";
export { PROMPT_PERMISSIONS_ARG };

/**
 * If this process was launched with PROMPT_PERMISSIONS_ARG (i.e. right after a
 * permissions repair cleared the stale TCC entries), help the user re-grant.
 *
 * Accessibility: open System Settings → Accessibility DIRECTLY. We deliberately
 * do NOT fire `AXIsProcessTrustedWithOptions(prompt:true)`: once the user has
 * already chosen "Repair", the OS "Amical wants to control this computer
 * [Open System Settings] [Deny]" prompt is a redundant extra screen. The app
 * re-appears in the Accessibility list (toggled off) from the AX checks it makes
 * on startup, so the user just flips the switch in the pane we opened.
 *
 * Microphone: re-prompt via the first-class Electron API (a no-op if mic access
 * is still granted; otherwise the standard, non-intrusive mic prompt).
 *
 * Why this lives in its own file instead of inline in `main.ts`: it must run
 * AFTER `AppManager.initialize()` completes (services up), which would otherwise
 * push the single-instance / deep-link / IPC bootstrap further from the top.
 */
export async function maybePromptForRevokedPermissions(): Promise<void> {
  if (process.platform !== "darwin") return;
  if (!process.argv.includes(PROMPT_PERMISSIONS_ARG)) return;

  logger.main.info(
    "[permissions-bootstrap] PROMPT_PERMISSIONS_ARG detected, guiding re-grant",
  );

  // Accessibility: send the user straight to the System Settings pane instead
  // of popping the OS "wants to control" dialog (redundant post-repair).
  try {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    logger.main.info(
      "[permissions-bootstrap] opened System Settings → Accessibility",
    );
  } catch (err) {
    logger.main.error(
      "[permissions-bootstrap] failed to open Accessibility settings",
      { error: err instanceof Error ? err.message : String(err) },
    );
  }

  // Microphone: Electron has a first-class API for this; using it instead of
  // navigator.mediaDevices keeps the prompt in the main process (no renderer
  // needs to be already alive). No-op if mic access is still granted.
  try {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    logger.main.info("[permissions-bootstrap] microphone prompt dispatched", {
      granted,
    });
  } catch (err) {
    logger.main.error("[permissions-bootstrap] microphone prompt failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
