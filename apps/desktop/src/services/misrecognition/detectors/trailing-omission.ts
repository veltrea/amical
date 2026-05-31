import type { Detector, DetectorContext, DetectorEmission } from "./types";
import { isKatakanaToken, surfaceNormalizeKey } from "./lib/text";
import { countTokensWithContext } from "./lib/context";

const ID = "trailing-omission";
const MIN_LENGTH = 3;
const MAX_OCCURRENCES_FOR_TRUNCATED = 50;

// Suffixes that ASR commonly drops at word-end: long mark and the small kana
// it expands to in conventional katakana spelling.
const TRAILING_SUFFIXES = ["ー", "ッ", "ン"];

/**
 * Flags a katakana token whose corpus also contains the same token plus a
 * trailing long-mark / sokuon / 撥音 (`コーヒ` while `コーヒー` exists,
 * `サーバ` while `サーバー` exists, `ロケッ` while `ロケット` exists).
 *
 * Pattern-match style: pure surface check, no morph analysis. Skipped on
 * very high-frequency tokens to avoid flagging the dominant spelling itself
 * when both spellings happen to coexist.
 */
export const trailingOmissionDetector: Detector = {
  descriptor: {
    id: ID,
    category: "rule",
    labelKey: `settings.misrecognition.detector.${ID}.label`,
    descriptionKey: `settings.misrecognition.detector.${ID}.description`,
    requiresMorph: false,
    requiresMlx: false,
    estimatedDuration: "fast",
    defaultEnabled: true,
  },
  async run(ctx: DetectorContext): Promise<DetectorEmission[]> {
    const tokenInfo = countTokensWithContext(ctx.rows);
    const vocabWords = new Set(ctx.vocabulary.map((v) => v.word));

    // For O(1) lookups: surface -> count over katakana tokens only.
    const katakanaCount = new Map<string, number>();
    for (const t of tokenInfo.values()) {
      if (isKatakanaToken(t.word)) {
        katakanaCount.set(t.word, t.count);
      }
    }

    const out: DetectorEmission[] = [];
    for (const t of tokenInfo.values()) {
      if (!isKatakanaToken(t.word)) continue;
      if (t.word.length < MIN_LENGTH) continue;
      if (vocabWords.has(t.word)) continue;
      if (t.count > MAX_OCCURRENCES_FOR_TRUNCATED) continue;

      let matchedFull: string | undefined;
      for (const suffix of TRAILING_SUFFIXES) {
        const full = t.word + suffix;
        if (katakanaCount.has(full)) {
          matchedFull = full;
          break;
        }
      }
      if (!matchedFull) continue;

      // Only flag the shorter (truncated) one if the longer is at least as
      // frequent — otherwise the "truncated" form may actually be the
      // intended spelling.
      const fullCount = katakanaCount.get(matchedFull)!;
      if (fullCount < t.count) continue;

      out.push({
        word: t.word,
        normalizedKey: surfaceNormalizeKey(t.word),
        occurrences: t.count,
        detectorId: ID,
        contextSample: t.contextSamples.slice(0, 3),
      });
    }
    return out;
  },
};
