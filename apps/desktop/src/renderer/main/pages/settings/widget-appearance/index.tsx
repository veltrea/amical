import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/trpc/react";
import {
  DEFAULT_WIDGET_APPEARANCE,
  WIDGET_APPEARANCE_PRESETS,
  WIDGET_APPEARANCE_CUSTOM_PRESET,
  matchPreset,
  isValidHexColor,
  type WidgetAppearance,
  type WidgetAppearancePreset,
} from "@/constants/widget-appearance";

const SAVE_DEBOUNCE_MS = 250;
const PREVIEW_BAR_HEIGHTS = [40, 70, 100, 60, 32];

// Checkerboard backdrop so a translucent color's alpha is visible in swatches.
const checkerStyle: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #bbb 25%, transparent 25%), linear-gradient(-45deg, #bbb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #bbb 75%), linear-gradient(-45deg, transparent 75%, #bbb 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
};

/** A miniature, non-interactive rendering of the HUD using the given colors. */
function HudPreview({
  appearance,
  className = "",
  barWidth = "w-1.5",
}: {
  appearance: WidgetAppearance;
  className?: string;
  barWidth?: string;
}) {
  return (
    <div
      className={`flex items-end justify-center gap-1 rounded-[24px] backdrop-blur-md ${className}`}
      style={{
        background: appearance.background,
        boxShadow: `0 0 0 1.5px ${appearance.border}, 0px 0px 15px 0px rgba(0,0,0,0.40)`,
      }}
    >
      {PREVIEW_BAR_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className={`${barWidth} rounded-full`}
          style={{ height: `${h}%`, backgroundColor: appearance.accent }}
        />
      ))}
    </div>
  );
}

/** Label + swatch that opens a color picker popover. */
function ColorField({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-base font-medium text-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="relative h-8 w-16 overflow-hidden rounded-md border border-border shadow-sm"
            style={checkerStyle}
          >
            <span
              className="absolute inset-0"
              style={{ backgroundColor: color }}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-3">
          <HexAlphaColorPicker color={color} onChange={onChange} />
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">#</span>
            <HexColorInput
              color={color}
              onChange={onChange}
              alpha
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm uppercase outline-none focus:ring-1 focus:ring-ring"
              aria-label={label}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function WidgetAppearanceSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const appearanceQuery = api.settings.getWidgetAppearance.useQuery();
  const updateMutation = api.settings.updateWidgetAppearance.useMutation({
    onSuccess: () => {
      utils.settings.getWidgetAppearance.invalidate();
    },
    onError: (error) => {
      console.error("Failed to update widget appearance:", error);
      toast.error(t("settings.widgetAppearance.toast.updateFailed"));
    },
  });

  const [draft, setDraft] = useState<WidgetAppearance>(
    DEFAULT_WIDGET_APPEARANCE,
  );
  const initializedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the editor from persisted settings once, then keep local edits.
  useEffect(() => {
    if (appearanceQuery.data && !initializedRef.current) {
      setDraft(appearanceQuery.data);
      initializedRef.current = true;
    }
  }, [appearanceQuery.data]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const scheduleSave = (next: WidgetAppearance) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateMutation.mutate(next);
    }, SAVE_DEBOUNCE_MS);
  };

  const applyAppearance = (next: WidgetAppearance) => {
    setDraft(next);
    scheduleSave(next);
  };

  const handleColorChange = (
    key: "background" | "accent" | "border",
    value: string,
  ) => {
    if (!isValidHexColor(value)) {
      // react-colorful can emit partial values mid-edit; keep them visible for
      // responsiveness but don't persist an invalid color.
      setDraft((prev) => ({
        ...prev,
        [key]: value,
        preset: WIDGET_APPEARANCE_CUSTOM_PRESET,
      }));
      return;
    }
    const merged = { ...draft, [key]: value };
    applyAppearance({ ...merged, preset: matchPreset(merged) });
  };

  const handlePresetSelect = (preset: WidgetAppearancePreset) => {
    applyAppearance({
      preset: preset.id,
      background: preset.background,
      accent: preset.accent,
      border: preset.border,
    });
  };

  const handleReset = () => {
    applyAppearance({ ...DEFAULT_WIDGET_APPEARANCE });
    toast.success(t("settings.widgetAppearance.toast.reset"));
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">
            {t("settings.widgetAppearance.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("settings.widgetAppearance.description")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleReset}>
          {t("settings.widgetAppearance.reset")}
        </Button>
      </div>

      <div className="space-y-6">
        {/* Live preview */}
        <Card>
          <CardContent>
            <Label className="text-base font-medium text-foreground">
              {t("settings.widgetAppearance.preview")}
            </Label>
            <div className="mt-3 flex h-32 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-300 to-zinc-600 dark:from-zinc-700 dark:to-zinc-950">
              <HudPreview appearance={draft} className="h-12 w-48 px-5 py-3" />
            </div>
          </CardContent>
        </Card>

        {/* Presets */}
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-base font-medium text-foreground">
                {t("settings.widgetAppearance.presetsTitle")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.widgetAppearance.presetsDescription")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {WIDGET_APPEARANCE_PRESETS.map((preset) => {
                const selected = draft.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetSelect(preset)}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors ${
                      selected
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <HudPreview
                      appearance={{
                        preset: preset.id,
                        background: preset.background,
                        accent: preset.accent,
                        border: preset.border,
                      }}
                      className="h-8 w-28 px-3 py-2"
                      barWidth="w-1"
                    />
                    <span className="text-xs text-muted-foreground">
                      {t(preset.nameKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Custom colors */}
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-base font-medium text-foreground">
                {t("settings.widgetAppearance.customTitle")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.widgetAppearance.customDescription")}
              </p>
            </div>

            <ColorField
              label={t("settings.widgetAppearance.colors.background")}
              color={draft.background}
              onChange={(v) => handleColorChange("background", v)}
            />
            <Separator />
            <ColorField
              label={t("settings.widgetAppearance.colors.accent")}
              color={draft.accent}
              onChange={(v) => handleColorChange("accent", v)}
            />
            <Separator />
            <ColorField
              label={t("settings.widgetAppearance.colors.border")}
              color={draft.border}
              onChange={(v) => handleColorChange("border", v)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
