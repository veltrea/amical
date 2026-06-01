import { createFileRoute } from "@tanstack/react-router";
import McpServerSettingsPage from "../../../pages/settings/mcp-server";

export const Route = createFileRoute("/_app/settings/mcp-server")({
  component: McpServerSettingsPage,
});
