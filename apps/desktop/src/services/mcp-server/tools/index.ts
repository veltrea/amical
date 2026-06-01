import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVocabularyTools } from "./vocabulary";
import { registerTranscriptionsTools } from "./transcriptions";

/**
 * Aggregate registration entry point for every Amical MCP tool group.
 *
 * Subsequent commits (misrec_candidates) wire their tool registrations
 * into this function. Keeping the indirection lets
 * `services/mcp-server/server.ts` stay agnostic of tool count / shape.
 */
export function registerMcpTools(mcp: McpServer): void {
  registerVocabularyTools(mcp);
  registerTranscriptionsTools(mcp);
}
