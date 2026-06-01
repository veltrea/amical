import type { Vocabulary } from "../db/schema";

/**
 * Max non-replacement vocabulary entries fed into the LLM formatter as hints.
 * Storage and UI are uncapped; this limit applies only to what's sent in the
 * prompt during transcription so the prompt stays bounded.
 */
export const MAX_VOCABULARY_HINTS = 200;

/**
 * Pick the vocabulary entries to surface to the LLM as hints during
 * transcription. Filters out replacement-mode entries (those run through the
 * post-format `applyTextReplacements` path instead) and caps the result.
 *
 * TODO: Replace the naive "latest N by date" heuristic with smarter ranking —
 * frequency-weighted (usageCount), context-aware, or LLM-pre-selection — once
 * we have signal to drive that. For now most-recent wins.
 */
export function selectVocabularyHints(entries: Vocabulary[]): string[] {
  return entries
    .filter((e) => !e.isReplacement)
    .sort((a, b) => b.dateAdded.getTime() - a.dateAdded.getTime())
    .slice(0, MAX_VOCABULARY_HINTS)
    .map((e) => e.word);
}

/** Minimal shape shared by manual vocabulary rows and bundled dictionary entries. */
export interface HintCandidate {
  word: string;
  isReplacement: boolean | null;
}

/**
 * Build the LLM hint list from manual vocabulary plus activated bundled
 * dictionaries (model B — see SPEC-dictionary-library.md §5). Manual words
 * come first so they survive the cap when there are more candidates than
 * MAX_VOCABULARY_HINTS; dictionary words fill the remainder. Non-replacement
 * only, deduped by word.
 */
export function selectVocabularyHintsFromMixed(
  manual: HintCandidate[],
  dictionary: HintCandidate[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...manual, ...dictionary]) {
    if (e.isReplacement === true) continue;
    if (seen.has(e.word)) continue;
    seen.add(e.word);
    out.push(e.word);
    if (out.length >= MAX_VOCABULARY_HINTS) break;
  }
  return out;
}
