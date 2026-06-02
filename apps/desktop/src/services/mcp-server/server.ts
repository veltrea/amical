import { createServer, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "../../main/logger";
import type { SettingsService } from "../settings-service";
import { generateMcpToken, DEFAULT_MCP_PORT } from "./token";

export interface McpServerConfig {
  enabled: boolean;
  port: number;
  token: string;
  bindAddress: "127.0.0.1";
}

export type McpServerStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "running"; port: number }
  | { state: "error"; message: string };

const MCP_ENDPOINT = "/mcp";

/**
 * Manages the local HTTP MCP server lifecycle. Tool registration happens via
 * the optional `registerTools` callback so feature commits (vocabulary,
 * transcriptions) can attach their own tools without this
 * module needing to know about them.
 */
export class AmicalMcpServer {
  private httpServer: HttpServer | null = null;
  private status: McpServerStatus = { state: "stopped" };
  private currentToken: string = "";
  private currentPort: number = DEFAULT_MCP_PORT;
  private registerTools?: (mcp: McpServer) => void;

  constructor(
    private readonly settingsService: SettingsService,
    options: { registerTools?: (mcp: McpServer) => void } = {},
  ) {
    this.registerTools = options.registerTools;
  }

  getStatus(): McpServerStatus {
    return this.status;
  }

  /**
   * Read the persisted MCP config from app_settings, materializing defaults
   * (and a freshly generated token) on first access. Does NOT auto-start the
   * server even if `enabled` is true — callers control lifecycle.
   */
  async ensureConfig(): Promise<McpServerConfig> {
    const settings = await this.settingsService.getAllSettings();
    const existing = settings.mcpServer;
    if (
      existing &&
      typeof existing.enabled === "boolean" &&
      typeof existing.port === "number" &&
      typeof existing.token === "string" &&
      existing.token.length > 0
    ) {
      return existing;
    }
    const fresh: McpServerConfig = {
      enabled: existing?.enabled ?? false,
      port: existing?.port ?? DEFAULT_MCP_PORT,
      token: existing?.token && existing.token.length > 0
        ? existing.token
        : generateMcpToken(),
      bindAddress: "127.0.0.1",
    };
    await this.settingsService.updateSettings({ mcpServer: fresh });
    return fresh;
  }

  async getConfig(): Promise<McpServerConfig> {
    return await this.ensureConfig();
  }

  /**
   * Start the HTTP server. Honors persisted enabled flag — if disabled, this
   * is a no-op (returns status: stopped). Caller wanting to force-start (e.g.
   * after a toggle ON in the UI) should call `setEnabled(true)` instead.
   */
  async startIfEnabled(): Promise<McpServerStatus> {
    const config = await this.ensureConfig();
    if (!config.enabled) {
      this.status = { state: "stopped" };
      return this.status;
    }
    return await this.start(config);
  }

  private async start(config: McpServerConfig): Promise<McpServerStatus> {
    if (this.httpServer) {
      logger.main.warn("[mcp] start called but server is already running");
      return this.status;
    }
    this.status = { state: "starting" };
    this.currentToken = config.token;
    this.currentPort = config.port;

    const mcp = new McpServer({ name: "amical", version: "1.0.0" });
    this.registerTools?.(mcp);

    const httpServer = createServer(async (req, res) => {
      try {
        // Bearer auth — required on ALL requests including OPTIONS preflight.
        const auth = req.headers["authorization"];
        if (auth !== `Bearer ${this.currentToken}`) {
          res.statusCode = 401;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        if (req.url !== MCP_ENDPOINT) {
          res.statusCode = 404;
          res.end();
          return;
        }
        // Stateless: new transport per request.
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        // Closing transport on response close prevents handle leaks.
        res.on("close", () => {
          void transport.close().catch(() => undefined);
        });
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.main.error("[mcp] request handler error", { error });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "internal_error" }));
        } else {
          res.end();
        }
      }
    });

    return await new Promise<McpServerStatus>((resolve) => {
      const onError = (err: Error) => {
        this.status = { state: "error", message: err.message };
        this.httpServer = null;
        logger.main.error("[mcp] http server failed to start", { error: err });
        resolve(this.status);
      };
      httpServer.once("error", onError);
      httpServer.listen(config.port, config.bindAddress, () => {
        httpServer.off("error", onError);
        this.httpServer = httpServer;
        this.status = { state: "running", port: config.port };
        logger.main.info("[mcp] http server listening", {
          port: config.port,
          bindAddress: config.bindAddress,
        });
        resolve(this.status);
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = null;
    this.status = { state: "stopped" };
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          logger.main.warn("[mcp] http server close error", { error: err });
        } else {
          logger.main.info("[mcp] http server stopped");
        }
        resolve();
      });
      // Force close idle sockets so we don't hang on shutdown.
      server.closeAllConnections?.();
    });
  }

  /** Enable / disable + persist. Starts or stops the server accordingly. */
  async setEnabled(enabled: boolean): Promise<McpServerStatus> {
    const current = await this.ensureConfig();
    const next: McpServerConfig = { ...current, enabled };
    await this.settingsService.updateSettings({ mcpServer: next });
    if (!enabled) {
      await this.stop();
      return this.status;
    }
    // already running with same port/token? no-op
    if (this.status.state === "running") return this.status;
    return await this.start(next);
  }

  async regenerateToken(): Promise<McpServerConfig> {
    const current = await this.ensureConfig();
    const next: McpServerConfig = { ...current, token: generateMcpToken() };
    await this.settingsService.updateSettings({ mcpServer: next });
    // If running, restart so old token is invalidated.
    if (this.status.state === "running") {
      await this.stop();
      await this.start(next);
    } else {
      this.currentToken = next.token;
    }
    return next;
  }

  async setPort(port: number): Promise<McpServerStatus> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid port: ${port}`);
    }
    const current = await this.ensureConfig();
    const next: McpServerConfig = { ...current, port };
    await this.settingsService.updateSettings({ mcpServer: next });
    if (this.status.state === "running") {
      await this.stop();
      return await this.start(next);
    }
    return this.status;
  }
}
