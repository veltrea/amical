import type {
  BundledDictionary,
  BundledDictionaryIndex,
  DictionaryEntry,
  DictionaryFile,
} from "./catalog";

/**
 * Serialize helpers that reproduce the EXACT on-disk formatting of the bundled
 * dictionary assets. A GUI edit must produce a minimal git diff instead of
 * rewriting every line — the dictionaries are hand-authored and tracked in git.
 *
 * `JSON.stringify(obj, null, 2)` does NOT match the hand layout (one entry per
 * line in `<id>.json`; `tags` on a single line in `index.json`), so we format
 * by hand. The round-trip tests in tests/utils/dictionary-serialize.test.ts pin
 * every existing dictionary file to its current bytes.
 *
 * Pure module: it imports only types (erased at compile time), so it stays free
 * of the electron/fs dependencies that catalog.ts pulls in and can be unit
 * tested directly without mocks.
 */

/** One dictionary entry rendered on a single 4-space-indented line. */
function formatEntry(entry: DictionaryEntry): string {
  const word = JSON.stringify(entry.word);
  const replacement = JSON.stringify(entry.replacementWord ?? null);
  const isReplacement = JSON.stringify(entry.isReplacement);
  return `    { "word": ${word}, "replacementWord": ${replacement}, "isReplacement": ${isReplacement} }`;
}

/**
 * Render a dictionary file (`<id>.json`) matching the bundled formatting.
 *
 * `blankAfter` lists words whose entry should be followed by a blank line —
 * the hand-authored group separators some dictionaries use. JSON parsing drops
 * those lines, so callers recover them with parseBlankLineGroups() and pass
 * them back here to round-trip a file exactly across an edit.
 */
export function serializeDictionaryFile(
  file: DictionaryFile,
  blankAfter?: Iterable<string>,
): string {
  const blanks = blankAfter ? new Set(blankAfter) : null;
  let out = "{\n";
  out += `  "version": ${JSON.stringify(file.version)},\n`;
  if (file.exportedAt !== undefined) {
    out += `  "exportedAt": ${JSON.stringify(file.exportedAt)},\n`;
  }
  if (file.entries.length === 0) {
    out += `  "entries": []\n`;
  } else {
    out += `  "entries": [\n`;
    const last = file.entries.length - 1;
    file.entries.forEach((entry, i) => {
      out += formatEntry(entry);
      if (i < last) out += ",";
      out += "\n";
      // Reproduce a group separator after this entry, but never right before
      // the closing `]` (no bundled dictionary ends on a blank line).
      if (i < last && blanks?.has(entry.word)) out += "\n";
    });
    out += `  ]\n`;
  }
  out += "}\n";
  return out;
}

/** Matches an entry line and captures its JSON-quoted `word` literal. */
const ENTRY_WORD_RE = /^\s*\{\s*"word":\s*("(?:[^"\\]|\\.)*")/;

/**
 * Extract hand-authored blank-line group separators from a dictionary file's
 * raw text: the words whose entry line is immediately followed by a blank line.
 * Feed the result to serializeDictionaryFile() to preserve the separators
 * through an edit. Every separator in the bundled assets sits between two entry
 * lines (never after `[` or before `]`), so keying on the preceding word
 * reproduces each file exactly.
 */
export function parseBlankLineGroups(rawText: string): string[] {
  const lines = rawText.split("\n");
  const words: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i + 1].trim() !== "") continue;
    const m = ENTRY_WORD_RE.exec(lines[i]);
    if (!m) continue;
    try {
      words.push(JSON.parse(m[1]) as string);
    } catch {
      // Malformed word literal — skip rather than corrupt the separator list.
    }
  }
  return words;
}

/** Tags rendered on one line: ["a", "b", "c"]. */
function formatTags(tags: string[]): string {
  return `[${tags.map((t) => JSON.stringify(t)).join(", ")}]`;
}

