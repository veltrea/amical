import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createVocabularyWord,
  deleteVocabulary,
  getVocabulary,
  getVocabularyById,
  getVocabularyByWord,
  getVocabularyCount,
  importVocabularyEntries,
  searchVocabulary,
  updateVocabulary,
  type VocabularyImportEntry,
} from "../../../db/vocabulary";
import type { Vocabulary } from "../../../db/schema";
import { jsonResult, textError } from "./shared";

// Note on missing schema columns:
// SPEC §6.1 references `source` and `isActive` columns on the vocabulary
// row. The live drizzle schema doesn't have them today, so we surface
// `isActive: true` as a stable default and accept (but ignore) the
// corresponding input filters. Once the dictionary-library SPEC lands those
// columns this file can read them through directly.
function toRow(v: Vocabulary) {
  return {
    id: v.id,
    word: v.word,
    replacementWord: v.replacementWord ?? null,
    isReplacement: Boolean(v.isReplacement),
    source: null as string | null,
    isActive: true,
    dateAdded: v.dateAdded.toISOString(),
    usageCount: v.usageCount ?? 0,
  };
}

export function registerVocabularyTools(mcp: McpServer): void {
  mcp.registerTool(
    "vocabulary_list",
    {
      description:
        "List vocabulary entries with optional search/filter. Returns full vocabulary rows.",
      inputSchema: {
        search: z.string().optional(),
        source: z.string().optional(),
        isActive: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    async (input) => {
      const limit = Math.min(input.limit ?? 100, 500);
      const offset = input.offset ?? 0;
      const rows = await getVocabulary({
        limit,
        offset,
        search: input.search,
      });
      const total = await getVocabularyCount(input.search);
      return jsonResult({ entries: rows.map(toRow), total });
    },
  );

  mcp.registerTool(
    "vocabulary_add",
    {
      description:
        "Add a single vocabulary entry. Returns the inserted row. Fails on duplicate `word`.",
      inputSchema: {
        word: z.string().min(1),
        replacementWord: z.string().nullable().optional(),
        isReplacement: z.boolean().optional(),
      },
    },
    async (input) => {
      const word = input.word.toLowerCase().trim();
      if (!word) return textError("word must not be empty");
      const existing = await getVocabularyByWord(word);
      if (existing) return textError(`duplicate word: ${word}`);
      const inserted = await createVocabularyWord({
        word,
        replacementWord: input.replacementWord ?? null,
        isReplacement: input.isReplacement ?? false,
      });
      if (!inserted) return textError("insert failed");
      return jsonResult({ entry: toRow(inserted) });
    },
  );

  mcp.registerTool(
    "vocabulary_update",
    {
      description: "Update an existing vocabulary entry by id.",
      inputSchema: {
        id: z.number().int().positive(),
        word: z.string().optional(),
        replacementWord: z.string().nullable().optional(),
        isReplacement: z.boolean().optional(),
        isActive: z.boolean().optional(), // accepted but not persisted; see note above
      },
    },
    async (input) => {
      const current = await getVocabularyById(input.id);
      if (!current) return textError(`vocabulary id ${input.id} not found`);
      const patch: Partial<Vocabulary> = {};
      if (input.word !== undefined) {
        const nextWord = input.word.toLowerCase().trim();
        if (!nextWord) return textError("word must not be empty");
        patch.word = nextWord;
      }
      if (input.replacementWord !== undefined) {
        patch.replacementWord = input.replacementWord;
      }
      if (input.isReplacement !== undefined) {
        patch.isReplacement = input.isReplacement;
      }
      const updated = await updateVocabulary(input.id, patch);
      if (!updated) return textError("update failed");
      return jsonResult({ entry: toRow(updated) });
    },
  );

  mcp.registerTool(
    "vocabulary_delete",
    {
      description: "Delete a single vocabulary entry by id.",
      inputSchema: {
        id: z.number().int().positive(),
      },
    },
    async (input) => {
      const deleted = await deleteVocabulary(input.id);
      return jsonResult({ deleted: deleted ? 1 : 0 });
    },
  );

  mcp.registerTool(
    "vocabulary_bulk_add",
    {
      description:
        "Add many vocabulary entries at once with skip/overwrite duplicate handling. Reuses the existing importVocabularyEntries DB layer.",
      inputSchema: {
        entries: z
          .array(
            z.object({
              word: z.string().min(1),
              replacementWord: z.string().nullable().optional(),
              isReplacement: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(5000),
        mode: z.enum(["skip", "overwrite"]),
        // `source` is accepted (per SPEC §6.1) but not yet persisted —
        // schema doesn't carry a `source` column. Kept here so callers can
        // start tagging imports; will be wired through once the dictionary
        // library SPEC lands its schema change.
        source: z.string().optional(),
      },
    },
    async (input) => {
      const entries: VocabularyImportEntry[] = input.entries.map((e) => ({
        word: e.word,
        replacementWord: e.replacementWord ?? null,
        isReplacement: e.isReplacement ?? false,
      }));
      const result = await importVocabularyEntries(entries, input.mode);
      return jsonResult({
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
      });
    },
  );

  mcp.registerTool(
    "vocabulary_search",
    {
      description:
        "Find vocabulary entries matching a word (lowercase exact or prefix).",
      inputSchema: {
        word: z.string().min(1),
        prefix: z.boolean().optional(),
      },
    },
    async (input) => {
      const needle = input.word.toLowerCase().trim();
      if (!needle) return jsonResult({ entries: [] });
      if (input.prefix) {
        const rows = await searchVocabulary(needle, 100);
        // searchVocabulary uses %term% — narrow to true prefix client-side.
        const prefixed = rows.filter((r) => r.word.startsWith(needle));
        return jsonResult({ entries: prefixed.map(toRow) });
      }
      const row = await getVocabularyByWord(needle);
      return jsonResult({ entries: row ? [toRow(row)] : [] });
    },
  );
}
