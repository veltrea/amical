import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import {
  applyBundledDictionary,
  listBundledDictionariesWithState,
  removeBundledDictionary,
  setBundledDictionaryActive,
} from "../../services/dictionary-library";

const IdSchema = z.object({ id: z.string().min(1) });

export const dictionaryLibraryRouter = createRouter({
  // Return every bundled dictionary with its current install state.
  // Used to render the matrix UI on `/settings/dictionary-library`.
  list: procedure.query(async () => {
    return await listBundledDictionariesWithState();
  }),

  // Insert the rows of the bundled dictionary `id` into the vocabulary
  // table, tagged as `library:<id>`. Existing words are kept (skip mode)
  // so user-authored entries are not clobbered.
  // NB: must NOT be named `apply` — tRPC reserves Function.prototype names
  // (apply/call/bind/...) as procedure keys.
  applyDictionary: procedure.input(IdSchema).mutation(async ({ input }) => {
    return await applyBundledDictionary(input.id);
  }),

  // DELETE every row with source = library:<id>. User-authored rows
  // (source = NULL) are unaffected.
  remove: procedure.input(IdSchema).mutation(async ({ input }) => {
    return await removeBundledDictionary(input.id);
  }),

  // Toggle the isActive flag for every row of a bundled dictionary so the
  // ASR pipeline starts / stops using its words without DELETing them.
  setActive: procedure
    .input(IdSchema.extend({ isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      return await setBundledDictionaryActive(input.id, input.isActive);
    }),
});
