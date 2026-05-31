import { gt } from "drizzle-orm";
import { db } from "../../db";
import { transcriptions } from "../../db/schema";
import { getAllVocabulary } from "../../db/vocabulary";
import {
  getScanState,
  resetScanState,
  setScanState,
  upsertCandidates,
  type UpsertCandidateInput,
} from "../../db/misrecognition";
import {
  ensureDetectorsRegistered,
  getDetector,
  listDetectors,
} from "./detectors";
import type {
  Detector,
  DetectorContext,
  DetectorEmission,
  MorphAnalyzer,
  ScanInputRow,
  ContextSample,
} from "./detectors/types";
import { KuromojiAnalyzer } from "./morph/kuromoji-analyzer";

export interface ScanOptions {
  /**
   * IDs of detectors to run this scan. If omitted, every detector with
   * `defaultEnabled: true` runs. Unknown IDs are ignored.
   */
  detectorIds?: string[];
  fullRescan?: boolean;
}

export interface DetectorRunReport {
  detectorId: string;
  emitted: number;
  durationMs: number;
  error?: string;
}

export interface ScanSummary {
  scannedTranscriptions: number;
  inserted: number;
  updated: number;
  maxTranscriptionId: number;
  perDetector: DetectorRunReport[];
}

const MAX_CONTEXT_SAMPLES = 3;

let running = false;

export function isScanRunning(): boolean {
  return running;
}

function pickDetectors(ids?: string[]): Detector[] {
  ensureDetectorsRegistered();
  if (!ids || ids.length === 0) {
    return listDetectors().filter((d) => d.descriptor.defaultEnabled);
  }
  const out: Detector[] = [];
  for (const id of ids) {
    const d = getDetector(id);
    if (d) out.push(d);
  }
  return out;
}

function mergeEmission(
  bucket: Map<string, UpsertCandidateInput>,
  em: DetectorEmission,
): void {
  const existing = bucket.get(em.word);
  if (existing) {
    if (!existing.detectorIds.includes(em.detectorId)) {
      existing.detectorIds.push(em.detectorId);
    }
    // Different detectors may report different occurrence counts (each
    // counts what it saw); take the max so the row reflects the upper bound.
    if (em.occurrences > existing.occurrencesDelta) {
      existing.occurrencesDelta = em.occurrences;
    }
    if (em.contextSample && em.contextSample.length > 0) {
      const merged: ContextSample[] = [
        ...(existing.contextSample ?? []),
        ...em.contextSample,
      ].slice(0, MAX_CONTEXT_SAMPLES);
      existing.contextSample = merged;
    }
    if (em.score !== undefined) {
      existing.detectorScores = {
        ...(existing.detectorScores ?? {}),
        [em.detectorId]: em.score,
      };
    }
    return;
  }
  bucket.set(em.word, {
    word: em.word,
    normalizedKey: em.normalizedKey,
    occurrencesDelta: em.occurrences,
    detectorIds: [em.detectorId],
    contextSample: em.contextSample,
    detectorScores:
      em.score !== undefined ? { [em.detectorId]: em.score } : undefined,
  });
}

export async function runScan(
  options: ScanOptions = {},
): Promise<ScanSummary> {
  if (running) {
    throw new Error("scan already running");
  }
  const detectors = pickDetectors(options.detectorIds);
  if (detectors.length === 0) {
    throw new Error("no detectors selected");
  }

  running = true;
  try {
    if (options.fullRescan) {
      await resetScanState();
    }
    const state = await getScanState();
    const cursor = state.lastScannedTranscriptionId;

    const rows: ScanInputRow[] = await db
      .select({ id: transcriptions.id, text: transcriptions.text })
      .from(transcriptions)
      .where(gt(transcriptions.id, cursor));

    const emptyReports: DetectorRunReport[] = detectors.map((d) => ({
      detectorId: d.descriptor.id,
      emitted: 0,
      durationMs: 0,
    }));

    if (rows.length === 0) {
      await setScanState({
        lastScannedTranscriptionId: cursor,
        lastScanAt: new Date(),
      });
      return {
        scannedTranscriptions: 0,
        inserted: 0,
        updated: 0,
        maxTranscriptionId: cursor,
        perDetector: emptyReports,
      };
    }

    const vocab = (await getAllVocabulary()).map((v) => ({
      word: v.word,
      replacementWord: v.replacementWord,
    }));

    let morph: MorphAnalyzer | null = null;
    if (detectors.some((d) => d.descriptor.requiresMorph)) {
      const kuro = new KuromojiAnalyzer();
      await kuro.init();
      morph = kuro;
    }

    const ctx: DetectorContext = { rows, vocabulary: vocab, morph };
    const perDetector: DetectorRunReport[] = [];
    const merged = new Map<string, UpsertCandidateInput>();

    let maxId = cursor;
    for (const r of rows) if (r.id > maxId) maxId = r.id;

    for (const d of detectors) {
      const t0 = Date.now();
      try {
        const emissions = await d.run(ctx);
        for (const em of emissions) mergeEmission(merged, em);
        perDetector.push({
          detectorId: d.descriptor.id,
          emitted: emissions.length,
          durationMs: Date.now() - t0,
        });
      } catch (e) {
        perDetector.push({
          detectorId: d.descriptor.id,
          emitted: 0,
          durationMs: Date.now() - t0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const { inserted, updated } = await upsertCandidates([...merged.values()]);

    await setScanState({
      lastScannedTranscriptionId: maxId,
      lastScanAt: new Date(),
    });

    return {
      scannedTranscriptions: rows.length,
      inserted,
      updated,
      maxTranscriptionId: maxId,
      perDetector,
    };
  } finally {
    running = false;
  }
}
