/**
 * Appearance configuration for the floating recording widget ("HUD").
 *
 * Colors are stored as 8-digit hex strings (#RRGGBBAA) so the alpha channel —
 * which the HUD relies on for its translucent, blurred backdrop — survives a
 * round-trip through the database and can be dropped straight into a CSS value.
 *
 * This module is intentionally dependency-free so it can be shared between the
 * main process (settings service / tRPC validation) and both renderers (the
 * settings page and the widget itself).
 */

/** A single user-customizable HUD color triplet. */
export interface WidgetAppearance {
  /** Id of the active preset, or "custom" when the user hand-picked colors. */
  preset: string;
  /** Widget container background (translucent). */
  background: string;
  /** Accent color: recording waveform, processing dots, note action icon. */
  accent: string;
  /** Outer ring / border color. */
  border: string;
}

/** A named, selectable combination shown in the preset grid. */
export interface WidgetAppearancePreset {
  id: string;
  /** i18n key for the human-readable preset name. */
  nameKey: string;
  background: string;
  accent: string;
  border: string;
}

export const WIDGET_APPEARANCE_CUSTOM_PRESET = "custom";

/**
 * The built-in palette. "classic" mirrors the original hard-coded look
 * (bg-black/70, white waveform, black/60 ring) so existing users see no change
 * until they pick something else.
 */
export const WIDGET_APPEARANCE_PRESETS: WidgetAppearancePreset[] = [
  {
    id: "classic",
    nameKey: "settings.widgetAppearance.presets.classic",
    background: "#000000B3",
    accent: "#FFFFFFFF",
    border: "#00000099",
  },
  {
    id: "midnight",
    nameKey: "settings.widgetAppearance.presets.midnight",
    background: "#0B1220E6",
    accent: "#38BDF8FF",
    border: "#1E293BE6",
  },
  {
    id: "graphite",
    nameKey: "settings.widgetAppearance.presets.graphite",
    background: "#1C1C1EE6",
    accent: "#F5F5F7FF",
    border: "#48484AE6",
  },
  {
    id: "sunset",
    nameKey: "settings.widgetAppearance.presets.sunset",
    background: "#1A0E08E6",
    accent: "#FB923CFF",
    border: "#7C2D12CC",
  },
  {
    id: "forest",
    nameKey: "settings.widgetAppearance.presets.forest",
    background: "#07150FE6",
    accent: "#34D399FF",
    border: "#065F46CC",
  },
  {
    id: "grape",
    nameKey: "settings.widgetAppearance.presets.grape",
    background: "#150B20E6",
    accent: "#C084FCFF",
    border: "#5B21B6CC",
  },
];

/** Default appearance = the "classic" preset (the pre-feature look). */
export const DEFAULT_WIDGET_APPEARANCE: WidgetAppearance = {
  preset: "classic",
  background: "#000000B3",
  accent: "#FFFFFFFF",
  border: "#00000099",
};

/**
 * Accepts #RGB, #RGBA, #RRGGBB, or #RRGGBBAA. Used by both the tRPC validator
 * and the settings UI before persisting a hand-typed value.
 */
export const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * Find which preset (if any) exactly matches the given colors, so the UI can
 * highlight the active swatch. Returns "custom" when nothing matches.
 */
export function matchPreset(colors: {
  background: string;
  accent: string;
  border: string;
}): string {
  const match = WIDGET_APPEARANCE_PRESETS.find(
    (p) =>
      p.background.toLowerCase() === colors.background.toLowerCase() &&
      p.accent.toLowerCase() === colors.accent.toLowerCase() &&
      p.border.toLowerCase() === colors.border.toLowerCase(),
  );
  return match?.id ?? WIDGET_APPEARANCE_CUSTOM_PRESET;
}
