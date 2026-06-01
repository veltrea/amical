import { eq, desc, asc, like, count, gt, sql, inArray } from "drizzle-orm";
import { db } from ".";
import { vocabulary, type Vocabulary, type NewVocabulary } from "./schema";

// Create a new vocabulary word
export async function createVocabularyWord(
  data: Omit<NewVocabulary, "id" | "createdAt" | "updatedAt">,
) {
  const now = new Date();

  const newWord: NewVocabulary = {
    ...data,
    dateAdded: data.dateAdded || now,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.insert(vocabulary).values(newWord).returning();
  return result[0];
}

/**
 * Load every vocabulary row, including inactive ones. Used by the export
 * feature and the settings UI list. The transcription pipeline now uses
 * `getActiveVocabulary` so that rows toggled off in the dictionary library
 * UI are silently skipped without being deleted.
 */
export async function getAllVocabulary(): Promise<Vocabulary[]> {
  return await db.select().from(vocabulary);
}

/**
 * Load only vocabulary rows with isActive=true. This is the entry point used
 * by the ASR / LLM hint pipeline (`transcription-service.ts`). Inactive rows
 * (e.g. a bundled dictionary the user has temporarily turned off) are kept
 * in the DB but excluded from replacement and from hint selection.
 *
 * Returning every active row is intentional — caps belong on the hint
 * selection step, not on storage. See SPEC-dictionary-library.md §5.
 */
export async function getActiveVocabulary(): Promise<Vocabulary[]> {
  return await db.select().from(vocabulary).where(eq(vocabulary.isActive, true));
}

// Get all vocabulary words with pagination and sorting
export async function getVocabulary(
  options: {
    limit?: number;
    offset?: number;
    sortBy?: "word" | "dateAdded" | "usageCount";
    sortOrder?: "asc" | "desc";
    search?: string;
  } = {},
) {
  const {
    limit = 50,
    offset = 0,
    sortBy = "dateAdded",
    sortOrder = "desc",
    search,
  } = options;

  // Determine sort column
  let sortColumn;
  switch (sortBy) {
    case "word":
      sortColumn = vocabulary.word;
      break;
    case "usageCount":
      sortColumn = vocabulary.usageCount;
      break;
    default:
      sortColumn = vocabulary.dateAdded;
  }

  const orderFn = sortOrder === "asc" ? asc : desc;

  // Build query with conditional where clause
  if (search) {
    return await db
      .select()
      .from(vocabulary)
      .where(like(vocabulary.word, `%${search}%`))
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  } else {
    return await db
      .select()
      .from(vocabulary)
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  }
}

// Get vocabulary word by ID
export async function getVocabularyById(id: number) {
  const result = await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.id, id));
  return result[0] || null;
}

// Get vocabulary word by word text
export async function getVocabularyByWord(word: string) {
  const result = await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.word, word.toLowerCase()));
  return result[0] || null;
}

// Update vocabulary word
export async function updateVocabulary(
  id: number,
  data: Partial<Omit<Vocabulary, "id" | "createdAt">>,
) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  const result = await db
    .update(vocabulary)
    .set(updateData)
    .where(eq(vocabulary.id, id))
    .returning();

  return result[0] || null;
}

// Delete vocabulary word
export async function deleteVocabulary(id: number) {
  const result = await db
    .delete(vocabulary)
    .where(eq(vocabulary.id, id))
    .returning();

  return result[0] || null;
}

// Get vocabulary count
export async function getVocabularyCount(search?: string) {
  if (search) {
    const result = await db
      .select({ count: count() })
      .from(vocabulary)
      .where(like(vocabulary.word, `%${search}%`));
    return result[0]?.count || 0;
  } else {
    const result = await db.select({ count: count() }).from(vocabulary);
    return result[0]?.count || 0;
  }
}

