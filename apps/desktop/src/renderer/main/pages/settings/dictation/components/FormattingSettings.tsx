import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { useFormattingSettings } from "../hooks/use-formatting-settings";
import { useTranslation } from "react-i18next";

/**
 * IME-safe textarea. The parent's optimistic mutation rewrites the prop on
 * every keystroke; binding that directly to a controlled <textarea> resets
 * the value mid-IME composition (e.g. "ITや" mutates to "ITyあ" because the
 * 半角 "y" + 全角 "あ" land separately). Strategy:
 *   - keep local state for what the user sees while typing
 *   - track compositionstart/end so we never propagate during IME composition
 *   - flush to the parent on blur (and on composition end + uncomposed change)
 *   - only re-sync from the prop when not focused, so server-side echo of our
 *     own write doesn't snap the cursor.
 *
 * Reused for the User Preferences block AND the Custom System Prompt escape
 * hatch — both fields persist via the same optimistic-mutation hook.
 */
function ImeSafeTextarea({
  value,
  onSave,
  placeholder,
  rows = 5,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder: string;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  const isComposingRef = useRef(false);
  const isFocusedRef = useRef(false);

  // Keep draft in sync with the server value, but ONLY when the user isn't
  // actively editing — otherwise we'd clobber their in-progress typing.
  useEffect(() => {
    if (!isFocusedRef.current && !isComposingRef.current) {
      setDraft(value);
    }
  }, [value]);

  const commit = () => {
    if (draft !== value) onSave(draft);
  };

  return (
    <Textarea
      value={draft}
      placeholder={placeholder}
      rows={rows}
      className="font-mono text-xs"
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        commit();
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        // Pull the post-composition value straight from the DOM event so we
        // don't depend on a React onChange race with the composition end.
        setDraft((e.target as HTMLTextAreaElement).value);
      }}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

export function FormattingSettings() {
  const { t } = useTranslation();
  const {
    formattingEnabled,
    selectedModelId,
    formattingOptions,
    disableFormattingToggle,
    hasFormattingOptions,
    showCloudRequiresSpeech,
    showCloudRequiresAuth,
    showCloudReady,
    showNoLanguageModels,
    handleFormattingEnabledChange,
    handleFormattingModelChange,
    handleUserInstructionsChange,
    handleCustomSystemPromptChange,
    handleCloudLogin,
    isLoginPending,
    userInstructions,
    customSystemPrompt,
  } = useFormattingSettings();
  const isAdvancedActive = customSystemPrompt.trim().length > 0;

  return (
    <div className="">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <Label className="text-base font-semibold text-foreground">
              {t("settings.dictation.formatting.label")}
            </Label>
            <Badge className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-500 hover:bg-orange-500/20">
              {t("settings.dictation.formatting.badge")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {t("settings.dictation.formatting.description")}
          </p>
        </div>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <div>
              <Switch
                checked={formattingEnabled}
                onCheckedChange={handleFormattingEnabledChange}
                disabled={disableFormattingToggle}
              />
            </div>
          </TooltipTrigger>
          {disableFormattingToggle && (
            <TooltipContent className="max-w-sm text-center">
              {t("settings.dictation.formatting.disabledTooltip")}
            </TooltipContent>
          )}
        </Tooltip>
      </div>

      <Link
        to="/settings/ai-models"
        search={{ tab: "language" }}
        className="inline-block"
      >
        <Button variant="link" className="text-xs px-0">
          <Plus className="w-4 h-4" />
          {t("settings.dictation.formatting.manageLanguageModels")}
        </Button>
      </Link>

      {formattingEnabled && (
        <div className="mt-6 border-border border rounded-md p-4">
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                {t("settings.dictation.formatting.modelLabel")}
              </Label>
              <p className="text-xs text-muted-foreground mb-4">
                {t("settings.dictation.formatting.modelDescription")}
              </p>
            </div>
            <div className="space-y-3">
              <Combobox
                options={formattingOptions}
                value={selectedModelId}
                onChange={handleFormattingModelChange}
                placeholder={t(
                  "settings.dictation.formatting.modelPlaceholder",
                )}
                disabled={!hasFormattingOptions}
              />
              {showCloudRequiresSpeech && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {t("settings.dictation.formatting.requiresCloudSpeech")}
                  </span>
                  <Link to="/settings/ai-models" search={{ tab: "speech" }}>
                    <Button variant="outline" size="sm">
                      {t("settings.dictation.formatting.switchSpeechModel")}
                    </Button>
                  </Link>
                </div>
              )}
              {showCloudRequiresAuth && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>{t("settings.dictation.formatting.signInCloud")}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCloudLogin}
                    disabled={isLoginPending}
                  >
                    {t("settings.dictation.formatting.signIn")}
                  </Button>
                </div>
              )}
              {showCloudReady && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.dictation.formatting.cloudReady")}
                </p>
              )}
              {showNoLanguageModels && (
                <div className="flex items-center justify-between rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {t("settings.dictation.formatting.noLanguageModels")}
                  </span>
                  <Link to="/settings/ai-models" search={{ tab: "language" }}>
                    <Button variant="outline" size="sm">
                      <Plus className="w-4 h-4 mr-1" />
                      {t("settings.dictation.formatting.syncLanguageModels")}
                    </Button>
                  </Link>
                </div>
              )}
            </div>

            {/* User-supplied proofreading instructions — layered into the system
                prompt as a separate "User Preferences" block. Free-form text.
                Greyed out (but still editable) when the advanced custom system
                prompt is active, since that path ignores this field. */}
            <div
              className={`space-y-2 pt-2 ${
                isAdvancedActive ? "opacity-50" : ""
              }`}
            >
              <Label className="text-sm font-medium text-foreground block">
                {t("settings.dictation.formatting.userInstructionsLabel")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {isAdvancedActive
                  ? t(
                      "settings.dictation.formatting.userInstructionsOverridden",
                    )
                  : t(
                      "settings.dictation.formatting.userInstructionsDescription",
                    )}
              </p>
              <ImeSafeTextarea
                value={userInstructions}
                onSave={handleUserInstructionsChange}
                placeholder={t(
                  "settings.dictation.formatting.userInstructionsPlaceholder",
                )}
              />
            </div>

            {/* Power-user escape hatch: full system prompt replacement.
                Collapsed by default. When the textarea is non-empty after
                trim, this replaces the built-in template entirely — safety
                rules, examples, output-format directives all gone. */}
            <details
              className="pt-2 border-t border-border"
              open={isAdvancedActive}
            >
              <summary className="text-sm font-medium text-foreground cursor-pointer select-none">
                {t("settings.dictation.formatting.customSystemPromptLabel")}
                {isAdvancedActive && (
                  <Badge className="ml-2 text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-500 hover:bg-amber-500/20">
                    {t("settings.dictation.formatting.customSystemPromptActiveBadge")}
                  </Badge>
                )}
              </summary>
              <div className="space-y-2 pt-3">
                <p className="text-xs text-muted-foreground">
                  {t("settings.dictation.formatting.customSystemPromptDescription")}
                </p>
                <p className="text-xs text-amber-500/80">
                  {t("settings.dictation.formatting.customSystemPromptWarning")}
                </p>
                <ImeSafeTextarea
                  value={customSystemPrompt}
                  onSave={handleCustomSystemPromptChange}
                  placeholder={t(
                    "settings.dictation.formatting.customSystemPromptPlaceholder",
                  )}
                  rows={12}
                />
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
