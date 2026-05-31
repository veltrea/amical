import type { Detector, DetectorContext, DetectorEmission } from "./types";
import {
  editDistance,
  isKatakanaToken,
  surfaceNormalizeKey,
} from "./lib/text";
import { countTokensWithContext, type TokenInfo } from "./lib/context";

const ID = "katakana-variant";
const MAX_EDIT_DISTANCE = 2;

/**
 * Flags katakana words that share a surface-normalized key with another
 * katakana word **and** are within edit distance 2 of it. Only minority
 * members of the group are flagged (the most-frequent surface is treated
 * as the intended spelling).
 *
 * v1's dakuten-stripping normalize key is intentionally not used here —
 * stripping caused ノード ≡ ノート misclassification. Reading-based
 * grouping is handled by the morph detector instead.
 */
export const katakanaVariantDetector: Detector = {
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
    const groups = new Map<string, TokenInfo[]>();
    for (const t of tokenInfo.values()) {
      if (!isKatakanaToken(t.word)) continue;
      const key = surfaceNormalizeKey(t.word);
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }

    const out: DetectorEmission[] = [];
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      const maxCount = Math.max(...arr.map((t) => t.count));
      const flagged = new Set<string>();
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (
            editDistance(arr[i].word, arr[j].word, MAX_EDIT_DISTANCE) <=
            MAX_EDIT_DISTANCE
          ) {
            if (arr[i].count < maxCount) flagged.add(arr[i].word);
            if (arr[j].count < maxCount) flagged.add(arr[j].word);
          }
        }
      }
      for (const t of arr) {
        if (!flagged.has(t.word)) continue;
        out.push({
          word: t.word,
          normalizedKey: surfaceNormalizeKey(t.word),
          occurrences: t.count,
          detectorId: ID,
          contextSample: t.contextSamples.slice(0, 3),
        });
      }
    }
    return out;
  },
};
