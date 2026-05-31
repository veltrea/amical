import { execFileSync } from "node:child_process";
import { app } from "electron";
import { createRouter, procedure } from "../trpc";
import { logger } from "../../main/logger";

/**
 * Bundle identifier this app registers with TCC. Must match the value packaged
 * into Info.plist (`forge.config.ts` -> `packagerConfig.appBundleId`) — both
 * sides must agree or tccutil targets the wrong record.
 */
const BUNDLE_ID = "ai.amical.desktop";

/**
 * Argument the relaunched instance reads to know it should pop a fresh
 * permission dialog right after startup. Stay in sync with
 * `apps/desktop/src/main/permissions-bootstrap.ts`.
 */
const PROMPT_PERMISSIONS_ARG = "--prompt-permissions";

/**
 * Synchronously runs `tccutil reset <service> <bundleId>`. The command exists
 * on every modern macOS (15+) and is invokable as the user (no root needed).
 * We swallow errors per service so a missing record on one category does not
 * block the repair flow on the other.
 */
function tccutilReset(service: "Accessibility" | "Microphone"): void {
  try {
    execFileSync("/usr/bin/tccutil", ["reset", service, BUNDLE_ID], {
      stdio: "pipe",
    });
    logger.main.info("[permissions.repair] tccutil reset succeeded", {
      service,
      bundleId: BUNDLE_ID,
    });
  } catch (err) {
    logger.main.error("[permissions.repair] tccutil reset failed", {
      service,
      bundleId: BUNDLE_ID,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const permissionsRouter = createRouter({
  /**
   * Repair button entry point.
   *
   * Mirrors the FloatingMacro pattern documented in
   * `/Volumes/DISK/dev/knowledge/macos_accessibility_permission.md`:
   *
   *   1. tccutil reset for Accessibility and Microphone, clearing every
   *      stale entry (including silent-revoke records left behind when the
   *      ad-hoc signed cdHash changed between rebuilds).
   *   2. Schedule a relaunch of this process with PROMPT_PERMISSIONS_ARG.
   *   3. Exit the current process immediately so the relaunch fires.
   *
   * The next instance's startup hook (see `permissions-bootstrap.ts`) reads
   * the arg and pops a fresh `AXIsProcessTrustedWithOptions(prompt: true)` +
   * `systemPreferences.askForMediaAccess('microphone')` so the OS shows a
   * clean dialog instead of a no-op against a stale toggle.
   */
  repair: procedure.mutation(async () => {
    if (process.platform !== "darwin") {
      throw new Error(
        "permissions.repair is only supported on macOS (TCC-specific)",
      );
    }

    tccutilReset("Accessibility");
    tccutilReset("Microphone");

    const argv = process.argv.slice(1).filter((a) => a !== PROMPT_PERMISSIONS_ARG);
    argv.push(PROMPT_PERMISSIONS_ARG);

    logger.main.info(
      "[permissions.repair] scheduling relaunch with prompt arg",
      { argv },
    );
    app.relaunch({ args: argv });
    app.exit(0);

    return { relaunching: true };
  }),
});
