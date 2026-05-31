import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from ".";
import {
  misrecognitionCandidates,
  misrecognitionScanState,
  type MisrecognitionCandidate,
} from "./schema";

export interface ListCandidatesOptions {
  limit?: number;
  offset?: number;
  sortBy?: "occurrenceCount" | "lastSeenAt" | "word";
  sortOrder?: "asc" | "desc";
  includeDismissed?: boolean;
}

export async function listCandidates(
  options: ListCandidatesOptions = {},
): Promise<MisrecognitionCandidate[]> {
  const {
    limit = 50,
    offset = 0,
    sortBy = "occurrenceCount",
    sortOrder = "desc",
    includeDismissed = false,
  } = options;

  const column =
    sortBy === "word"
      ? misrecognitionCandidates.word
      : sortBy === "lastSeenAt"
        ? misrecognitionCandidates.lastSeenAt
        : misrecognitionCandidates.occurrenceCount;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const where = includeDismissed
    ? undefined
    : eq(misrecognitionCandidates.dismissed, false);

  let q = db.select().from(misrecognitionCandidates).$dynamic();
  if (where) q = q.where(where);
  return await q.orderBy(orderFn(column)).limit(limit).offset(offset);
}

export async function countCandidates(includeDismissed = false) {
  const where = includeDismissed
    ? undefined
    : eq(misrecognitionCandidates.dismissed, false);
  let q = db
    .select({ value: sql<number>`count(*)` })
    .from(misrecognitionCandidates)
    .$dynamic();
  if (where) q = q.where(where);
  const rows = await q;
  return rows[0]?.value ?? 0;
}

export async function dismissCandidates(ids: number[]) {
  if (ids.length === 0) return;
  const now = new Date();
  await db
    .update(misrecognitionCandidates)
    .set({ dismissed: true, dismissedAt: now, updatedAt: now })
    .where(inArray(misrecognitionCandidates.id, ids));
}

export async function deleteCandidates(ids: number[]) {
  if (ids.length === 0) return;
  await db
    .delete(misrecognitionCandidates)
    .where(inArray(misrecognitionCandidates.id, ids));
}

export async function getCandidatesByIds(ids: number[]) {
  if (ids.length === 0) return [];
  return await db
    .select()
    .from(misrecognitionCandidates)
    .where(inArray(misrecognitionCandidates.id, ids));
}

export interface UpsertCandidateInput {
  word: string;
  normalizedKey: string;
  occurrencesDelta: number; // how many new occurrences observed this scan
}

/**
 * Upsert a batch of candidates. Each call adds `occurrencesDelta` to existing
 * rows (and bumps `lastSeenAt`), or inserts a new row. Dismissed rows are
 * never resurrected by upsert — we skip them at insert via the partial unique
 * index, but since SQLite doesn't easily give us that, we filter manually.
 */
export async function upsertCandidates(
  inputs: UpsertCandidateInput[],
): Promise<{ inserted: number; updated: number }> {
  if (inputs.length === 0) return { inserted: 0, updated: 0 };
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  // Read existing rows (incl. dismissed) for all words we are about to write.
  const words = inputs.map((i) => i.word);
  const existing = await db
    .select()
    .from(misrecognitionCandidates)
    .where(inArray(misrecognitionCandidates.word, words));
  const existingByWord = new Map(existing.map((r) => [r.word, r]));

  for (const input of inputs) {
    const row = existingByWord.get(input.word);
    if (row) {
      if (row.dismissed) continue; // never resurrect
      await db
        .update(misrecognitionCandidates)
        .set({
          occurrenceCount: row.occurrenceCount + input.occurrencesDelta,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(misrecognitionCandidates.id, row.id));
      updated++;
    } else {
      await db.insert(misrecognitionCandidates).values({
        word: input.word,
        normalizedKey: input.normalizedKey,
        occurrenceCount: input.occurrencesDelta,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }
  }
  return { inserted, updated };
}

// --- Scan state -------------------------------------------------------------

export async function getScanState() {
  const rows = await db
    .select()
    .from(misrecognitionScanState)
    .where(eq(misrecognitionScanState.id, 1));
  if (rows[0]) return rows[0];
  await db
    .insert(misrecognitionScanState)
    .values({ id: 1, lastScannedTranscriptionId: 0, lastScanAt: null });
  return {
    id: 1,
    lastScannedTranscriptionId: 0,
    lastScanAt: null as Date | null,
  };
}

export async function setScanState(opts: {
  lastScannedTranscriptionId: number;
  lastScanAt: Date;
}) {
  await getScanState(); // ensure row exists
  await db
    .update(misrecognitionScanState)
    .set({
      lastScannedTranscriptionId: opts.lastScannedTranscriptionId,
      lastScanAt: opts.lastScanAt,
    })
    .where(eq(misrecognitionScanState.id, 1));
}

export async function resetScanState() {
  await getScanState();
  await db
    .update(misrecognitionScanState)
    .set({ lastScannedTranscriptionId: 0, lastScanAt: null })
    .where(eq(misrecognitionScanState.id, 1));
}

// --- Helpers ----------------------------------------------------------------

export { and, eq, gt };
