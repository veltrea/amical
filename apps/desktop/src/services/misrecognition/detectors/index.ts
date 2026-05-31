/**
 * Entry point for the detector registry. Importers call
 * `ensureDetectorsRegistered()` once before listing or running detectors;
 * we do explicit-call registration (not import-time side effects) so the
 * bundler can't eliminate unreferenced detectors.
 *
 * Concrete detectors are added per phase (see SPEC-misrecognition-v3.md §6).
 */

import { registerDetector } from "./registry";
import { katakanaVariantDetector } from "./katakana-variant";
import { lowFrequencyRareDetector } from "./low-frequency-rare";
import { mixedScriptDetector } from "./mixed-script";
import { nearVocabularyDetector } from "./near-vocabulary";

let registered = false;

export function ensureDetectorsRegistered(): void {
  if (registered) return;
  registered = true;
  // Phase A.3: rule-based detectors
  registerDetector(katakanaVariantDetector);
  registerDetector(lowFrequencyRareDetector);
  registerDetector(mixedScriptDetector);
  registerDetector(nearVocabularyDetector);
  // Phase A.4: morphological detectors
  // Phase B:   statistical / phonetic detectors
  // Phase C:   LLM detectors
}

export {
  registerDetector,
  getDetector,
  listDetectors,
  listDetectorDescriptors,
} from "./registry";

export type {
  Detector,
  DetectorCategory,
  DetectorContext,
  DetectorDescriptor,
  DetectorEmission,
  ContextSample,
  MorphAnalyzer,
  MorphToken,
  ScanInputRow,
  VocabularyEntry,
} from "./types";
