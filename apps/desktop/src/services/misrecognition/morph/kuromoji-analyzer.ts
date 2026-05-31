/**
 * kuromoji-backed {@link MorphAnalyzer}.
 *
 * Dictionary location:
 * - In dev, the dict lives at `<monorepo>/node_modules/kuromoji/dict`.
 *   We use `app.getAppPath()` (= apps/desktop) and walk up to find it.
 * - In a packaged app, the dict is copied to `Resources/dict` by the
 *   forge.config `extraResource` entry; we use `process.resourcesPath`.
 *
 * The analyzer caches tokenization results per input string so multiple
 * detectors running on the same scan can share work without re-tokenizing.
 */

import { app } from "electron";
import * as path from "node:path";
import * as kuromoji from "kuromoji";
import type { MorphAnalyzer, MorphToken } from "../detectors/types";

let sharedTokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;
let initPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null =
  null;

function resolveDicPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "dict");
  }
  // dev: apps/desktop → monorepo root → node_modules/kuromoji/dict
  return path.join(
    app.getAppPath(),
    "..",
    "..",
    "node_modules",
    "kuromoji",
    "dict",
  );
}

async function buildTokenizer() {
  if (sharedTokenizer) return sharedTokenizer;
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: resolveDicPath() }).build((err, t) => {
      if (err) {
        initPromise = null;
        reject(err);
        return;
      }
      sharedTokenizer = t;
      resolve(t);
    });
  });
  return initPromise;
}

export class KuromojiAnalyzer implements MorphAnalyzer {
  private cache = new Map<string, MorphToken[]>();

  async init(): Promise<void> {
    await buildTokenizer();
  }

  tokenize(text: string): MorphToken[] {
    const cached = this.cache.get(text);
    if (cached) return cached;
    if (!sharedTokenizer) {
      throw new Error("KuromojiAnalyzer.tokenize() called before init()");
    }
    const tokens = sharedTokenizer.tokenize(text).map<MorphToken>((t) => ({
      surface: t.surface_form,
      reading: t.reading && t.reading !== "*" ? t.reading : null,
      pos: t.pos,
      basicForm:
        t.basic_form && t.basic_form !== "*" ? t.basic_form : undefined,
    }));
    this.cache.set(text, tokens);
    return tokens;
  }
}
