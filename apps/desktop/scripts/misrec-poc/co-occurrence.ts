/**
 * Phase 1 PoC: Co-occurrence baseline for misrecognition detection.
 *
 * Reads a read-only snapshot of the prod DB, morphologically analyzes all
 * transcriptions via kuromoji, groups surfaces by reading, and compares the
 * bi-gram context distribution of each minority surface against the dominant
 * surface in its reading group via Jensen-Shannon divergence.
 *
 * Verdict per group:
 *   - misrecognition-suspect: minority's context distribution is close to dominant
 *   - distinct-uses:          minority's context distribution is far from dominant
 *   - uncertain:              in between (or sample too small)
 *
 * See SPEC-misrecognition-v2.md §2.1, Phase 1.
 */

import { createClient } from "@libsql/client";
import * as kuromoji from "kuromoji";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DICT_PATH = path.join(REPO_ROOT, "node_modules", "kuromoji", "dict");
const DB_PATH = path.join(__dirname, "tmp", "snapshot.db");
const OUT_PATH = path.join(__dirname, "tmp", "co-occurrence-result.json");

const MIN_DOMINANT_COUNT = 3;
const MIN_MINORITY_COUNT = 2;
const MISREC_THRESHOLD = 0.35;
const DISTINCT_THRESHOLD = 0.65;

interface ContextBag {
  left: Map<string, number>;
  right: Map<string, number>;
}

interface SurfaceEntry {
  surface: string;
  count: number;
  contextDivergence: number;
  sampleLeft: Array<[string, number]>;
  sampleRight: Array<[string, number]>;
}

interface GroupResult {
  reading: string;
  members: SurfaceEntry[];
  verdict: "misrecognition-suspect" | "distinct-uses" | "uncertain";
  minDivergence: number;
}

async function loadTokenizer(): Promise<
  kuromoji.Tokenizer<kuromoji.IpadicFeatures>
> {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: DICT_PATH }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

