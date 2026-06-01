import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Wrap an arbitrary JSON-serializable payload as an MCP `tools/call` result.
 *
 * We do not declare `outputSchema` on tools (the SDK would otherwise require
 * `structuredContent`) — we instead serialize the result as a single text
 * content block. Claude reliably parses JSON-shaped text content blocks, and
 * this side-steps the SDK's strict structured-output validation.
 */
export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

/**
 * Standard error reply for tool calls. `isError: true` signals to the client
 * (Claude) that the call did not succeed; the text body carries the message.
 */
export function textError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
