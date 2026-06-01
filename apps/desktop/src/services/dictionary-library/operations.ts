import {
  deleteVocabularyBySource,
  getVocabularySourceSummaries,
  importVocabularyEntries,
  setVocabularySourceActive,
  type VocabularySourceSummary,
} from "../../db/vocabulary";
import {
  librarySourceTag,
  readBundledDictionaryFile,
  readBundledIndex,
  type BundledDictionary,
} from "./catalog";

/**
 * The installation state of a bundled dictionary as observed in the DB:
 *
 *   - "not-installed": no vocabulary row has source = library:<id>
 *   - "active":        at least one row exists and every row is isActive=true
 *   - "inactive":      at least one row exists and every row is isActive=false
 *   - "mixed":         rows exist but isActive is heterogeneous (rare;
 *                      happens if a user manually toggled individual rows
 *                      via the regular vocabulary UI)
 *
 * UI treats "mixed" the same as "active" but surfaces a hint that some rows
 * differ; see SPEC-dictionary-library.md §7.3.
 */
export type DictionaryInstallState =
  | "not-installed"
  | "active"
  | "inactive"
  | "mixed";

export interface DictionaryWithState extends BundledDictionary {
  state: DictionaryInstallState;
  installedEntries: number;
  activeEntries: number;
}

export interface DictionaryApplyResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Enumerate every bundled dictionary along with its current installation
 * state. The state is computed from a single grouped query against the
 * vocabulary table (`getVocabularySourceSummaries`) so we don't pay a
 * round-trip per dictionary.
 */
export async function listBundledDictionariesWithState(): Promise<
  DictionaryWithState[]
> {
  const [index, summaries] = await Promise.all([
    readBundledIndex(),
    getVocabularySourceSummaries(),
  ]);
  const bySource = new Map<string, VocabularySourceSummary>();
  for (const s of summaries) {
    bySource.set(s.source, s);
  }

  return index.dictionaries.map((meta) => {
    const summary = bySource.get(librarySourceTag(meta.id));
    if (!summary) {
      return {
        ...meta,
        state: "not-installed",
        installedEntries: 0,
        activeEntries: 0,
      };
    }
    let state: DictionaryInstallState;
    if (summary.activeCount === summary.totalCount) {
      state = "active";
    } else if (summary.activeCount === 0) {
      state = "inactive";
    } else {
      state = "mixed";
    }
    return {
      ...meta,
      state,
      installedEntries: summary.totalCount,
      activeEntries: summary.activeCount,
    };
  });
}

/**
 * Insert the rows of a bundled dictionary into the vocabulary table, tagged
 * with `library:<id>`. Uses the existing `importVocabularyEntries` path in
 * "skip" mode so user-authored rows with the same word are preserved.
 *
 * The returned `skipped` count is the number of duplicates that already
 * existed (including any from a previously-installed dictionary).
 */
export async function applyBundledDictionary(
  id: string,
): Promise<DictionaryApplyResult> {
  const { file } = await readBundledDictionaryFile(id);
  const source = librarySourceTag(id);
  const result = await importVocabularyEntries(file.entries, "skip", source);
  return {
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped.length,
  };
}

/**
 * Delete every vocabulary row tagged with `library:<id>`. User-authored
 * rows are not touched (they have source = NULL).
 */
export async function removeBundledDictionary(
  id: string,
): Promise<{ deleted: number }> {
  return await deleteVocabularyBySource(librarySourceTag(id));
}

/**
 * Toggle isActive for every row of a bundled dictionary. Rows stay in the
 * table so the user can re-enable them without re-installing.
 */
export async function setBundledDictionaryActive(
  id: string,
  isActive: boolean,
): Promise<{ updated: number }> {
  return await setVocabularySourceActive(librarySourceTag(id), isActive);
}
