import {
  getSettingsSection,
  updateSettingsSection,
} from "../../db/app-settings";
import {
  readBundledIndex,
  readBundledDictionaryFile,
  type BundledDictionary,
  type DictionaryEntry,
} from "./catalog";

/**
 * Model B: a bundled dictionary is either activated or not. Its words are
 * never written to the vocabulary table; the only persisted state is the
 * list of activated dictionary IDs in app_settings.activeDictionaries.
 */
export type DictionaryState = "active" | "inactive";

export interface DictionaryWithState extends BundledDictionary {
  state: DictionaryState;
}

/** Read the activated-dictionary ID list from app settings (never null). */
async function getActiveDictionaryIds(): Promise<string[]> {
  const ids = await getSettingsSection("activeDictionaries");
  return Array.isArray(ids) ? ids : [];
}

async function setActiveDictionaryIds(ids: string[]): Promise<void> {
  // De-dup + stable order so the persisted list stays clean.
  await updateSettingsSection("activeDictionaries", [...new Set(ids)]);
}

/**
 * Enumerate every bundled dictionary along with whether it is currently
 * activated. State is derived purely from app_settings — no DB query against
 * the vocabulary table.
 */
export async function listBundledDictionariesWithState(): Promise<
  DictionaryWithState[]
> {
  const [index, active] = await Promise.all([
    readBundledIndex(),
    getActiveDictionaryIds(),
  ]);
  const activeSet = new Set(active);
  return index.dictionaries.map((meta) => ({
    ...meta,
    state: activeSet.has(meta.id) ? "active" : "inactive",
  }));
}

/**
 * Activate a bundled dictionary by adding its ID to app_settings. Validates
 * that the ID exists in index.json first so we never persist a dangling ID.
 */
export async function activateDictionary(id: string): Promise<void> {
  const index = await readBundledIndex();
  if (!index.dictionaries.some((d) => d.id === id)) {
    throw new Error(`unknown dictionary id: ${id}`);
  }
  const active = await getActiveDictionaryIds();
  if (active.includes(id)) return;
  await setActiveDictionaryIds([...active, id]);
}

/** Deactivate a bundled dictionary by removing its ID from app_settings. */
export async function deactivateDictionary(id: string): Promise<void> {
  const active = await getActiveDictionaryIds();
  if (!active.includes(id)) return;
  await setActiveDictionaryIds(active.filter((x) => x !== id));
}

/**
 * Expand the entries of every activated dictionary. The ASR pipeline unions
 * these with manual vocabulary at load time. A dictionary ID that no longer
 * resolves to a file (e.g. removed from the bundle in a later build) is
 * skipped rather than throwing, so a stale persisted ID can't break dictation.
 */
export async function getActiveDictionaryEntries(): Promise<DictionaryEntry[]> {
  const active = await getActiveDictionaryIds();
  const out: DictionaryEntry[] = [];
  for (const id of active) {
    try {
      const { file } = await readBundledDictionaryFile(id);
      out.push(...file.entries);
    } catch {
      // stale / unreadable dictionary id — skip silently
    }
  }
  return out;
}
