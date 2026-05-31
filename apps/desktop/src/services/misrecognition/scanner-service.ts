import { gt } from "drizzle-orm";
import { db } from "../../db";
import { transcriptions } from "../../db/schema";
import { getAllVocabulary } from "../../db/vocabulary";
import {
  getScanState,
  resetScanState,
  setScanState,
  upsertCandidates,
} from "../../db/misrecognition";
import { scanRows, type ScanInputRow } from "./scanner-core";

export interface ScanOptions {
  fullRescan?: boolean;
}

export interface ScanSummary {
  scannedTranscriptions: number;
  inserted: number;
  updated: number;
  maxTranscriptionId: number;
}

let running = false;

export function isScanRunning() {
  return running;
}

export async function runScan(
  options: ScanOptions = {},
): Promise<ScanSummary> {
  if (running) {
    throw new Error("scan already running");
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
      };
    }

    const vocab = (await getAllVocabulary()).map((v) => ({
      word: v.word,
      replacementWord: v.replacementWord,
    }));

    const result = scanRows(rows, vocab);

    // Phase A scaffolding: the legacy v1 scanner emits a single bag of
    // candidates with no detector id attached. Tag them as "legacy-v1" so
    // the new detectorIds column has a non-empty value until the rule
    // detectors land in Phase A.3 and replace this code path entirely.
    const upserts = result.candidates.map((c) => ({
      word: c.word,
      normalizedKey: c.normalizedKey,
      occurrencesDelta: c.occurrences,
      detectorIds: ["legacy-v1"],
    }));
    const { inserted, updated } = await upsertCandidates(upserts);

    await setScanState({
      lastScannedTranscriptionId: result.maxTranscriptionId,
      lastScanAt: new Date(),
    });

    return {
      scannedTranscriptions: result.scannedRowCount,
      inserted,
      updated,
      maxTranscriptionId: result.maxTranscriptionId,
    };
  } finally {
    running = false;
  }
}
