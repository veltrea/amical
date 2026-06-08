import { app } from "electron";
import path from "node:path";

/**
 * Read-only source of the shipped dictionary catalog (the "seed"). In packaged
 * builds the `./assets` directory is copied into `Resources/assets` via the
 * `extraResource` entry in `forge.config.ts`; that copy is read-only — writing
 * into the app bundle breaks the codesign seal and silently revokes the app's
 * TCC (microphone / accessibility) permissions. In dev runs the source tree
 * under `apps/desktop/assets/dictionaries` is both the seed and the live store.
 *
 * seed.ts copies from here into the writable store (`dictionariesDir`) on first
 * run, and pulls in newly shipped dictionaries on update.
 */
export function bundledDictionariesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "dictionaries");
  }
  return path.join(app.getAppPath(), "assets", "dictionaries");
}

/** Absolute path of the seed index catalog (`index.json`). */
export function bundledDictionariesIndexPath(): string {
  return path.join(bundledDictionariesDir(), "index.json");
}

/** Absolute path of an individual seed dictionary file. */
export function bundledDictionaryFilePath(filename: string): string {
  return path.join(bundledDictionariesDir(), filename);
}

/**
 * Writable location of the live dictionary catalog — the single path every read
 * and write goes through (catalog.ts, authoring.ts, operations.ts and the ASR
 * pipeline all resolve here). In packaged builds this is userData, which is
 * writable and does not affect the app's code signature, so end users can edit
 * dictionaries without revoking permissions. In dev runs it stays the source
 * tree, so a maintainer's edits land in git and ship in the next release.
 *
 * See SPEC-dictionary-library.md §3.5.
 */
export function dictionariesDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "dictionaries");
  }
  return path.join(app.getAppPath(), "assets", "dictionaries");
}

/** Absolute path of the index catalog (`index.json`). */
export function dictionariesIndexPath(): string {
  return path.join(dictionariesDir(), "index.json");
}

/** Absolute path of an individual dictionary file. */
export function dictionaryFilePath(filename: string): string {
  return path.join(dictionariesDir(), filename);
}
