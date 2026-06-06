import { createRouter, procedure } from "../trpc";
import { runAccessibilityRepair } from "../../main/accessibility-repair";

export const permissionsRouter = createRouter({
  /**
   * Repair button entry point (Settings → Advanced → Permissions).
   *
   * Delegates to the shared `runAccessibilityRepair()` so this tRPC procedure
   * and the startup `silent-revoke-guard` dialog use one identical
   * implementation (tccutil reset → relaunch with prompt arg → exit). See
   * `apps/desktop/src/main/accessibility-repair.ts`.
   *
   * `runAccessibilityRepair()` calls `app.exit(0)` and never returns, so the
   * `{ relaunching: true }` below exists only to satisfy the mutation's return
   * type — it is effectively unreachable.
   */
  repair: procedure.mutation(async () => {
    runAccessibilityRepair();
    return { relaunching: true };
  }),
});
