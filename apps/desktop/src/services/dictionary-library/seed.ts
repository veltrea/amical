import { app } from "electron";
import { promises as fs } from "node:fs";
import { logger } from "../../main/logger";
import {
  bundledDictionariesIndexPath,
  bundledDictionaryFilePath,
  dictionariesDir,
  dictionariesIndexPath,
  dictionaryFilePath,
} from "./paths";
import { serializeIndex } from "./serialize";
import { invalidateIndexCache, type BundledDictionaryIndex } from "./catalog";
import { computeDictionariesToAdd, mergeNewDictionaries } from "./seed-diff";

/** Write via a temp file + rename so a crash never leaves a half-written file. */
async function writeFileAtomic(
  filePath: string,
  content: string,
): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

/** Read + lightly validate an index.json, or null if it is missing or corrupt. */
async function readIndexOrNull(
  indexPath: string,
): Promise<BundledDictionaryIndex | null> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch {
    return null; // not created yet
  }
  try {
    const parsed = JSON.parse(raw) as BundledDictionaryIndex;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.version === "number" &&
      Array.isArray(parsed.dictionaries)
    ) {
      return parsed;
    }
  } catch {
    // fall through to the warning below
  }
  logger.main.warn(
    `[dictionary-seed] index at ${indexPath} is malformed; treating as unseeded`,
  );
  return null;
}

/**
 * Copy one shipped dictionary file into the writable store (atomically).
 * Returns false if the seed file is missing, so the caller can skip listing it
 * in the store index.
 */
async function copyBundledFile(filename: string): Promise<boolean> {
  try {
    const content = await fs.readFile(
      bundledDictionaryFilePath(filename),
      "utf8",
    );
    await writeFileAtomic(dictionaryFilePath(filename), content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed / update the writable dictionary store from the shipped (read-only)
 * bundle. Packaged builds only — in dev the store IS the source tree, so there
 * is nothing to seed.
 *
 *  - First run (store index missing or corrupt): copy the whole shipped catalog.
 *  - Subsequent runs: copy only dictionaries shipped since last time and append
 *    them to the store index. Existing dictionaries are never touched (the user
 *    may have edited them) and ids dropped from the bundle are kept.
 *
 * The store index is written last (atomically), so a crash mid-copy leaves the
 * store readable — readers only follow ids listed in the index — and the next
 * run recomputes the same diff. Never throws: a failed seed must not block
 * startup (an existing store keeps working; a missing one degrades to an empty
 * library rather than a crash).
 */
export async function seedDictionaryLibrary(): Promise<void> {
  if (!app.isPackaged) return; // dev edits the source tree directly

  try {
    await fs.mkdir(dictionariesDir(), { recursive: true });

    const bundled = await readIndexOrNull(bundledDictionariesIndexPath());
    if (!bundled) {
      logger.main.error(
        "[dictionary-seed] shipped index missing or invalid; skipping seed",
      );
      return;
    }

    const current = await readIndexOrNull(dictionariesIndexPath());

    // First run (or unreadable store index): copy the whole catalog.
    if (!current) {
      for (const meta of bundled.dictionaries) {
        if (!(await copyBundledFile(meta.file))) {
          logger.main.warn(
            `[dictionary-seed] shipped file missing for "${meta.id}" (${meta.file}); skipping`,
          );
        }
      }
      await writeFileAtomic(dictionariesIndexPath(), serializeIndex(bundled));
      invalidateIndexCache();
      logger.main.info(
        `[dictionary-seed] initial seed: ${bundled.dictionaries.length} dictionaries`,
      );
      return;
    }

    // Update: import only newly shipped dictionaries.
    const toAdd = computeDictionariesToAdd(bundled, current);
    if (toAdd.length === 0) return;

    const added: BundledDictionaryIndex["dictionaries"] = [];
    for (const meta of toAdd) {
      if (await copyBundledFile(meta.file)) {
        added.push(meta);
      } else {
        logger.main.warn(
          `[dictionary-seed] shipped file missing for new "${meta.id}" (${meta.file}); skipping`,
        );
      }
    }
    if (added.length === 0) return;

    const next = mergeNewDictionaries(current, bundled.version, added);
    await writeFileAtomic(dictionariesIndexPath(), serializeIndex(next));
    invalidateIndexCache();
    logger.main.info(
      `[dictionary-seed] imported ${added.length} newly shipped dictionaries`,
    );
  } catch (err) {
    logger.main.error(
      "[dictionary-seed] seeding failed (continuing without it):",
      err,
    );
  }
}
