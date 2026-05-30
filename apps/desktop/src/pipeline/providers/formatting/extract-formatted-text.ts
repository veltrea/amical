type ExtractionFailureReason =
  | "malformed_tags"
  | "no_tags"
  | "empty_content"
  | "whitespace_only";

export type ExtractionResult = {
  text: string;
  usedFallback: boolean;
  reason?: ExtractionFailureReason;
};

/**
 * Extract formatted text from LLM response with safety fallback.
 * If extraction fails (malformed tags, empty content, etc.), returns original text.
 */
export function extractFormattedText(
  response: string,
  originalText: string,
): ExtractionResult {
  const hasOpenTag = response.includes("<formatted_text>");
  const hasCloseTag = response.includes("</formatted_text>");

  if (hasOpenTag && !hasCloseTag) {
    return { text: originalText, usedFallback: true, reason: "malformed_tags" };
  }

  const match = response.match(/<formatted_text>([\s\S]*?)<\/formatted_text>/);
  if (!match) {
    return { text: originalText, usedFallback: true, reason: "no_tags" };
  }

  const extracted = match[1] ?? "";
  if (extracted.trim() === "") {
    return {
      text: originalText,
      usedFallback: true,
      reason: extracted === "" ? "empty_content" : "whitespace_only",
    };
  }

  // Strip leading/trailing newlines only — the Output Format template renders
  // the placeholder on its own line, so models faithfully echo a `\n` before
  // and after the text. Half-width spaces are KEPT: context-integration
  // examples deliberately produce a leading " " so the formatted text reads
  // naturally when spliced after `before_text`.
  const cleaned = extracted.replace(/^[\r\n]+|[\r\n]+$/g, "");
  return { text: cleaned, usedFallback: false };
}
