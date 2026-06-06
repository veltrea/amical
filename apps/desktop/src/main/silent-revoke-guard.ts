import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, systemPreferences } from "electron";
import { logger } from "./logger";
import { ServiceManager } from "./managers/service-manager";
import { initMainI18n } from "../i18n/main";
import {
  PROMPT_PERMISSIONS_ARG,
  runAccessibilityRepair,
} from "./accessibility-repair";

/**
 * Guard for the macOS "silent revoke" state: the System Settings accessibility
 * toggle looks ON, but access is actually dead. This happens to ad-hoc-signed
 * apps whenever the cdHash changes on rebuild/update, leaving the onboarding
 * permission screen stuck (the user "already allowed it", yet nothing works).
 *
 * The repair (`runAccessibilityRepair`) is also reachable from Settings →
 * Advanced, but a stuck user never gets past onboarding to reach it. So we offer
 * the same repair from the main process — the upstream onboarding renderer is
 * left untouched, which keeps upstream syncs clean.
 *
 * ── Trigger: the onboarding "Open Settings" button (not a startup auto-popup)
 *
 * When the user clicks "Open Settings" on the onboarding permission screen, the
 * renderer calls the `onboarding.openExternal` tRPC mutation; its handler invokes
 * `offerRepairIfSilentRevoke()` after opening System Settings. So the repair
 * dialog appears as a follow-up to the user's own action (they tried the normal
 * path, hit the on-but-dead toggle), rather than ambushing them at launch.
 *
 * ── Detection (and why it is NOT the AX-probe from the knowledge file)
 *
 * The knowledge file (FloatingMacro) detects via "AXIsProcessTrusted returns a
 * stale TRUE, but an AX probe returns .apiDisabled". That needs a process that
 * was trusted while running when the cdHash changed. Amical's helper/main are
 * freshly spawned each launch, so a mismatched cdHash yields an honest FALSE —
 * the stale-TRUE window never occurs (verified on-device). Instead we detect
 * "not trusted now AND granted before", inferring "granted before" from either:
 *   - a persisted cdHash from a launch where we WERE trusted (later mismatch ⇒
 *     the binary changed since the grant), or
 *   - onboarding having been completed (its Continue button is gated on the
 *     grant, so completion proves a prior grant even on the first upgrade from a
 *     pre-guard version, when no cdHash baseline exists yet).
 * Exclusion: a persisted grant cdHash equal to the current one means the user
 * toggled it off under the same binary (deliberate revoke, not an update) — skip.
 */

/** Pause after opening System Settings before the repair dialog is pulled to the front. */
const SETTINGS_SETTLE_MS = 2000;

interface GuardState {
  /** cdHash of the app the last time accessibility was observed as granted. */
  grantedCdHash?: string;
}

function stateFilePath(): string {
  return join(app.getPath("userData"), "silent-revoke-state.json");
}

function readState(): GuardState {
  try {
    return JSON.parse(readFileSync(stateFilePath(), "utf8")) as GuardState;
  } catch {
    return {};
  }
}

