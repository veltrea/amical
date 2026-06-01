import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVocabularyTools } from "./vocabulary";
import { registerTranscriptionsTools } from "./transcriptions";
import { registerMisrecCandidateTools } from "./misrec-candidates";

/**
 * Aggregate registration entry point for every Amical MCP tool group.
 *
 * Keeping the indirection lets `services/mcp-server/server.ts` stay
 * agnostic of tool count / shape.
 */
export function registerMcpTools(mcp: McpServer): void {
  registerVocabularyTools(mcp);
  registerTranscriptionsTools(mcp);
  registerMisrecCandidateTools(mcp);
}
