import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type ServerStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "running"; port: number }
  | { state: "error"; message: string };

export default function McpServerSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();

  const configQuery = api.mcpServer.getConfig.useQuery();
  const [showToken, setShowToken] = useState(false);
  // Local-only port input so we can debounce the apply action behind a button.
  // We don't want to thrash the listener with every keystroke.
  const [portDraft, setPortDraft] = useState<string>("");
  const lastSyncedPort = useRef<number | null>(null);

  useEffect(() => {
    const persisted = configQuery.data?.config.port;
    if (persisted !== undefined && persisted !== lastSyncedPort.current) {
      lastSyncedPort.current = persisted;
      setPortDraft(String(persisted));
    }
  }, [configQuery.data?.config.port]);

  const setEnabledMutation = api.mcpServer.setEnabled.useMutation({
    onSuccess: () => {
      utils.mcpServer.getConfig.invalidate();
    },
    onError: (err) => {
      toast.error(
        t("settings.mcpServer.toast.startFailed", { message: err.message }),
      );
      utils.mcpServer.getConfig.invalidate();
    },
  });

  const regenerateTokenMutation = api.mcpServer.regenerateToken.useMutation({
    onSuccess: () => {
      toast.success(t("settings.mcpServer.toast.tokenRegenerated"));
      utils.mcpServer.getConfig.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setPortMutation = api.mcpServer.setPort.useMutation({
    onSuccess: () => {
      utils.mcpServer.getConfig.invalidate();
    },
    onError: (err) => {
      toast.error(
        t("settings.mcpServer.toast.startFailed", { message: err.message }),
      );
      utils.mcpServer.getConfig.invalidate();
    },
  });

  const config = configQuery.data?.config;
  const status: ServerStatus = configQuery.data?.status ?? { state: "stopped" };

  const url = useMemo(() => {
    if (!config) return "";
    return `http://${config.bindAddress}:${config.port}/mcp`;
  }, [config]);

  const claudeCodeSnippet = useMemo(() => {
    if (!config) return "";
    return [
      "claude mcp add amical \\",
      "  --transport http \\",
      `  --url ${url} \\`,
      `  --header "Authorization: Bearer ${config.token}"`,
    ].join("\n");
  }, [config, url]);

  const handleToggle = (checked: boolean) => {
    setEnabledMutation.mutate({ enabled: checked });
  };

  const handleApplyPort = () => {
    const parsed = Number(portDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      toast.error(
        t("settings.mcpServer.toast.startFailed", {
          message: `invalid port: ${portDraft}`,
        }),
      );
      return;
    }
    if (parsed === config?.port) return;
    setPortMutation.mutate({ port: parsed });
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t(`settings.mcpServer.toast.copied`, { what: key }));
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  const statusBadgeText = useMemo(() => {
    switch (status.state) {
      case "running":
        return t("settings.mcpServer.status.enabled");
      case "starting":
        return t("settings.mcpServer.status.starting");
      case "error":
        return t("settings.mcpServer.status.error");
      default:
        return t("settings.mcpServer.status.disabled");
    }
  }, [status, t]);

  const statusBadgeClass = useMemo(() => {
    switch (status.state) {
      case "running":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
      case "starting":
        return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
      case "error":
        return "bg-destructive/15 text-destructive";
      default:
        return "bg-muted text-muted-foreground";
    }
  }, [status]);

  const enabled = config?.enabled ?? false;
  const token = config?.token ?? "";
  const tokenDisplay = showToken ? token : token.replace(/./g, "•");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.mcpServer.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.mcpServer.description")}
        </p>
      </div>

      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{t("settings.mcpServer.warningTitle")}</AlertTitle>
          <AlertDescription>
            {t("settings.mcpServer.warning")}
          </AlertDescription>
        </Alert>

        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.mcpServer.enable")}
                </Label>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass}`}
                  >
                    {statusBadgeText}
                  </span>
                  {status.state === "error" && (
                    <span className="text-xs text-destructive">
                      {status.message}
                    </span>
                  )}
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={setEnabledMutation.isPending || configQuery.isLoading}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-base font-medium text-foreground">
                {t("settings.mcpServer.connection.heading")}
              </Label>

              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <Label className="text-xs text-muted-foreground">
                  {t("settings.mcpServer.connection.url")}
                </Label>
                <Input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(url, "url")}
                  disabled={!url}
                >
                  <Copy className="size-3.5" />
                </Button>

                <Label className="text-xs text-muted-foreground">
                  {t("settings.mcpServer.connection.token")}
                </Label>
                <Input
                  readOnly
                  value={tokenDisplay}
                  onFocus={(e) => {
                    if (showToken) e.currentTarget.select();
                  }}
                  className="font-mono"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowToken((s) => !s)}
                    disabled={!token}
                    aria-label={
                      showToken
                        ? t("settings.mcpServer.connection.hideToken")
                        : t("settings.mcpServer.connection.showToken")
                    }
                  >
                    {showToken ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(token, "token")}
                    disabled={!token}
                    aria-label={t("settings.mcpServer.connection.copyToken")}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.mcpServer.action.changePort")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.mcpServer.action.changePortDescription")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={portDraft}
                  onChange={(e) => setPortDraft(e.target.value)}
                  className="w-28"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApplyPort}
                  disabled={
                    setPortMutation.isPending ||
                    portDraft === "" ||
                    Number(portDraft) === config?.port
                  }
                >
                  {setPortMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    t("settings.mcpServer.action.apply")
                  )}
                </Button>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.mcpServer.action.regenerateToken")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.mcpServer.action.regenerateTokenDescription")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => regenerateTokenMutation.mutate()}
                disabled={regenerateTokenMutation.isPending}
              >
                {regenerateTokenMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium text-foreground">
                {t("settings.mcpServer.claudeCodeExample")}
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(claudeCodeSnippet, "snippet")}
                disabled={!claudeCodeSnippet}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <pre className="bg-muted rounded-md p-3 font-mono text-xs overflow-x-auto whitespace-pre">
              {claudeCodeSnippet ||
                t("settings.mcpServer.claudeCodeExampleLoading")}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
