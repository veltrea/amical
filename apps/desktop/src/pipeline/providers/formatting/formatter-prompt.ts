import { FormatParams } from "../../core/pipeline-types";
import { GetAccessibilityContextResult } from "@amical/types";
import {
  AppType,
  FormattingContext,
  buildFormattingPrompt,
} from "./formatter-prompt-core";

// This module is the electron-aware wrapper around the pure prompt builder in
// `./formatter-prompt-core.ts`. Keep `vscode`/electron/`@amical/types` deps
// HERE — the core stays import-pure so it can be exercised by `tsx` alone.
export type { AppType, FormattingContext } from "./formatter-prompt-core";
export { buildFormattingPrompt } from "./formatter-prompt-core";

/**
 * Wrapper for the desktop pipeline's FormatParams context.
 */
export function constructFormatterPrompt(context: FormatParams["context"]): {
  systemPrompt: string;
  userPrompt: (input: string) => string;
} {
  const { accessibilityContext, vocabulary, language, userInstructions } =
    context;

  const appType = detectApplicationType(accessibilityContext);
  const beforeText =
    accessibilityContext?.context?.textSelection?.preSelectionText;
  const afterText =
    accessibilityContext?.context?.textSelection?.postSelectionText;

  return buildFormattingPrompt({
    appType,
    vocabulary: vocabulary && vocabulary.length > 0 ? vocabulary : undefined,
    beforeText,
    afterText,
    language,
    userInstructions,
  });
}

// Map bundle identifiers to application types
const BUNDLE_TO_TYPE: Record<string, AppType> = {
  "com.apple.mail": "email",
  "com.microsoft.Outlook": "email",
  "com.readdle.smartemail": "email",
  "com.google.Gmail": "email",
  "com.superhuman.electron": "email",
  "MailClient.exe": "email", // eM Client (Windows) — bundleIdentifier is the exe path, matched via partial-include below
  "com.tinyspeck.slackmacgap": "chat",
  "com.microsoft.teams": "chat",
  "com.facebook.archon": "chat", // Messenger
  "com.discord.Discord": "chat",
  "com.telegram.desktop": "chat",
  "com.apple.Notes": "notes",
  "com.microsoft.onenote.mac": "notes",
  "com.evernote.Evernote": "notes",
  "notion.id": "notes",
  "com.agiletortoise.Drafts-OSX": "notes",
};

// Browser bundle identifiers
const BROWSER_BUNDLE_IDS = [
  "com.apple.Safari",
  "com.google.Chrome",
  "com.google.Chrome.canary",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "com.brave.Browser",
  "com.operasoftware.Opera",
  "com.vivaldi.Vivaldi",
];

// URL patterns for web applications (general has no patterns, falls through)
const URL_PATTERNS: Partial<Record<AppType, RegExp[]>> = {
  email: [
    /mail\.google\.com/,
    /outlook\.live\.com/,
    /outlook\.office\.com/,
    /mail\.yahoo\.com/,
    /mail\.proton\.me/,
    /webmail\./,
    /roundcube/,
    /fastmail\.com/,
  ],
  chat: [
    /web\.whatsapp\.com/,
    /discord\.com/,
    /teams\.microsoft\.com/,
    /slack\.com/,
    /web\.telegram\.org/,
    /messenger\.com/,
    /chat\.openai\.com/,
    /claude\.ai/,
    /chat\.google\com/,
  ],
  notes: [
    /notion\.so/,
    /docs\.google\.com/,
    /onenote\.com/,
    /evernote\.com/,
    /roamresearch\.com/,
    /obsidian\.md/,
    /workflowy\.com/,
    /coda\.io/,
  ],
};

export function detectApplicationType(
  accessibilityContext: GetAccessibilityContextResult | null | undefined,
): AppType {
  if (!accessibilityContext?.context?.application?.bundleIdentifier) {
    return "default";
  }

  const bundleId = accessibilityContext.context.application.bundleIdentifier;

  // Amical's own app: align to Axis prompt format but preserve appType value.
  if (bundleId === "ai.amical.desktop") {
    return "amical-notes";
  }

  // Check if it's a browser
  const isBrowser = BROWSER_BUNDLE_IDS.some(
    (browserId) => bundleId.includes(browserId) || browserId.includes(bundleId),
  );

  if (isBrowser && accessibilityContext.context?.windowInfo?.url) {
    // Try to detect type from URL
    const url = accessibilityContext.context.windowInfo.url.toLowerCase();

    for (const [type, patterns] of Object.entries(URL_PATTERNS) as [
      AppType,
      RegExp[],
    ][]) {
      if (patterns?.some((pattern) => pattern.test(url))) {
        return type;
      }
    }
  }

  // Check for exact match in native apps
  if (BUNDLE_TO_TYPE[bundleId]) {
    return BUNDLE_TO_TYPE[bundleId];
  }

  // Check for partial matches
  for (const [key, type] of Object.entries(BUNDLE_TO_TYPE) as [
    string,
    AppType,
  ][]) {
    if (bundleId.includes(key) || key.includes(bundleId)) {
      return type;
    }
  }

  // Default to default
  return "default";
}
