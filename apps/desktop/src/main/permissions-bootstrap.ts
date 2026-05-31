import { systemPreferences } from "electron";
import { logger } from "./logger";
import { ServiceManager } from "./managers/service-manager";

/**
 * CLI arg the repair flow uses to signal "this instance was just relaunched
 * after a tccutil reset; pop fresh permission dialogs now". Stay in sync with
 * `apps/desktop/src/trpc/routers/permissions.ts`.
 */
export const PROMPT_PERMISSIONS_ARG = "--prompt-permissions";

/**
 * If this process was launched with PROMPT_PERMISSIONS_ARG, fire the OS-level
 * permission prompts for Accessibility (via SwiftHelper -> AXIsProcessTrusted
 * WithOptions(prompt:true)) and Microphone (via systemPreferences.askFor
 * MediaAccess). Both are no-ops if permissions are already granted.
 *
 * Why this lives in its own file instead of inline in `main.ts`: the prompts
 * MUST run AFTER `AppManager.initialize()` completes, because SwiftHelper is
 * spawned and reachable only by then. Mixing this into main.ts would push the
 * single-instance / deep-link / IPC bootstrap further away from the top.
 */
export async function maybePromptForRevokedPermissions(): Promise<void> {
  if (process.platform !== "darwin") return;
  if (!process.argv.includes(PROMPT_PERMISSIONS_ARG)) return;

  logger.main.info(
    "[permissions-bootstrap] PROMPT_PERMISSIONS_ARG detected, requesting fresh permissions",
  );

  // Accessibility: dispatch via SwiftHelper since it is the process that
  // actually needs AX access. NativeBridge sits inside ServiceManager and is
  // already started by the time this hook fires.
  try {
    const nativeBridge = ServiceManager.getInstance().getService(
      "nativeBridge",
    );
    const result = await nativeBridge.requestAccessibilityPermission();
    logger.main.info(
      "[permissions-bootstrap] accessibility prompt dispatched",
      { result },
    );
  } catch (err) {
    logger.main.error("[permissions-bootstrap] accessibility prompt failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Microphone: Electron has a first-class API for this; using it instead of
  // navigator.mediaDevices keeps the prompt in the main process (no renderer
  // needs to be already alive).
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
