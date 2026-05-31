import type {
  ContextSample,
  Detector,
  DetectorContext,
  DetectorEmission,
  MorphToken,
} from "./types";

const ID = "same-reading-group";
const MAX_CONTEXT_SAMPLES = 3;
const MIN_GROUP_TOTAL = 3;

interface SurfaceStats {
  surface: string;
  reading: string;
  count: number;
  contextSamples: ContextSample[];
}

/**
 * Groups surfaces (any script — kanji, hiragana, katakana mixes) by the
 * kuromoji reading of their dominant tokenization, and flags every member
 * of a multi-surface group as a candidate.
 *
 * This is the structurally-correct fix for v1's `ノード ≡ ノート` problem:
 * because kuromoji assigns those surfaces different readings, they end up
 * in different groups and are never flagged as variants of each other.
 *
 * Whether each group is a true misrecognition or a legitimate
 * script-style variant (e.g. `言う / いう`) is left to the user — both
 * cases get surfaced; the UI provides filtering.
 */
export const sameReadingGroupDetector: Detector = {
  descriptor: {
    id: ID,
    category: "morph",
    labelKey: `settings.misrecognition.detector.${ID}.label`,
    descriptionKey: `settings.misrecognition.detector.${ID}.description`,
    requiresMorph: true,
    requiresMlx: false,
    estimatedDuration: "fast",
    defaultEnabled: true,
  },
  async run(ctx: DetectorContext): Promise<DetectorEmission[]> {
    if (!ctx.morph) {
      throw new Error("same-reading-group requires a morph analyzer");
    }

    const stats = new Map<string, SurfaceStats>(); // key: surface
    // Track each surface's most-frequent reading; surfaces with no reading
    // (kuromoji-unknown words) are skipped here — `unknown-word` handles them.
    const readingsBySurface = new Map<string, Map<string, number>>();

    for (const row of ctx.rows) {
      const tokens = ctx.morph.tokenize(row.text);
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (!tok.surface) continue;
        if (!tok.reading) continue;

        const rmap = readingsBySurface.get(tok.surface) ?? new Map();
        rmap.set(tok.reading, (rmap.get(tok.reading) ?? 0) + 1);
        readingsBySurface.set(tok.surface, rmap);

        let stat = stats.get(tok.surface);
        if (!stat) {
          stat = {
            surface: tok.surface,
            reading: tok.reading,
            count: 0,
            contextSamples: [],
          };
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

    // Resolve each surface to its main reading.
    const mainReading = new Map<string, string>();
    for (const [surface, rmap] of readingsBySurface) {
      let best = "";
      let bestCount = 0;
      for (const [r, c] of rmap) {
        if (c > bestCount) {
          best = r;
          bestCount = c;
        }
      }
      if (best) mainReading.set(surface, best);
    }

    // Group surfaces by main reading.
    const groups = new Map<string, SurfaceStats[]>();
    for (const stat of stats.values()) {
      const reading = mainReading.get(stat.surface);
      if (!reading) continue;
      const arr = groups.get(reading) ?? [];
      arr.push({ ...stat, reading });
      groups.set(reading, arr);
    }

    const vocabWords = new Set(ctx.vocabulary.map((v) => v.word));

    const out: DetectorEmission[] = [];
    for (const [reading, members] of groups) {
      if (members.length < 2) continue;
      const total = members.reduce((s, m) => s + m.count, 0);
      if (total < MIN_GROUP_TOTAL) continue;

      for (const m of members) {
        if (vocabWords.has(m.surface)) continue;
        out.push({
          word: m.surface,
          normalizedKey: reading,
          occurrences: m.count,
          detectorId: ID,
          contextSample: m.contextSamples.slice(0, MAX_CONTEXT_SAMPLES),
        });
      }
    }
    return out;
  },
};

function surfaceAt(tokens: MorphToken[], i: number): string {
  if (i < 0) return "";
  if (i >= tokens.length) return "";
  return tokens[i].surface ?? "";
}
