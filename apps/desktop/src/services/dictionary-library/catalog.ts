import { promises as fs } from "node:fs";
import { logger } from "../../main/logger";
import {
  dictionariesIndexPath,
  dictionaryFilePath,
} from "./paths";

/**
 * Static metadata for a single bundled dictionary, as written in
 * `apps/desktop/assets/dictionaries/index.json`. See SPEC-dictionary-library.md
 * §3.2 for the field reference.
 */
export interface BundledDictionary {
  id: string;
  name: string;
  name_ja?: string;
  description: string;
  description_ja?: string;
  category: string;
  language: string;
  tags: string[];
  entryCount: number;
  file: string;
}

export interface BundledDictionaryIndex {
  version: number;
  dictionaries: BundledDictionary[];
}

/**
 * Per-row payload used by every dictionary file. Compatible with the JSON
 * format produced by `vocabulary.exportAll`, so the same import path can be
 * reused without translation.
 */
export interface DictionaryEntry {
  word: string;
  replacementWord: string | null;
  isReplacement: boolean;
}

export interface DictionaryFile {
  version: number;
  exportedAt?: string;
  entries: DictionaryEntry[];
}

let cachedIndex: BundledDictionaryIndex | null = null;

/**
 * Read and validate `index.json`. The result is cached for the lifetime of
 * the process because the catalog is bundled at build time and never changes
 * at runtime.
 */
export async function readBundledIndex(): Promise<BundledDictionaryIndex> {
  if (cachedIndex) return cachedIndex;

  const indexPath = dictionariesIndexPath();
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch (err) {
    logger.main.error(
      `[dictionary-library] failed to read index at ${indexPath}:`,
      err,
    );
    throw new Error(
      `Dictionary index not found at ${indexPath}. The app bundle may be incomplete.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Dictionary index is not valid JSON: ${(err as Error).message}`);
  }

  if (!isBundledDictionaryIndex(parsed)) {
    throw new Error(
      "Dictionary index has an unexpected shape (missing version or dictionaries).",
    );
  }
  cachedIndex = parsed;
  return parsed;
}

/** Read a single dictionary's JSON file by id, resolving its `file` field. */
export async function readBundledDictionaryFile(
  id: string,
): Promise<{ meta: BundledDictionary; file: DictionaryFile }> {
  const index = await readBundledIndex();
  const meta = index.dictionaries.find((d) => d.id === id);
  if (!meta) {
    throw new Error(`Dictionary "${id}" is not listed in index.json.`);
  }
  const filePath = dictionaryFilePath(meta.file);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as DictionaryFile;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(
      `Dictionary file ${meta.file} is malformed (missing entries array).`,
    );
  }
  return { meta, file: parsed };
}

function isBundledDictionaryIndex(
  value: unknown,
): value is BundledDictionaryIndex {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "number") return false;
  if (!Array.isArray(v.dictionaries)) return false;
  for (const d of v.dictionaries) {
    if (typeof d !== "object" || d === null) return false;
    const r = d as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.name !== "string" ||
      typeof r.description !== "string" ||
      typeof r.category !== "string" ||
      typeof r.language !== "string" ||
      !Array.isArray(r.tags) ||
      typeof r.entryCount !== "number" ||
      typeof r.file !== "string"
    ) {
      return false;
    }
  }
  return true;
}
