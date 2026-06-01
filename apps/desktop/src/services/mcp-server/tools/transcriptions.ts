import { z } from "zod";
import { and, desc, gt } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "../../../db";
import { transcriptions, type Transcription } from "../../../db/schema";
import { searchTranscriptions } from "../../../db/transcriptions";
import { jsonResult, textError } from "./shared";

function toRow(t: Transcription) {
  return {
    id: t.id,
    text: t.text,
    timestamp: t.timestamp.toISOString(),
    language: t.language ?? null,
    detectedLanguage: t.detectedLanguage ?? null,
    confidence: t.confidence ?? null,
    duration: t.duration ?? null,
    speechModel: t.speechModel ?? null,
    formattingModel: t.formattingModel ?? null,
  };
}

export function registerTranscriptionsTools(mcp: McpServer): void {
  mcp.registerTool(
    "transcriptions_recent",
    {
      description:
        "Return the most recent transcription rows, optionally since a timestamp.",
      inputSchema: {
        limit: z.number().int().positive().max(200).optional(),
        since: z.string().optional(),
      },
    },
    async (input) => {
      const limit = Math.min(input.limit ?? 20, 200);
      let sinceDate: Date | undefined;
      if (input.since !== undefined) {
        const parsed = new Date(input.since);
        if (Number.isNaN(parsed.getTime())) {
          return textError(`since must be a parseable ISO timestamp: ${input.since}`);
        }
        sinceDate = parsed;
      }
      // We bypass getTranscriptions() here because that helper has no
      // "since" filter and uses 50 as its default limit. Going straight to
      // drizzle keeps the SQL one round-trip and respects the SPEC defaults.
      const rows = sinceDate
        ? await db
            .select()
            .from(transcriptions)
            .where(and(gt(transcriptions.timestamp, sinceDate)))
            .orderBy(desc(transcriptions.timestamp))
            .limit(limit)
        : await db
            .select()
            .from(transcriptions)
            .orderBy(desc(transcriptions.timestamp))
            .limit(limit);
      return jsonResult({ rows: rows.map(toRow) });
    },
  );

  mcp.registerTool(
    "transcriptions_search",
    {
      description: "Search transcription text by substring.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async (input) => {
      const limit = Math.min(input.limit ?? 50, 500);
      const rows = await searchTranscriptions(input.query, limit);
      return jsonResult({ rows: rows.map(toRow) });
    },
  );

}