/** One dictionary's metadata block in index.json, 6-space-indented fields. */
function formatIndexEntry(meta: BundledDictionary): string {
  let s = "    {\n";
  s += `      "id": ${JSON.stringify(meta.id)},\n`;
  s += `      "name": ${JSON.stringify(meta.name)},\n`;
  if (meta.name_ja !== undefined) {
    s += `      "name_ja": ${JSON.stringify(meta.name_ja)},\n`;
  }
  s += `      "description": ${JSON.stringify(meta.description)},\n`;
  if (meta.description_ja !== undefined) {
    s += `      "description_ja": ${JSON.stringify(meta.description_ja)},\n`;
  }
  s += `      "category": ${JSON.stringify(meta.category)},\n`;
  s += `      "language": ${JSON.stringify(meta.language)},\n`;
  s += `      "tags": ${formatTags(meta.tags)},\n`;
  s += `      "entryCount": ${JSON.stringify(meta.entryCount)},\n`;
  s += `      "file": ${JSON.stringify(meta.file)}\n`;
  s += "    }";
  return s;
}

/** Render index.json matching the bundled formatting. */
export function serializeIndex(index: BundledDictionaryIndex): string {
  let out = "{\n";
  out += `  "version": ${JSON.stringify(index.version)},\n`;
  if (index.dictionaries.length === 0) {
    out += `  "dictionaries": []\n`;
  } else {
    out += `  "dictionaries": [\n`;
    out += index.dictionaries.map(formatIndexEntry).join(",\n") + "\n";
    out += `  ]\n`;
  }
  out += "}\n";
  return out;
}

// ---- pure index transforms ----

/** Insert or replace a dictionary's metadata, keyed by id. */
export function upsertIndexEntry(
  index: BundledDictionaryIndex,
  meta: BundledDictionary,
): BundledDictionaryIndex {
  const i = index.dictionaries.findIndex((d) => d.id === meta.id);
  const dictionaries = [...index.dictionaries];
  if (i === -1) dictionaries.push(meta);
  else dictionaries[i] = meta;
  return { ...index, dictionaries };
}

/** Remove a dictionary's metadata by id (no-op if absent). */
export function removeIndexEntry(
  index: BundledDictionaryIndex,
  id: string,
): BundledDictionaryIndex {
  return {
    ...index,
    dictionaries: index.dictionaries.filter((d) => d.id !== id),
  };
}

/** Set a dictionary's entryCount, keeping the rest of its metadata. */
export function setEntryCount(
  index: BundledDictionaryIndex,
  id: string,
  count: number,
): BundledDictionaryIndex {
  return {
    ...index,
    dictionaries: index.dictionaries.map((d) =>
      d.id === id ? { ...d, entryCount: count } : d,
    ),
  };
}

// ---- pure entry transforms (key = word; word is unique within a dictionary) ----

/** Append a new entry. Throws if an entry with the same word already exists. */
export function addEntry(
  entries: DictionaryEntry[],
  entry: DictionaryEntry,
): DictionaryEntry[] {
  if (entries.some((e) => e.word === entry.word)) {
    throw new Error(`entry already exists: ${entry.word}`);
  }
  return [...entries, entry];
}

/**
 * Replace the entry whose word === originalWord. Throws if it is missing, or if
 * the new word collides with a different existing entry.
 */
export function updateEntry(
  entries: DictionaryEntry[],
  originalWord: string,
  entry: DictionaryEntry,
): DictionaryEntry[] {
  const i = entries.findIndex((e) => e.word === originalWord);
  if (i === -1) throw new Error(`entry not found: ${originalWord}`);
  if (entry.word !== originalWord && entries.some((e) => e.word === entry.word)) {
    throw new Error(`entry already exists: ${entry.word}`);
  }
  const next = [...entries];
  next[i] = entry;
  return next;
}

/** Remove the entry whose word matches. Throws if missing. */
export function removeEntry(
  entries: DictionaryEntry[],
  word: string,
): DictionaryEntry[] {
  const i = entries.findIndex((e) => e.word === word);
  if (i === -1) throw new Error(`entry not found: ${word}`);
  return entries.filter((_, idx) => idx !== i);
}
