import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import {
  activateDictionary,
  deactivateDictionary,
  listBundledDictionariesWithState,
} from "../../services/dictionary-library";

const IdSchema = z.object({ id: z.string().min(1) });

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
});
