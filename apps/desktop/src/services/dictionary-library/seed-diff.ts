import type { BundledDictionary, BundledDictionaryIndex } from "./catalog";

/**
 * Pure diff helpers for the "import only newly shipped dictionaries" update
 * policy. This module imports only types (erased at compile time), so it stays
 * free of the electron/fs dependencies seed.ts pulls in and can be unit-tested
 * directly without mocks — see tests/utils/dictionary-seed-diff.test.ts.
 *
 * seed.ts wraps these with the actual file copying.
 */

/**
 * Dictionaries present in the shipped catalog but not yet in the user's live
 * catalog — the set to copy in on first run / after an update.
 *
 * - Existing ids are never returned: the user may have edited them, so seeding
 *   must never overwrite a dictionary that is already in the store.
 * - Ids dropped from the bundle are not returned either: we never delete a
 *   user's dictionaries.
 * - Duplicate ids within `bundled` collapse to the first occurrence.
 */
export function computeDictionariesToAdd(
  bundled: BundledDictionaryIndex,
  current: BundledDictionaryIndex,
): BundledDictionary[] {
  const have = new Set(current.dictionaries.map((d) => d.id));
  const added = new Map<string, BundledDictionary>();
  for (const meta of bundled.dictionaries) {
    if (have.has(meta.id) || added.has(meta.id)) continue;
    added.set(meta.id, meta);
  }
  return [...added.values()];
}

/**
 * Append newly shipped dictionaries to the user's catalog, preserving the order
 * and contents of existing entries. The catalog version is advanced to the
 * higher of the two so a future catalog-format bump is recorded. Pure: the
 * input index is not mutated.
 */
export function mergeNewDictionaries(
  current: BundledDictionaryIndex,
  bundledVersion: number,
  toAdd: BundledDictionary[],
): BundledDictionaryIndex {
  return {
    version: Math.max(current.version, bundledVersion),
    dictionaries: [...current.dictionaries, ...toAdd],
  };
}
