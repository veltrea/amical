import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, procedure } from "../trpc";

export const mcpServerRouter = createRouter({
  /**
   * Returns the persisted MCP server config plus the live runtime status.
   * Used by the settings UI to render the URL, token, port, and the
   * enabled / running indicator.
   */
  getConfig: procedure.query(async ({ ctx }) => {
    const mcp = ctx.serviceManager.getService("mcpServer");
    const config = await mcp.getConfig();
    const status = mcp.getStatus();
    return { config, status };
  }),

  /**
   * Toggle the server on/off. Persists the setting and starts/stops the
   * HTTP listener immediately. Returns the new status so the UI can update
   * the running indicator without an extra round trip.
   */
  setEnabled: procedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const mcp = ctx.serviceManager.getService("mcpServer");
      const status = await mcp.setEnabled(input.enabled);
      if (status.state === "error") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: status.message,
        });
      }
      return { status };
    }),

  /**
   * Regenerate the bearer token. Existing connected clients lose access
   * immediately (the server restarts under the hood when it was running).
   */
  regenerateToken: procedure.mutation(async ({ ctx }) => {
    const mcp = ctx.serviceManager.getService("mcpServer");
    const config = await mcp.regenerateToken();
    return { token: config.token };
  }),

  /**
   * Change the listening port. Restarts the server if it was running. The
   * UI keeps the port input local-only until the user explicitly applies,
   * so this is always a "save" action — debouncing would risk thrashing
   * the listener.
   */
  setPort: procedure
    .input(z.object({ port: z.number().int().min(1).max(65535) }))
    .mutation(async ({ ctx, input }) => {
      const mcp = ctx.serviceManager.getService("mcpServer");
      const status = await mcp.setPort(input.port);
      if (status.state === "error") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: status.message,
        });
      }
      return { status };
    }),
});
