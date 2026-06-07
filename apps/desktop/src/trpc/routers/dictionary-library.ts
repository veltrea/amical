import { app } from "electron";
import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import {
  activateDictionary,
  deactivateDictionary,
  listBundledDictionariesWithState,
  readBundledDictionaryFile,
  addDictionaryEntry,
  updateDictionaryEntry,
  removeDictionaryEntry,
  createDictionary,
  updateDictionaryMeta,
  removeDictionary,
} from "../../services/dictionary-library";

const IdSchema = z.object({ id: z.string().min(1) });

// Shape of a single dictionary entry coming from the editor UI.
const EntrySchema = z.object({
  word: z.string().min(1),
  replacementWord: z.string().nullable(),
  isReplacement: z.boolean(),
});

// Full metadata for creating a new dictionary (entryCount/file are derived).
const MetaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  name_ja: z.string().optional(),
  description: z.string(),
  description_ja: z.string().optional(),
  category: z.string().min(1),
  language: z.string().min(1),
  tags: z.array(z.string()),
});

// Editable subset of metadata (id/entryCount/file are immutable).
const MetaPatchSchema = z.object({
  name: z.string().min(1).optional(),
  name_ja: z.string().optional(),
  description: z.string().optional(),
  description_ja: z.string().optional(),
  category: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
});

export const dictionaryLibraryRouter = createRouter({
  // Every bundled dictionary plus whether it is currently activated.
  // Renders the matrix UI on `/settings/dictionary-library`.
  list: procedure.query(async () => {
    return await listBundledDictionariesWithState();
  }),

  // Activate a dictionary = add its id to app_settings.activeDictionaries.
  // The ASR pipeline unions the dictionary's JSON entries with manual
  // vocabulary at load time; nothing is written to the vocabulary table.
  // NB: must NOT be named `apply` — tRPC reserves Function.prototype names
  // (apply/call/bind/...) as procedure keys and throws at router build.
  activateDictionary: procedure
    .input(IdSchema)
    .mutation(async ({ input }) => {
      await activateDictionary(input.id);
      return { ok: true };
    }),

  // Deactivate = remove the id from app_settings.activeDictionaries.
  deactivateDictionary: procedure
    .input(IdSchema)
    .mutation(async ({ input }) => {
      await deactivateDictionary(input.id);
      return { ok: true };
    }),

  // ---- Viewer + dev-only authoring (services/dictionary-library/authoring.ts) ----

  // Read one dictionary's metadata + entries. Read-only, works in every build;
  // powers the detail/editor page.
  getEntries: procedure.input(IdSchema).query(async ({ input }) => {
    const { meta, file } = await readBundledDictionaryFile(input.id);
    return { meta, entries: file.entries };
  }),

  // Whether the bundled assets can be written. Only dev builds read assets from
  // the source tree; packaged builds ship them read-only. The UI hides every
  // editing affordance when this is false.
  editable: procedure.query(() => !app.isPackaged),

  // Append one entry. assertEditable() in the service throws in packaged builds.
  addEntry: procedure
    .input(z.object({ id: z.string().min(1), entry: EntrySchema }))
    .mutation(async ({ input }) => {
      await addDictionaryEntry(input.id, input.entry);
      return { ok: true };
    }),

  // Edit the entry whose word === originalWord (word may be renamed).
  updateEntry: procedure
    .input(
      z.object({
        id: z.string().min(1),
        originalWord: z.string().min(1),
        entry: EntrySchema,
      }),
    )
    .mutation(async ({ input }) => {
      await updateDictionaryEntry(input.id, input.originalWord, input.entry);
      return { ok: true };
    }),

  // Delete the entry whose word matches.
  deleteEntry: procedure
    .input(z.object({ id: z.string().min(1), word: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await removeDictionaryEntry(input.id, input.word);
      return { ok: true };
    }),

  // Edit a dictionary's metadata (name/description/tags/category/language).
  updateMeta: procedure
    .input(z.object({ id: z.string().min(1), patch: MetaPatchSchema }))
    .mutation(async ({ input }) => {
      return await updateDictionaryMeta(input.id, input.patch);
    }),

  // Create a new dictionary (file + index entry).
  createDictionary: procedure.input(MetaSchema).mutation(async ({ input }) => {
    return await createDictionary(input);
  }),

  // Delete a dictionary (file + index entry + remove from active set).
  removeDictionary: procedure.input(IdSchema).mutation(async ({ input }) => {
    await removeDictionary(input.id);
    return { ok: true };
  }),
});
