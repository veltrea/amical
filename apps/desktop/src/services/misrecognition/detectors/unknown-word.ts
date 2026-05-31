import type {
  ContextSample,
  Detector,
  DetectorContext,
  DetectorEmission,
  MorphToken,
} from "./types";
import { surfaceNormalizeKey } from "./lib/text";

const ID = "unknown-word";
const MAX_CONTEXT_SAMPLES = 3;
const MIN_LENGTH = 2;

interface SurfaceStats {
  surface: string;
  count: number;
  contextSamples: ContextSample[];
}

/**
 * Flags surfaces that kuromoji marked as unknown — tokens it could not
 * dictionary-look-up (POS `名詞`/`未知語`, or `pos_detail_1` containing
 * `未知語`). These include domain-specific terminology the user dictates
 * (`システムプロンプト` etc.) **and** truncated misrecognitions like
 * `システムプロンプ`. The detector does not try to tell them apart; the
 * UI does.
 */
export const unknownWordDetector: Detector = {
  descriptor: {
    id: ID,
    category: "morph",
    labelKey: `settings.misrecognition.detector.${ID}.label`,
    descriptionKey: `settings.misrecognition.detector.${ID}.description`,
    requiresMorph: true,
    requiresMlx: false,
    estimatedDuration: "fast",
    defaultEnabled: false,
  },
  async run(ctx: DetectorContext): Promise<DetectorEmission[]> {
    if (!ctx.morph) {
      throw new Error("unknown-word requires a morph analyzer");
    }

    const stats = new Map<string, SurfaceStats>();
    const vocabWords = new Set(ctx.vocabulary.map((v) => v.word));

    for (const row of ctx.rows) {
      const tokens = ctx.morph.tokenize(row.text);
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (!tok.surface || tok.surface.length < MIN_LENGTH) continue;
        if (tok.reading) continue; // dictionary-known
        if (vocabWords.has(tok.surface)) continue;

        let stat = stats.get(tok.surface);
        if (!stat) {
          stat = { surface: tok.surface, count: 0, contextSamples: [] };
          stats.set(tok.surface, stat);
        }
        stat.count++;
        if (stat.contextSamples.length < MAX_CONTEXT_SAMPLES) {
          stat.contextSamples.push({
            left: surfaceAt(tokens, i - 1),
            right: surfaceAt(tokens, i + 1),
            transcriptionId: row.id,
          });
        }
      }
    }

    const out: DetectorEmission[] = [];
    for (const s of stats.values()) {
      out.push({
        word: s.surface,
        normalizedKey: surfaceNormalizeKey(s.surface),
        occurrences: s.count,
        detectorId: ID,
        contextSample: s.contextSamples.slice(0, MAX_CONTEXT_SAMPLES),
      });
    }
    return out;
  },
};

function surfaceAt(tokens: MorphToken[], i: number): string {
  if (i < 0 || i >= tokens.length) return "";
  return tokens[i].surface ?? "";
}