function sum(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

function jsDivergence(p: Map<string, number>, q: Map<string, number>): number {
  const sp = sum(p);
  const sq = sum(q);
  if (sp === 0 || sq === 0) return Math.log(2);
  const keys = new Set([...p.keys(), ...q.keys()]);
  let div = 0;
  for (const k of keys) {
    const pv = (p.get(k) ?? 0) / sp;
    const qv = (q.get(k) ?? 0) / sq;
    const m = 0.5 * (pv + qv);
    if (pv > 0) div += 0.5 * pv * Math.log(pv / m);
    if (qv > 0) div += 0.5 * qv * Math.log(qv / m);
  }
  return div;
}

function combinedDivergence(a: ContextBag, b: ContextBag): number {
  return 0.5 * jsDivergence(a.left, b.left) + 0.5 * jsDivergence(a.right, b.right);
}

function topN(m: Map<string, number>, n: number): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function main() {
  process.stdout.write("Loading kuromoji dictionary…");
  const t0 = Date.now();
  const tokenizer = await loadTokenizer();
  process.stdout.write(` ${Date.now() - t0}ms\n`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`DB snapshot not found at ${DB_PATH}`);
    console.error(`Run: cp ~/Library/Application\\ Support/Amical/amical.db ${DB_PATH}`);
    process.exit(1);
  }

  const db = createClient({ url: `file:${DB_PATH}` });
  const res = await db.execute("SELECT id, text FROM transcriptions ORDER BY id");
  console.log(`Loaded ${res.rows.length} transcriptions`);

  const surfaceCount = new Map<string, number>();
  const surfaceReadings = new Map<string, Map<string, number>>();
  const surfaceContexts = new Map<string, ContextBag>();

  const t1 = Date.now();
  let processed = 0;
  for (const row of res.rows) {
    const text = row.text as string | null;
    if (!text) continue;
    const tokens = tokenizer.tokenize(text);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const surface = tok.surface_form;
      const reading = tok.reading;

      if (!surface || surface.length === 0) continue;
      if (/^[\s、。.,!?！？「」（）()【】\-—…]+$/.test(surface)) continue;

      surfaceCount.set(surface, (surfaceCount.get(surface) ?? 0) + 1);

      if (reading && reading !== "*") {
        let rmap = surfaceReadings.get(surface);
        if (!rmap) {
          rmap = new Map();
          surfaceReadings.set(surface, rmap);
        }
        rmap.set(reading, (rmap.get(reading) ?? 0) + 1);
      }

      const leftSurface = i > 0 ? tokens[i - 1].surface_form : "<BOS>";
      const rightSurface =
        i < tokens.length - 1 ? tokens[i + 1].surface_form : "<EOS>";
      let ctx = surfaceContexts.get(surface);
      if (!ctx) {
        ctx = { left: new Map(), right: new Map() };
        surfaceContexts.set(surface, ctx);
      }
      ctx.left.set(leftSurface, (ctx.left.get(leftSurface) ?? 0) + 1);
      ctx.right.set(rightSurface, (ctx.right.get(rightSurface) ?? 0) + 1);
    }
    processed++;
    if (processed % 5000 === 0) {
      console.log(`  ${processed} / ${res.rows.length} transcriptions tokenized`);
    }
  }
  console.log(
    `Tokenized ${processed} transcriptions in ${Date.now() - t1}ms. ` +
      `Unique surfaces: ${surfaceCount.size}`,
  );

  // Pick each surface's most-frequent reading.
  const surfaceMainReading = new Map<string, string>();
  for (const [surface, rmap] of surfaceReadings) {
    let best = "";
    let bestCount = 0;
    for (const [r, c] of rmap) {
      if (c > bestCount) {
        best = r;
        bestCount = c;
      }
    }
    if (best) surfaceMainReading.set(surface, best);
  }

  // Group surfaces by their main reading.
  const readingGroups = new Map<string, string[]>();
  for (const [surface, reading] of surfaceMainReading) {
    const arr = readingGroups.get(reading) ?? [];
    arr.push(surface);
    readingGroups.set(reading, arr);
  }

  // Score each multi-member group.
  const groupResults: GroupResult[] = [];
  for (const [reading, surfaces] of readingGroups) {
    if (surfaces.length < 2) continue;

    const withCount = surfaces
      .map((s) => ({ surface: s, count: surfaceCount.get(s) ?? 0 }))
      .sort((a, b) => b.count - a.count);
    const dominant = withCount[0];
    if (dominant.count < MIN_DOMINANT_COUNT) continue;

    const dCtx = surfaceContexts.get(dominant.surface);
    if (!dCtx) continue;

    const members: SurfaceEntry[] = withCount.map(({ surface, count }) => {
      const ctx = surfaceContexts.get(surface);
      const div = ctx ? combinedDivergence(ctx, dCtx) : Math.log(2);
      return {
        surface,
        count,
        contextDivergence: div,
        sampleLeft: ctx ? topN(ctx.left, 5) : [],
        sampleRight: ctx ? topN(ctx.right, 5) : [],
      };
    });

    const minorities = members.filter(
      (m) => m.surface !== dominant.surface && m.count >= MIN_MINORITY_COUNT,
    );
    if (minorities.length === 0) continue;

    const minDiv = Math.min(...minorities.map((m) => m.contextDivergence));
    let verdict: GroupResult["verdict"];
    if (minDiv < MISREC_THRESHOLD) verdict = "misrecognition-suspect";
    else if (minDiv > DISTINCT_THRESHOLD) verdict = "distinct-uses";
    else verdict = "uncertain";

    groupResults.push({ reading, members, verdict, minDivergence: minDiv });
  }

  groupResults.sort((a, b) => {
    const order = {
      "misrecognition-suspect": 0,
      uncertain: 1,
      "distinct-uses": 2,
    } as const;
    if (order[a.verdict] !== order[b.verdict])
      return order[a.verdict] - order[b.verdict];
    const totalA = a.members.reduce((s, m) => s + m.count, 0);
    const totalB = b.members.reduce((s, m) => s + m.count, 0);
    return totalB - totalA;
  });

  const counts = {
    "misrecognition-suspect": 0,
    uncertain: 0,
    "distinct-uses": 0,
  };
  for (const r of groupResults) counts[r.verdict]++;

  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        meta: {
          totalTranscriptions: res.rows.length,
          uniqueSurfaces: surfaceCount.size,
          totalGroupsWithMultiSurfaces: groupResults.length,
          verdictCounts: counts,
          thresholds: {
            MIN_DOMINANT_COUNT,
            MIN_MINORITY_COUNT,
            MISREC_THRESHOLD,
            DISTINCT_THRESHOLD,
          },
        },
        groups: groupResults,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${OUT_PATH}: ${groupResults.length} groups`);
  console.log("Verdict counts:", counts);

  // Target verification — surface look-ups.
  console.log("\n=== Target verification ===");
  const targets = [
    "ノード",
    "ノート",
    "システムプロンプト",
    "システムプロンプ",
    "誤変換",
    "ご返還",
  ];
  for (const t of targets) {
    const count = surfaceCount.get(t) ?? 0;
    const reading = surfaceMainReading.get(t);
    const group = reading ? readingGroups.get(reading) : undefined;
    const grpResult = groupResults.find(
      (g) => g.reading === reading && g.members.some((m) => m.surface === t),
    );
    console.log(
      `[${t}] count=${count} reading=${reading ?? "(none)"} groupSize=${group?.length ?? 0} ` +
        `members=${group?.join(",") ?? "(none)"} verdict=${grpResult?.verdict ?? "(not-grouped)"} ` +
        `minDiv=${grpResult ? grpResult.minDivergence.toFixed(3) : "—"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