function writeState(state: GuardState): void {
  try {
    writeFileSync(stateFilePath(), JSON.stringify(state), "utf8");
  } catch (err) {
    logger.main.error("[silent-revoke-guard] failed to persist state", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read this app bundle's code-signing cdHash. For ad-hoc signed apps TCC anchors
 * accessibility grants on this hash, so it changes on every rebuild/update —
 * exactly the silent-revoke trigger. Returns null if codesign is unavailable or
 * the output can't be parsed (callers then skip detection rather than guess).
 */
function getAppCdHash(): string | null {
  try {
    const exe = app.getPath("exe");
    // codesign writes the verbose dump to stderr; capture both streams.
    const r = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", exe], {
      encoding: "utf8",
    });
    const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    // The real hash is the line that begins exactly with "CDHash=" — the
    // "CandidateCDHash"/"CandidateCDHashFull" lines start with "Candidate".
    const match = text.match(/^CDHash=([0-9a-f]+)/m);
    return match ? match[1] : null;
  } catch (err) {
    logger.main.error("[silent-revoke-guard] codesign failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function isAccessibilityTrusted(): boolean {
  try {
    return systemPreferences.isTrustedAccessibilityClient(false);
  } catch (err) {
    logger.main.error("[silent-revoke-guard] trust check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Has the user completed onboarding at least once? The onboarding flow's
 * Continue button is disabled until accessibility is granted, so a completed
 * onboarding is proof that accessibility was granted at some point — even on an
 * upgrade from a version that never recorded a cdHash. Degrades to false (no
 * dialog) if the state can't be read, so a read failure never causes a spurious
 * prompt.
 */
async function wasOnboardingCompleted(): Promise<boolean> {
  try {
    const onboardingService =
      ServiceManager.getInstance().getService("onboardingService");
    const state = await onboardingService.getOnboardingState();
    return state?.completedVersion ? state.completedVersion >= 1 : false;
  } catch (err) {
    logger.main.error("[silent-revoke-guard] failed to read onboarding state", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Watch for accessibility becoming trusted during this session (e.g. the user
 * grants it on the onboarding screen, or via System Settings after a repair) and
 * persist the current cdHash the moment it does. Without this, the cdHash would
 * only be recorded on a *later* launch, so a "grant then update before relaunch"
 * sequence would slip past detection. Bounded so it never lingers.
 */
function armGrantRecorder(): void {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    if (isAccessibilityTrusted()) {
      const cdHash = getAppCdHash();
      if (cdHash) {
        writeState({ grantedCdHash: cdHash });
        logger.main.info(
          "[silent-revoke-guard] recorded granted cdHash (in-session)",
          { cdHash },
        );
      }
      clearInterval(timer);
      return;
    }
    // ~5 min cap (100 × 3s): long enough to cover onboarding, then give up.
    if (ticks >= 100) clearInterval(timer);
  }, 3000);
  // Don't keep the process alive just for this watcher.
  timer.unref?.();
}

/**
 * Startup hook: keep the cdHash baseline current. If trusted, record the cdHash
 * the grant works under (so a later mismatch is detectable). If not trusted yet,
 * arm the recorder to capture the grant whenever it lands this session. Never
 * shows UI — the repair dialog is offered from `offerRepairIfSilentRevoke()`.
 */
export function trackAccessibilityGrantState(): void {
  if (process.platform !== "darwin") return;

  if (isAccessibilityTrusted()) {
    const cdHash = getAppCdHash();
    const state = readState();
    if (cdHash && state.grantedCdHash !== cdHash) {
      writeState({ grantedCdHash: cdHash });
      logger.main.info("[silent-revoke-guard] recorded granted cdHash", {
        cdHash,
      });
    }
    return;
  }

  armGrantRecorder();
}

/** Compute (and log) whether we are in the silent-revoke state right now. */
async function isSilentRevoke(): Promise<boolean> {
  if (isAccessibilityTrusted()) return false;

  const state = readState();
  const currentCdHash = getAppCdHash();
  const hadCdHashBaseline = !!state.grantedCdHash;
  const completedOnboarding = await wasOnboardingCompleted();
  const wasGrantedBefore = hadCdHashBaseline || completedOnboarding;
  // A persisted grant cdHash equal to the current one ⇒ toggled off under the
  // same binary (deliberate revoke, not an update). Only decidable with a baseline.
  const manualRevokeSameBuild =
    hadCdHashBaseline &&
    !!currentCdHash &&
    state.grantedCdHash === currentCdHash;
  const silentRevoke = wasGrantedBefore && !manualRevokeSameBuild;

  logger.main.info("[silent-revoke-guard] silent-revoke check", {
    currentCdHash,
    grantedCdHash: state.grantedCdHash ?? null,
    completedOnboarding,
    manualRevokeSameBuild,
    silentRevoke,
  });
  return silentRevoke;
}

/** Build a translator for the user's UI locale (menu/tray pattern). */
async function getTranslator(): Promise<((key: string) => string) | null> {
  try {
    const settingsService =
      ServiceManager.getInstance().getService("settingsService");
    const uiSettings = await settingsService.getUISettings();
    const locale = uiSettings.locale ?? app.getLocale();
    const i18n = await initMainI18n(locale);
    return i18n.t.bind(i18n);
  } catch (err) {
    logger.main.error("[silent-revoke-guard] failed to init i18n", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** The window to anchor the dialog to: onboarding if present, else main. */
function getDialogHostWindow(): BrowserWindow | null {
  try {
    const wm = ServiceManager.getInstance().getService("windowManager");
    const onboarding = wm.getOnboardingWindow();
    if (onboarding && !onboarding.isDestroyed()) return onboarding;
    const main = wm.getMainWindow();
    if (main && !main.isDestroyed()) return main;
  } catch (err) {
    logger.main.error("[silent-revoke-guard] window lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

let repairDialogOpen = false;

/**
 * Offer the repair dialog IF we are silently revoked. Called right after the
 * onboarding "Open Settings" button sends the user to System Settings, so the
 * dialog lands as a follow-up to their action. Opening System Settings pulls it
 * frontmost, so we wait a beat then bring Amical forward to ensure the dialog is
 * actually seen rather than hidden behind Settings.
 */
export async function offerRepairIfSilentRevoke(): Promise<void> {
  if (process.platform !== "darwin") return;
  // Right after a repair relaunch the user is already being guided to re-grant;
  // don't re-offer (which would loop the repair).
  if (process.argv.includes(PROMPT_PERMISSIONS_ARG)) return;
  if (repairDialogOpen) return;

  if (!(await isSilentRevoke())) return;

  const t = await getTranslator();
  if (!t) return;

  repairDialogOpen = true;
  try {
    // Let System Settings come to the front, then pull Amical forward so the
    // dialog appears on top of it instead of behind it.
    await new Promise((r) => setTimeout(r, SETTINGS_SETTLE_MS));
    app.focus({ steal: true });
    const host = getDialogHostWindow();
    if (host && !host.isDestroyed()) {
      if (!host.isVisible()) host.show();
      host.focus();
    }

    const prefix = "settings.advanced.permissions.silentRevoke";
    const options = {
      type: "warning" as const,
      title: t(`${prefix}.title`),
      message: t(`${prefix}.message`),
      detail: t(`${prefix}.detail`),
      buttons: [t(`${prefix}.buttons.repair`), t(`${prefix}.buttons.later`)],
      defaultId: 0,
      cancelId: 1,
    };
    const result =
      host && !host.isDestroyed()
        ? await dialog.showMessageBox(host, options)
        : await dialog.showMessageBox(options);

    if (result.response === 0) {
      logger.main.info("[silent-revoke-guard] user chose repair");
      runAccessibilityRepair(); // tccutil reset → relaunch → exit (does not return)
    } else {
      logger.main.info("[silent-revoke-guard] user dismissed repair");
    }
  } finally {
    repairDialogOpen = false;
  }
}
