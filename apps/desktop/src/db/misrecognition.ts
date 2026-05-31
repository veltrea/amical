import { and, asc, desc, eq, gt, inArray, like, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from ".";
import {
  misrecognitionCandidates,
  misrecognitionScanState,
  type MisrecognitionCandidate,
} from "./schema";
import type { ContextSample } from "../services/misrecognition/detectors/types";

const MAX_CONTEXT_SAMPLES = 3;

export interface ListCandidatesOptions {
  limit?: number;
  offset?: number;
  // `detectorCount` orders by how many detectors flagged the row (= the
  // length of the JSON array stored in detector_ids), with occurrenceCount
  // as a deterministic tiebreaker so multi-tag candidates surface first.
  sortBy?: "occurrenceCount" | "lastSeenAt" | "word" | "detectorCount";
  sortOrder?: "asc" | "desc";
  includeDismissed?: boolean;
  // OR semantics: row matches if any of its detectorIds is in this list.
  filterDetectors?: string[];
  // Prefix LIKE on word.
  searchWord?: string;
  // Prefix LIKE on normalizedKey.
  searchReading?: string;
}

function buildWhereClauses(opts: ListCandidatesOptions): SQL | undefined {
  const clauses: (SQL | undefined)[] = [];
  if (!opts.includeDismissed) {
    clauses.push(eq(misrecognitionCandidates.dismissed, false));
  }
  if (opts.filterDetectors && opts.filterDetectors.length > 0) {
    const detectorClauses = opts.filterDetectors.map(
      (id) =>
        sql`${misrecognitionCandidates.detectorIds} LIKE ${`%"${id}"%`}`,
    );
    clauses.push(or(...detectorClauses));
  }
  if (opts.searchWord && opts.searchWord.length > 0) {
    clauses.push(
      like(misrecognitionCandidates.word, `${opts.searchWord}%`),
    );
  }
  if (opts.searchReading && opts.searchReading.length > 0) {
    clauses.push(
      like(misrecognitionCandidates.normalizedKey, `${opts.searchReading}%`),
    );
  }
  const filtered = clauses.filter((c): c is SQL => Boolean(c));
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  return and(...filtered);
}

export async function listCandidates(
  options: ListCandidatesOptions = {},
): Promise<MisrecognitionCandidate[]> {
  const {
    limit = 50,
    offset = 0,
    sortBy = "occurrenceCount",
    sortOrder = "desc",
  } = options;

  const orderFn = sortOrder === "asc" ? asc : desc;
  const orderClauses =
    sortBy === "word"
      ? [orderFn(misrecognitionCandidates.word)]
      : sortBy === "lastSeenAt"
        ? [orderFn(misrecognitionCandidates.lastSeenAt)]
        : sortBy === "detectorCount"
          ? [
              orderFn(
                sql`json_array_length(${misrecognitionCandidates.detectorIds})`,
              ),
              desc(misrecognitionCandidates.occurrenceCount),
            ]
          : [orderFn(misrecognitionCandidates.occurrenceCount)];

  const where = buildWhereClauses(options);

  let q = db.select().from(misrecognitionCandidates).$dynamic();
  if (where) q = q.where(where);
  return await q.orderBy(...orderClauses).limit(limit).offset(offset);
}

export async function countCandidates(
  options: Omit<ListCandidatesOptions, "limit" | "offset" | "sortBy" | "sortOrder"> = {},
) {
  const where = buildWhereClauses(options);
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
  detectorIds: string[]; // detectors that flagged this candidate in the scan
  contextSample?: ContextSample[];
  detectorScores?: Record<string, number>;
}

function unionDetectorIds(existing: unknown, incoming: string[]): string[] {
  const existingArr = Array.isArray(existing)
    ? (existing as string[])
    : [];
  return [...new Set([...existingArr, ...incoming])];
}

function mergeContextSamples(
  existing: unknown,
  incoming: ContextSample[] | undefined,
): ContextSample[] | null {
  const existingArr: ContextSample[] = Array.isArray(existing)
    ? (existing as ContextSample[])
    : [];
  // Keep newest first so the UI sees the most recent context at the top.
  const merged = [...(incoming ?? []), ...existingArr].slice(
    0,
    MAX_CONTEXT_SAMPLES,
  );
  return merged.length > 0 ? merged : null;
}

function mergeDetectorScores(
  existing: unknown,
  incoming: Record<string, number> | undefined,
): Record<string, number> | null {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, number>)
      : {};
  const merged = { ...base, ...(incoming ?? {}) };
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Upsert a batch of candidates. Each call adds `occurrencesDelta` to existing
 * rows (and bumps `lastSeenAt`), or inserts a new row. Dismissed rows are
 * never resurrected by upsert — we skip them at insert via the partial unique
 * index, but since SQLite doesn't easily give us that, we filter manually.
 *
 * For the v3 detector framework, each input also carries `detectorIds`
 * (union'd into the row), and optional `contextSample` / `detectorScores`
 * (merged with newest-first preference / per-detector overwrite).
 */
export async function upsertCandidates(
  inputs: UpsertCandidateInput[],
): Promise<{ inserted: number; updated: number }> {
  if (inputs.length === 0) return { inserted: 0, updated: 0 };
  const now = new Date();
  let inserted = 0;
  let updated = 0;

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
          detectorIds: unionDetectorIds(row.detectorIds, input.detectorIds),
          contextSample: mergeContextSamples(
            row.contextSample,
            input.contextSample,
          ),
          detectorScores: mergeDetectorScores(
            row.detectorScores,
            input.detectorScores,
          ),
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
        detectorIds: input.detectorIds,
        contextSample: input.contextSample ?? null,
        detectorScores: input.detectorScores ?? null,
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
