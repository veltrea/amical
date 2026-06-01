import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  deleteCandidates,
  dismissCandidates,
  getCandidatesByIds,
  listCandidates,
} from "../../../db/misrecognition";
import {
  createVocabularyWord,
  getVocabularyByWord,
} from "../../../db/vocabulary";
import { jsonResult, textError } from "./shared";

const SortBy = z.enum(["occurrenceCount", "lastSeenAt", "word"]);

export function registerMisrecCandidateTools(mcp: McpServer): void {
  mcp.registerTool(
    "misrec_candidates_list",
    {
      description: "List active misrecognition candidates from the pool.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
        sortBy: SortBy.optional(),
      },
    },
    async (input) => {
      const rows = await listCandidates({
        limit: input.limit ?? 100,
        offset: input.offset ?? 0,
        sortBy: input.sortBy,
      });
      return jsonResult({
        candidates: rows.map((c) => ({
          id: c.id,
          word: c.word,
          normalizedKey: c.normalizedKey,
          occurrenceCount: c.occurrenceCount,
          lastSeenAt: c.lastSeenAt.toISOString(),
        })),
      });
    },
  );

  mcp.registerTool(
    "misrec_candidates_register",
    {
      description:
        "Register a misrecognition candidate as a vocabulary replacement and remove the candidate row.",
      inputSchema: {
        id: z.number().int().positive(),
        replacementWord: z.string().min(1),
      },
    },
    async (input) => {
      const replacement = input.replacementWord.trim();
      if (!replacement) return textError("replacementWord must not be empty");
      const [candidate] = await getCandidatesByIds([input.id]);
      if (!candidate) return textError(`candidate ${input.id} not found`);
      if (candidate.word === replacement) {
        return textError("replacementWord must differ from the candidate word");
      }
      const existing = await getVocabularyByWord(candidate.word);
      if (existing) {
        // Already in vocabulary — clean up the candidate row only. Matches
        // the tRPC registerCandidate behavior so both paths report the same
        // shape to the caller.
        await deleteCandidates([candidate.id]);
        return jsonResult({ registered: 0 });
      }
      await createVocabularyWord({
        word: candidate.word,
        isReplacement: true,
        replacementWord: replacement,
      });
      await deleteCandidates([candidate.id]);
      return jsonResult({ registered: 1 });
    },
  );

  mcp.registerTool(
    "misrec_candidates_dismiss",
    {
      description: "Dismiss candidates so they don't resurface.",
      inputSchema: {
        ids: z.array(z.number().int().positive()).min(1),
      },
    },
    async (input) => {
      await dismissCandidates(input.ids);
      return jsonResult({ dismissed: input.ids.length });
    },
  );
}
