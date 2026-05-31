/**
 * Detector framework — public types.
 *
 * Each detector is a small, focused extractor that scans transcription rows
 * and emits candidate (word, normalizedKey, occurrences, ...) records. Several
 * detectors can flag the same word; the scanner merges their emissions and
 * stores the union of `detectorIds` against the candidate row.
 *
 * See SPEC-misrecognition-v3.md for the catalog of intended detectors.
 */

export type DetectorCategory =
  | "rule"
  | "morph"
  | "statistical"
  | "phonetic"
  | "llm";

export interface DetectorDescriptor {
  id: string;
  category: DetectorCategory;
  // i18n keys, resolved by the renderer
  labelKey: string;
  descriptionKey: string;
  requiresMorph: boolean;
  requiresMlx: boolean;
  estimatedDuration: "fast" | "medium" | "slow";
  defaultEnabled: boolean;
}

export interface ContextSample {
  left: string;
  right: string;
  transcriptionId: number;
}

export interface DetectorEmission {
  word: string;
  // Reading-shaped grouping key. Detectors that have morph analysis available
  // should populate this with the kuromoji reading (katakana). Detectors that
  // operate purely on surface form should fall back to the surface itself.
  normalizedKey: string;
  occurrences: number;
  detectorId: string;
  // Optional numeric score the detector wants to surface on the candidate
  // row (keyed by detector id when persisted).
  score?: number;
  // Up to a few occurrence samples for the UI to show context.
  contextSample?: ContextSample[];
}

export interface ScanInputRow {
  id: number;
  text: string;
}

export interface VocabularyEntry {
  word: string;
  replacementWord: string | null;
}

export interface MorphToken {
  surface: string;
  // kuromoji's reading (katakana). null when unknown / not assigned.
  reading: string | null;
  pos: string;
  basicForm?: string;
}

export interface MorphAnalyzer {
  // Analyze a single text. Implementations should cache per-text results so
  // repeated calls from multiple detectors over the same row don't re-tokenize.
  tokenize(text: string): MorphToken[];
}

export interface DetectorContext {
  rows: ScanInputRow[];
  vocabulary: VocabularyEntry[];
  // Lazily-loaded morphological analyzer — populated only when at least one
  // selected detector has `requiresMorph = true`. Detectors that don't need
  // it should ignore this field.
  morph?: MorphAnalyzer | null;
}

export interface Detector {
  readonly descriptor: DetectorDescriptor;
  run(ctx: DetectorContext): Promise<DetectorEmission[]>;
}
