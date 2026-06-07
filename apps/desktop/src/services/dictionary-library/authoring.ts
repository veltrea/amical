import { app } from "electron";
import { promises as fs } from "node:fs";
import { logger } from "../../main/logger";
import { dictionariesIndexPath, dictionaryFilePath } from "./paths";
import {
  readBundledIndex,
  readBundledDictionaryFile,
  invalidateIndexCache,
  type BundledDictionary,
  type BundledDictionaryIndex,
  type DictionaryEntry,
  type DictionaryFile,
} from "./catalog";
import {
  serializeDictionaryFile,
  serializeIndex,
  parseBlankLineGroups,
  setEntryCount,
  upsertIndexEntry,
  removeIndexEntry,
  addEntry,
  updateEntry,
  removeEntry,
} from "./serialize";
import { deactivateDictionary } from "./operations";

/**
 * Dev-only authoring of the bundled dictionary catalog. These functions WRITE
 * to apps/desktop/assets/dictionaries (the source tree in `pnpm start`), so the
 * edited dictionaries become part of the next release. In packaged apps the
 * assets live under a read-only Resources directory, so every entry point first
 * calls assertEditable() and throws.
 *
 * All writes go through serialize.ts to preserve the hand-authored formatting,
 * keep index.json's entryCount in sync, and invalidate the catalog cache so the
 * edit is visible immediately.
 */

/** Throw in packaged builds, where the bundled assets are read-only. */
export function assertEditable(): void {
  if (app.isPackaged) {
    throw new Error(
      "Dictionary editing is only available in development builds; bundled assets are read-only in packaged apps.",
    );
  }
}

/** A dictionary id must be a safe, file-name-friendly slug (no path traversal). */
function assertValidId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(
      `invalid dictionary id "${id}" (use lowercase letters, digits and hyphens).`,
    );
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file. */
async function writeFileAtomic(
  filePath: string,
  content: string,
): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

/** Persist a mutated index and drop the cache so reads see it immediately. */
async function writeIndex(index: BundledDictionaryIndex): Promise<void> {
  await writeFileAtomic(dictionariesIndexPath(), serializeIndex(index));
  invalidateIndexCache();
}

/**
 * Replace a dictionary's entries wholesale, preserving version/exportedAt, and
 * keep index.entryCount in sync.
 */
export async function writeDictionaryEntries(
  id: string,
  entries: DictionaryEntry[],
  rename?: { from: string; to: string },
): Promise<void> {
  assertEditable();
  const { meta, file, raw } = await readBundledDictionaryFile(id);
  // Preserve the hand-authored blank-line group separators: carry a renamed
  // word's separator over to its new word, and drop separators whose entry no
  // longer exists (deleted, or moved into a new word that isn't separated).
  const present = new Set(entries.map((e) => e.word));
  const blankAfter = parseBlankLineGroups(raw)
    .map((w) => (rename && w === rename.from ? rename.to : w))
    .filter((w) => present.has(w));
  const nextFile: DictionaryFile = {
    version: file.version,
    ...(file.exportedAt !== undefined ? { exportedAt: file.exportedAt } : {}),
    entries,
  };
  await writeFileAtomic(
    dictionaryFilePath(meta.file),
    serializeDictionaryFile(nextFile, blankAfter),
  );
  const index = await readBundledIndex();
  await writeIndex(setEntryCount(index, id, entries.length));
}

/** Add one entry (throws on a duplicate word). */
export async function addDictionaryEntry(
  id: string,
  entry: DictionaryEntry,
): Promise<void> {
  assertEditable();
  const { file } = await readBundledDictionaryFile(id);
  await writeDictionaryEntries(id, addEntry(file.entries, entry));
}

/** Edit the entry whose word === originalWord. */
export async function updateDictionaryEntry(
  id: string,
  originalWord: string,
  entry: DictionaryEntry,
): Promise<void> {
  assertEditable();
  const { file } = await readBundledDictionaryFile(id);
  await writeDictionaryEntries(
    id,
    updateEntry(file.entries, originalWord, entry),
    originalWord !== entry.word
      ? { from: originalWord, to: entry.word }
      : undefined,
  );
}

/** Remove the entry whose word matches. */
export async function removeDictionaryEntry(
  id: string,
  word: string,
): Promise<void> {
  assertEditable();
  const { file } = await readBundledDictionaryFile(id);
  await writeDictionaryEntries(id, removeEntry(file.entries, word));
}

/** Create a brand-new dictionary file and register it in index.json. */
export async function createDictionary(
  meta: Omit<BundledDictionary, "entryCount" | "file">,
  entries: DictionaryEntry[] = [],
): Promise<BundledDictionary> {
  assertEditable();
  assertValidId(meta.id);
  const index = await readBundledIndex();
  if (index.dictionaries.some((d) => d.id === meta.id)) {
    throw new Error(`dictionary already exists: ${meta.id}`);
  }
  const fileName = `${meta.id}.json`;
  const fullMeta: BundledDictionary = {
    ...meta,
    entryCount: entries.length,
    file: fileName,
  };
  const file: DictionaryFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
  await writeFileAtomic(
    dictionaryFilePath(fileName),
    serializeDictionaryFile(file),
  );
  await writeIndex(upsertIndexEntry(index, fullMeta));
  return fullMeta;
}

/** Update a dictionary's metadata (id / entryCount / file are not editable). */
export async function updateDictionaryMeta(
  id: string,
  patch: Partial<Omit<BundledDictionary, "id" | "entryCount" | "file">>,
): Promise<BundledDictionary> {
  assertEditable();
  const index = await readBundledIndex();
  const current = index.dictionaries.find((d) => d.id === id);
  if (!current) throw new Error(`unknown dictionary id: ${id}`);
  const nextMeta: BundledDictionary = { ...current, ...patch };
  await writeIndex(upsertIndexEntry(index, nextMeta));
  return nextMeta;
}

/** Delete a dictionary file and remove it from index.json + the active set. */
export async function removeDictionary(id: string): Promise<void> {
  assertEditable();
  const index = await readBundledIndex();
  const meta = index.dictionaries.find((d) => d.id === id);
  if (!meta) throw new Error(`unknown dictionary id: ${id}`);
  try {
    await fs.unlink(dictionaryFilePath(meta.file));
  } catch (err) {
    logger.main.warn(`[dictionary-library] could not delete ${meta.file}:`, err);
  }
  await writeIndex(removeIndexEntry(index, id));
  await deactivateDictionary(id);
}
