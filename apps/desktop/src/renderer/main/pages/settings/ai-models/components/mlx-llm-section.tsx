"use client";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Trash2, Loader2, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MlxMemoryStrategy } from "@/types/formatter";

/**
 * Download/manage on-device MLX proofreading LLMs: one-click recommended presets
 * plus an "any Hugging Face repo" field. Downloaded models also appear in the
 * shared SyncedModelsList (they're DB-tracked language models), which handles
 * default-selection and deletion; this section focuses on acquiring models.
 *
 * macOS-only at runtime — the download mutation rejects on other platforms — but
 * the presets list still renders so the feature is discoverable.
 */
export default function MlxLlmSection() {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [customRepo, setCustomRepo] = useState("");

  const recommendedQuery = api.models.getRecommendedMlxLlms.useQuery();
  const downloadedQuery = api.models.getDownloadedMlxLlms.useQuery();

  const invalidate = () => {
    utils.models.getDownloadedMlxLlms.invalidate();
    utils.models.getSyncedProviderModels.invalidate();
  };

  const downloadMutation = api.models.downloadMlxLlm.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.aiModels.mlx.toast.downloaded"));
    },
    onError: (e) => toast.error(e.message),
  });

  const downloadUrlMutation = api.models.downloadMlxLlmFromUrl.useMutation({
    onSuccess: () => {
      invalidate();
      setCustomRepo("");
      toast.success(t("settings.aiModels.mlx.toast.downloaded"));
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = api.models.deleteMlxLlm.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.aiModels.mlx.toast.removed"));
    },
    onError: (e) => toast.error(e.message),
  });

  const downloadedIds = new Set((downloadedQuery.data ?? []).map((m) => m.id));
  const anyBusy = downloadMutation.isPending || downloadUrlMutation.isPending;

  // Memory strategy lives in the shared FormatterConfig (it governs the proofread
  // LLM's residency). Read/update it here so the control sits next to the models.
  const formatterConfigQuery = api.settings.getFormatterConfig.useQuery();
  const setFormatterConfig = api.settings.setFormatterConfig.useMutation({
    onSuccess: () => utils.settings.getFormatterConfig.invalidate(),
  });
  const memoryStrategy: MlxMemoryStrategy =
    formatterConfigQuery.data?.mlxMemoryStrategy ?? "balanced";
  const onStrategyChange = (value: string) => {
    const cfg = formatterConfigQuery.data;
    // Spread to preserve fields not owned by this control (userInstructions, …).
    setFormatterConfig.mutate({
      ...(cfg ?? {}),
      enabled: cfg?.enabled ?? false,
      mlxMemoryStrategy: value as MlxMemoryStrategy,
    });
  };

  const submitCustom = () => {
    if (customRepo.trim() && !anyBusy) {
      downloadUrlMutation.mutate({ url: customRepo.trim() });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-lg font-semibold block">
          {t("settings.aiModels.mlx.title")}
        </Label>
        <p className="text-sm text-muted-foreground">
          {t("settings.aiModels.mlx.description")}
        </p>
      </div>

      {/* Recommended presets — one-click download */}
      <div className="space-y-2">
        {(recommendedQuery.data ?? []).map((m) => {
          const installed = downloadedIds.has(m.id);
          const downloadingThis =
            downloadMutation.isPending &&
            downloadMutation.variables?.repoId === m.id;
          return (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{m.name}</div>
                  {m.languages?.map((lang) => (
                    <Badge
                      key={lang}
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 uppercase"
                    >
                      {lang}
                    </Badge>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.description}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {m.id} · {m.sizeFormatted}
                </div>
              </div>
              {installed ? (
                <div className="flex items-center gap-2 shrink-0">
                  <Check className="w-4 h-4 text-green-500" />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate({ repoId: m.id })}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() =>
                    downloadMutation.mutate({
                      repoId: m.id,
                      name: m.name,
                      sizeBytes: m.sizeBytes,
                    })
                  }
                  disabled={anyBusy}
                >
                  {downloadingThis ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {t("settings.aiModels.mlx.download")}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom Hugging Face repo */}
      <div className="space-y-2">
        <Label className="text-sm font-medium block">
          {t("settings.aiModels.mlx.customLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            placeholder={t("settings.aiModels.mlx.customPlaceholder")}
            value={customRepo}
            onChange={(e) => setCustomRepo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCustom();
            }}
          />
          <Button
            variant="outline"
            className="shrink-0"
            onClick={submitCustom}
            disabled={anyBusy || !customRepo.trim()}
          >
            {downloadUrlMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {t("settings.aiModels.mlx.add")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.aiModels.mlx.customHint")}
        </p>
      </div>

      {/* Memory strategy */}
      <div className="space-y-2">
        <Label className="text-sm font-medium block">
          {t("settings.aiModels.mlx.memoryLabel")}
        </Label>
        <Select value={memoryStrategy} onValueChange={onStrategyChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="balanced">
              {t("settings.aiModels.mlx.memory.balanced")}
            </SelectItem>
            <SelectItem value="fast">
              {t("settings.aiModels.mlx.memory.fast")}
            </SelectItem>
            <SelectItem value="low">
              {t("settings.aiModels.mlx.memory.low")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("settings.aiModels.mlx.memoryHint")}
        </p>
      </div>
    </div>
  );
}
