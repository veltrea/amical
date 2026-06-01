import { randomBytes } from "node:crypto";

/**
 * Generate a URL-safe Bearer token for MCP server authentication.
 * 24 random bytes encoded as base64url (~32 characters).
 */
export function generateMcpToken(): string {
  return randomBytes(24).toString("base64url");
}

export const DEFAULT_MCP_PORT = 7878;
