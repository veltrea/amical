import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import {
  countCandidates,
  deleteCandidates,
  dismissCandidates,
  getCandidatesByIds,
  getScanState,
  listCandidates,
} from "../../db/misrecognition";
import {
  createVocabularyWord,
  getVocabularyByWord,
} from "../../db/vocabulary";
import {
  isScanRunning,
  runScan,
} from "../../services/misrecognition/scanner-service";
import {
  ensureDetectorsRegistered,
  listDetectorDescriptors,
} from "../../services/misrecognition/detectors";

const SortBy = z.enum([
  "occurrenceCount",
  "lastSeenAt",
  "word",
  "detectorCount",
]);
const SortOrder = z.enum(["asc", "desc"]);

const ReplacementWord = z
  .string()
  .min(1)
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, { message: "replacementWord must not be empty" });

const DetectorIdList = z.array(z.string().min(1)).max(50);

export const misrecognitionRouter = createRouter({
  listDetectors: procedure.query(async () => {
    ensureDetectorsRegistered();
    return listDetectorDescriptors();
  }),

  listCandidates: procedure
    .input(
      z.object({
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
        sortBy: SortBy.optional(),
        sortOrder: SortOrder.optional(),
        groupByNormalizedKey: z.boolean().optional(),
        filterDetectors: DetectorIdList.optional(),
        searchWord: z.string().optional(),
        searchReading: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const rows = await listCandidates({
        limit: input.limit,
        offset: input.offset,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        filterDetectors: input.filterDetectors,
        searchWord: input.searchWord,
        searchReading: input.searchReading,
      });
      if (!input.groupByNormalizedKey) {
        return { mode: "flat" as const, rows };
      }
      // Group on the fetched page (intentional: keeps response bounded).
      const groups = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = groups.get(r.normalizedKey) ?? [];
        list.push(r);
        groups.set(r.normalizedKey, list);
      }
      return {
        mode: "grouped" as const,
        groups: [...groups.entries()].map(([key, members]) => ({
          normalizedKey: key,
          members,
          totalOccurrences: members.reduce(
            (sum, m) => sum + m.occurrenceCount,
            0,
          ),
        })),
      };
    }),

  countCandidates: procedure
    .input(
      z
        .object({
          filterDetectors: DetectorIdList.optional(),
          searchWord: z.string().optional(),
          searchReading: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return await countCandidates({
        filterDetectors: input?.filterDetectors,
        searchWord: input?.searchWord,
        searchReading: input?.searchReading,
      });
    }),

  dismissCandidates: procedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1) }))
    .mutation(async ({ input }) => {
      await dismissCandidates(input.ids);
      return { dismissed: input.ids.length };
    }),

  registerCandidate: procedure
    .input(
      z.object({
        id: z.number().int().positive(),
        replacementWord: ReplacementWord,
      }),
    )
    .mutation(async ({ input }) => {
      const [candidate] = await getCandidatesByIds([input.id]);
      if (!candidate) throw new Error("candidate not found");
      if (candidate.word === input.replacementWord) {
        throw new Error("replacementWord must be different from candidate word");
      }
      const existing = await getVocabularyByWord(candidate.word);
      if (existing) {
        // Already registered — just clean up the candidate row.
        await deleteCandidates([candidate.id]);
        return { registered: 0, skipped: 1 };
      }
      await createVocabularyWord({
        word: candidate.word,
        isReplacement: true,
        replacementWord: input.replacementWord,
      });
      await deleteCandidates([candidate.id]);
      return { registered: 1, skipped: 0 };
    }),

  bulkRegisterCandidates: procedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1),
        replacementWord: ReplacementWord,
      }),
    )
    .mutation(async ({ input }) => {
      const candidates = await getCandidatesByIds(input.ids);
      let registered = 0;
      let skipped = 0;
      const toDelete: number[] = [];
      for (const c of candidates) {
        if (c.word === input.replacementWord) {
          skipped++;
          continue;
        }
        const existing = await getVocabularyByWord(c.word);
        if (existing) {
          skipped++;
          toDelete.push(c.id);
          continue;
        }
        await createVocabularyWord({
          word: c.word,
          isReplacement: true,
          replacementWord: input.replacementWord,
        });
        toDelete.push(c.id);
        registered++;
      }
      if (toDelete.length > 0) await deleteCandidates(toDelete);
      return { registered, skipped };
    }),

  scanNow: procedure
    .input(
      z
        .object({
          detectorIds: DetectorIdList.optional(),
          fullRescan: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      return await runScan({
        detectorIds: input?.detectorIds,
        fullRescan: input?.fullRescan,
      });
    }),

  getScanStatus: procedure.query(async () => {
    const state = await getScanState();
    return {
      lastScannedTranscriptionId: state.lastScannedTranscriptionId,
      lastScanAt: state.lastScanAt,
      isRunning: isScanRunning(),
    };
  }),
});
