import { app } from "electron";
import path from "node:path";

/**
 * Filesystem location of the bundled dictionary catalog. In packaged builds
 * the `./assets` directory is copied into `Resources/assets` via the
 * `extraResource` entry in `forge.config.ts`. In dev runs we read straight
 * from the source tree under `apps/desktop/assets/dictionaries`.
 *
 * See SPEC-dictionary-library.md §3.5.
 */
export function dictionariesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "dictionaries");
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
