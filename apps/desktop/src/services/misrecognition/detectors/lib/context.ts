/**
 * Token-count + context-sample collector shared by detectors that need to
 * know each surface's frequency and a few sample occurrences.
 *
 * Called once per scan, result is shared across detectors that need it
 * (the scan loop holds a Map; each detector reads from it).
 */

import type { ContextSample, ScanInputRow } from "../types";
import { tokenize } from "./text";

export interface TokenInfo {
  word: string;
  count: number;
  contextSamples: ContextSample[];
}

const MAX_CONTEXT_SAMPLES = 3;

export function countTokensWithContext(
  rows: ScanInputRow[],
): Map<string, TokenInfo> {
  const map = new Map<string, TokenInfo>();
  for (const row of rows) {
    const tokens = tokenize(row.text);
    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i];
      let info = map.get(word);
      if (!info) {
        info = { word, count: 0, contextSamples: [] };
        map.set(word, info);
      }
      info.count++;
      if (info.contextSamples.length < MAX_CONTEXT_SAMPLES) {
        info.contextSamples.push({
          left: i > 0 ? tokens[i - 1] : "",
          right: i < tokens.length - 1 ? tokens[i + 1] : "",
          transcriptionId: row.id,
        });
      }
    }
  }
  return map;
}
