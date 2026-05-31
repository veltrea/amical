import type { Detector, DetectorContext, DetectorEmission } from "./types";
import {
  isAsciiToken,
  isKatakanaToken,
  surfaceNormalizeKey,
} from "./lib/text";
import { countTokensWithContext } from "./lib/context";

const ID = "low-frequency-rare";
const MAX_COUNT = 3;
const MIN_LENGTH = 3;

/**
 * Flags katakana or ASCII tokens that appear at most {@link MAX_COUNT} times
 * across the corpus and are at least {@link MIN_LENGTH} characters long.
 * Rare technical terms or one-off misrecognitions usually fall here.
 */
export const lowFrequencyRareDetector: Detector = {
  descriptor: {
    id: ID,
    category: "rule",
    labelKey: `settings.misrecognition.detector.${ID}.label`,
    descriptionKey: `settings.misrecognition.detector.${ID}.description`,
    requiresMorph: false,
    requiresMlx: false,
    estimatedDuration: "fast",
    defaultEnabled: false,
  },
  async run(ctx: DetectorContext): Promise<DetectorEmission[]> {
    const tokenInfo = countTokensWithContext(ctx.rows);
    const vocabWords = new Set(ctx.vocabulary.map((v) => v.word));
    const vocabReplacements = new Set(
      ctx.vocabulary
        .map((v) => v.replacementWord)
        .filter((w): w is string => Boolean(w)),
    );

    const out: DetectorEmission[] = [];
    for (const t of tokenInfo.values()) {
      if (vocabWords.has(t.word) || vocabReplacements.has(t.word)) continue;
      if (t.count > MAX_COUNT) continue;
      if (t.word.length < MIN_LENGTH) continue;
      if (!isKatakanaToken(t.word) && !isAsciiToken(t.word)) continue;
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
