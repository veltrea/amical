import type { Detector, DetectorContext, DetectorEmission } from "./types";
import { hasMixedAsciiJapanese, surfaceNormalizeKey } from "./lib/text";
import { countTokensWithContext } from "./lib/context";

const ID = "mixed-script";

/**
 * Flags single tokens that contain both ASCII letters and Japanese
 * characters (e.g. `Apple果物`). ASR rarely produces these legitimately;
 * they usually signal a broken token boundary.
 */
export const mixedScriptDetector: Detector = {
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

    const out: DetectorEmission[] = [];
    for (const t of tokenInfo.values()) {
      if (vocabWords.has(t.word)) continue;
      if (!hasMixedAsciiJapanese(t.word)) continue;
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