// Track word usage - increment usage count atomically
export async function trackWordUsage(word: string) {
  // Use atomic update with SQL increment to avoid race conditions
  const result = await db
    .update(vocabulary)
    .set({
      usageCount: sql`${vocabulary.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(vocabulary.word, word.toLowerCase()))
    .returning();

  return result[0] || null;
}

// Get most frequently used words
export async function getMostUsedWords(limit = 10) {
  return await db
    .select()
    .from(vocabulary)
    .where(gt(vocabulary.usageCount, 0)) // Only words that have been used
    .orderBy(desc(vocabulary.usageCount))
    .limit(limit);
}

// Search vocabulary words
export async function searchVocabulary(searchTerm: string, limit = 20) {
  return await db
    .select()
    .from(vocabulary)
    .where(like(vocabulary.word, `%${searchTerm}%`))
    .orderBy(asc(vocabulary.word))
    .limit(limit);
}

// Bulk import vocabulary words
export async function bulkImportVocabulary(
  words: Omit<NewVocabulary, "id" | "createdAt" | "updatedAt">[],
) {
  const now = new Date();

  const vocabularyWords = words.map((word) => ({
    ...word,
    dateAdded: word.dateAdded || now,
    createdAt: now,
    updatedAt: now,
  }));

  return await db.insert(vocabulary).values(vocabularyWords).returning();
}

/**
 * Import vocabulary entries from a user-supplied list (typically loaded from
 * a JSON file exported by another Amical install). Duplicates against the
 * existing table are resolved by `mode`:
 *   - "skip":      keep the existing row, return the input entry in `skipped`
 *   - "overwrite": update the existing row's replacementWord / isReplacement
 *
 * Existing `word` rows are matched by lowercase `word` to follow the same
 * convention as `getVocabularyByWord`. Rows that were never in the table get
 * inserted with a fresh `dateAdded` of `now`.
 */
export interface VocabularyImportEntry {
  word: string;
  replacementWord?: string | null;
  isReplacement?: boolean;
}

export interface VocabularyImportResult {
  inserted: number;
  updated: number;
  skipped: VocabularyImportEntry[];
}

export async function importVocabularyEntries(
  entries: VocabularyImportEntry[],
  mode: "skip" | "overwrite",
  source: string | null = null,
): Promise<VocabularyImportResult> {
  if (entries.length === 0) {
    return { inserted: 0, updated: 0, skipped: [] };
  }

  const normalized = entries
    .map((e) => ({
      word: e.word.toLowerCase().trim(),
      replacementWord: e.replacementWord ?? null,
      isReplacement: e.isReplacement ?? false,
    }))
    .filter((e) => e.word.length > 0);

  if (normalized.length === 0) {
    return { inserted: 0, updated: 0, skipped: [] };
  }

  const words = normalized.map((e) => e.word);
  const existingRows = await db
    .select()
    .from(vocabulary)
    .where(inArray(vocabulary.word, words));
  const existingMap = new Map(existingRows.map((r) => [r.word, r]));

  const now = new Date();
  let inserted = 0;
  let updated = 0;
  const skipped: VocabularyImportEntry[] = [];

  for (const entry of normalized) {
    const existing = existingMap.get(entry.word);
    if (existing) {
      if (mode === "skip") {
        skipped.push({
          word: entry.word,
          replacementWord: entry.replacementWord,
          isReplacement: entry.isReplacement,
        });
      } else {
        await db
          .update(vocabulary)
          .set({
            replacementWord: entry.replacementWord,
            isReplacement: entry.isReplacement,
            updatedAt: now,
          })
          .where(eq(vocabulary.id, existing.id));
        updated++;
      }
    } else {
      await db.insert(vocabulary).values({
        word: entry.word,
        replacementWord: entry.replacementWord,
        isReplacement: entry.isReplacement,
        // Tag the row's origin when a source is supplied (e.g.
        // "library:services"). User-driven imports pass null so the row
        // looks identical to a manually added one.
        source: source ?? null,
        dateAdded: now,
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

/**
 * Aggregate counts grouped by the `source` column. Used by the dictionary
 * library UI to report how many rows came from each bundled dictionary and
 * how many are currently active.
 *
 * Rows with source = NULL (user-authored) are excluded from this result —
 * callers that need user-authored counts use `getVocabularyCount` instead.
 */
export interface VocabularySourceSummary {
  source: string;
  totalCount: number;
  activeCount: number;
}

export async function getVocabularySourceSummaries(): Promise<
  VocabularySourceSummary[]
> {
  const rows = await db
    .select({
      source: vocabulary.source,
      totalCount: count(),
      // SUM(CASE WHEN is_active THEN 1 ELSE 0 END) counts active rows per
      // group in a single round-trip. We coerce to number on the JS side
      // because SQLite returns this as a string for large groups.
      activeCount: sql<number>`SUM(CASE WHEN ${vocabulary.isActive} THEN 1 ELSE 0 END)`,
    })
    .from(vocabulary)
    .where(sql`${vocabulary.source} IS NOT NULL`)
    .groupBy(vocabulary.source);

  return rows.map((r) => ({
    source: r.source ?? "",
    totalCount: Number(r.totalCount ?? 0),
    activeCount: Number(r.activeCount ?? 0),
  }));
}

/**
 * Delete every row tagged with the given source value. Used by the
 * dictionary library UI when the user clicks "Remove" on an installed
 * bundled dictionary. Returns the number of rows actually removed.
 */
export async function deleteVocabularyBySource(
  source: string,
): Promise<{ deleted: number }> {
  const rows = await db
    .delete(vocabulary)
    .where(eq(vocabulary.source, source))
    .returning({ id: vocabulary.id });
  return { deleted: rows.length };
}

/**
 * Toggle the `isActive` flag for every row with the given source value.
 * Returns the number of rows touched (== rows changed since the
 * predicate matches all rows of that source regardless of prior state).
 */
export async function setVocabularySourceActive(
  source: string,
  isActive: boolean,
): Promise<{ updated: number }> {
  const rows = await db
    .update(vocabulary)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(vocabulary.source, source))
    .returning({ id: vocabulary.id });
  return { updated: rows.length };
}
