#!/usr/bin/env tsx
/**
 * Minimal MCP HTTP smoketest.
 *
 * Spins up just enough of the AmicalMcpServer machinery to exercise the
 * Streamable HTTP transport + bearer-token auth + tools/list end-to-end,
 * without standing up the whole Electron app. Lets us verify the wire
 * protocol from curl without rebuilding the .app on every change.
 *
 * Usage:
 *   pnpm exec tsx scripts/mcp-smoketest.ts
 *   # then in another shell:
 *   curl -s -X POST http://127.0.0.1:7878/mcp \
 *     -H "Authorization: Bearer $TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -H "Accept: application/json, text/event-stream" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
 */

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const token = process.env.MCP_TOKEN || randomBytes(24).toString("base64url");
const port = Number(process.env.MCP_PORT || 7878);

const mcp = new McpServer({ name: "amical-smoketest", version: "1.0.0" });
mcp.registerTool(
  "echo",
  {
    description: "Echo back its input.",
    inputSchema: { message: z.string() },
  },
  async (input) => ({
    content: [{ type: "text", text: JSON.stringify({ echoed: input.message }) }],
  }),
);

const http = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (req.url !== "/mcp") {
    res.statusCode = 404;
    res.end();
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => void transport.close().catch(() => undefined));
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
});

http.listen(port, "127.0.0.1", () => {
  console.log(`MCP smoketest listening on http://127.0.0.1:${port}/mcp`);
  console.log(`MCP_TOKEN=${token}`);
});
