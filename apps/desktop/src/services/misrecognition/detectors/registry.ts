/**
 * Detector registry. Detectors register themselves at import time via
 * `registerDetector`, and the scanner picks them up by ID through the public
 * accessors.
 */

import type { Detector, DetectorDescriptor } from "./types";

const registry = new Map<string, Detector>();

export function registerDetector(d: Detector): void {
  if (registry.has(d.descriptor.id)) {
    throw new Error(
      `Duplicate misrecognition detector id: ${d.descriptor.id}`,
    );
  }
  registry.set(d.descriptor.id, d);
}

export function getDetector(id: string): Detector | undefined {
  return registry.get(id);
}

export function listDetectors(): Detector[] {
  return [...registry.values()];
}

export function listDetectorDescriptors(): DetectorDescriptor[] {
  return [...registry.values()].map((d) => d.descriptor);
}
