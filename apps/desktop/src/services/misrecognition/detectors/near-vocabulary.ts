import type { Detector, DetectorContext, DetectorEmission } from "./types";
import { editDistance, surfaceNormalizeKey } from "./lib/text";
import { countTokensWithContext } from "./lib/context";

const ID = "near-vocabulary";
const MAX_EDIT_DISTANCE = 1;
const MAX_OCCURRENCES = 3;
const MIN_LENGTH = 3;

/**
 * Flags tokens that are edit distance 1 from an existing vocabulary entry
 * but are not themselves vocabulary entries. To keep precision reasonable
 * the rule only fires on low-frequency tokens of length ≥ 3 — common words
 * that happen to be one character off a vocabulary entry are usually not
 * misrecognitions of it.
 */
export const nearVocabularyDetector: Detector = {
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
    const vocabList = [...vocabWords];

    const out: DetectorEmission[] = [];
    for (const t of tokenInfo.values()) {
      if (vocabWords.has(t.word) || vocabReplacements.has(t.word)) continue;
      if (t.count > MAX_OCCURRENCES) continue;
      if (t.word.length < MIN_LENGTH) continue;

      let matched = false;
      for (const v of vocabList) {
        if (Math.abs(v.length - t.word.length) > MAX_EDIT_DISTANCE) continue;
        if (editDistance(v, t.word, MAX_EDIT_DISTANCE) <= MAX_EDIT_DISTANCE) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;

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
