import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Aggregate registration entry point for every Amical MCP tool group.
 *
 * Subsequent commits (vocabulary, transcriptions, misrec_candidates) wire
 * their tool registrations into this function. Keeping the indirection lets
 * `services/mcp-server/server.ts` stay agnostic of tool count / shape.
 */
export function registerMcpTools(_mcp: McpServer): void {
  // intentionally empty in commit 1 — see SPEC §9
}
