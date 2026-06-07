/**
 * アイデア③ PoC: 時間窓(セッション)局所性で同読みグループの誤認識候補を絞る。
 *
 * 仮説: 同じ読みの綴りはグローバルでは混在しても、時間的に近い発話(セッション)
 * 内では一方に偏る。セッション内少数派は誤認識の確率が高い。逆にセッション "間"
 * できれいに分離する読みグループは「使い分け(文脈依存の正常変換)」であって誤認識
 * ではない。
 *
 * co-occurrence.ts (グローバル文脈) では潰れていた時間局所性を取り出せるかを検証する。
 *
 * 実行:
 *   cd apps/desktop
 *   GAP_SEC=120 POS=content pnpm tsx scripts/misrec-poc/temporal-context.ts
 *   GAP_SEC=600 POS=noun    pnpm tsx scripts/misrec-poc/temporal-context.ts
 */

import { createClient } from "@libsql/client";
import * as kuromoji from "kuromoji";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requireFromHere = createRequire(import.meta.url);

const DB_PATH = path.join(__dirname, "tmp", "snapshot.db");
const OUT_PATH = path.join(__dirname, "tmp", "temporal-context-result.json");

const GAP_SEC = Number(process.env.GAP_SEC ?? "120");
const POS_FILTER = process.env.POS ?? "content"; // "content" | "noun" | "all"
const STRICT = process.env.STRICT === "1"; // 表記揺れ正規化 + 1文字語除外

interface Row {
  id: number;
  text: string;
  ts: number;
}
interface Tok {
  surface: string;
  reading: string;
  pos: string;
}

function resolveDictPath(): string {
  const candidates: string[] = [];
  try {
    const entry = requireFromHere.resolve("kuromoji");
    candidates.push(path.resolve(path.dirname(entry), "..", "dict"));
    candidates.push(path.resolve(path.dirname(entry), "dict"));
  } catch {
    // ignore
  }
  candidates.push(
    path.resolve(__dirname, "..", "..", "node_modules", "kuromoji", "dict"),
  );
  candidates.push(
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "node_modules",
      "kuromoji",
      "dict",
    ),
  );
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "base.dat.gz"))) return c;
  }
  throw new Error("kuromoji dict not found. tried:\n" + candidates.join("\n"));
}

function loadTokenizer(
  dicPath: string,
): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)));
  });
}

function keepPos(pos: string): boolean {
  if (POS_FILTER === "all") return true;
  if (POS_FILTER === "noun") return pos.startsWith("名詞");
  return /^(名詞|動詞|形容詞|副詞)/.test(pos); // content
}

function isPunct(s: string): boolean {
  return /^[\s、。.,!?！？「」『』（）()【】[\]\-—…・"'`:;：]+$/.test(s);
}

// 漢字シーケンス(送り仮名・かなを除いた部分)を取り出す。
function kanjiOnly(s: string): string {
  return s.replace(/[^一-龯々]/g, "");
}

// 漢字部分が一致 = 送り仮名/かな表記の揺れ(ウナギ/うなぎ, 振込/振り込み, 卸し/卸)。
// 漢字部分が違えば同音異義語(同盟/同名, 良心/両親, 口座/講座)。
function orthVariant(a: string, b: string): boolean {
  return kanjiOnly(a) === kanjiOnly(b);
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`snapshot not found: ${DB_PATH}`);
    console.error(
      `run: mkdir -p ${path.dirname(DB_PATH)} && cp apps/desktop/amical.db ${DB_PATH}`,
    );
    process.exit(1);
  }
  const dicPath = resolveDictPath();
  process.stdout.write(`kuromoji dict: ${dicPath}\nloading tokenizer…`);
  const t0 = Date.now();
  const tokenizer = await loadTokenizer(dicPath);
  process.stdout.write(` ${Date.now() - t0}ms\n`);

  const db = createClient({ url: `file:${DB_PATH}` });
  const res = await db.execute(
    "SELECT id, text, timestamp AS ts FROM transcriptions WHERE text IS NOT NULL AND timestamp IS NOT NULL ORDER BY timestamp",
  );
  const rows: Row[] = res.rows.map((r) => ({
    id: Number(r.id),
    text: String(r.text),
    ts: Number(r.ts),
  }));
  console.log(`rows: ${rows.length} | gap=${GAP_SEC}s | pos=${POS_FILTER}`);

  // --- セッション分割 ---
  const sessions: Row[][] = [];
  let cur: Row[] = [];
  let prevTs = -1;
  for (const r of rows) {
    if (prevTs >= 0 && r.ts - prevTs > GAP_SEC) {
      if (cur.length) sessions.push(cur);
      cur = [];
    }
    cur.push(r);
    prevTs = r.ts;
  }
  if (cur.length) sessions.push(cur);
  console.log(
    `sessions: ${sessions.length} (avg ${(rows.length / sessions.length).toFixed(1)} utt/session)`,
  );

  // --- トークン化(キャッシュ) ---
  const tokCache = new Map<number, Tok[]>();
  const tokenizeRow = (r: Row): Tok[] => {
    const hit = tokCache.get(r.id);
    if (hit) return hit;
    const out: Tok[] = [];
    for (const k of tokenizer.tokenize(r.text)) {
      const surface = k.surface_form;
      if (!surface || isPunct(surface)) continue;
      const reading = k.reading && k.reading !== "*" ? k.reading : "";
      if (!reading) continue; // 読み無し(未知語など)は同音判定の対象外
      if (!keepPos(k.pos)) continue;
      out.push({ surface, reading, pos: k.pos });
    }
    tokCache.set(r.id, out);
    return out;
  };

  // --- グローバル集計: reading -> surface -> count ---
  const globalReading = new Map<string, Map<string, number>>();
  for (const r of rows) {
    for (const tk of tokenizeRow(r)) {
      let m = globalReading.get(tk.reading);
      if (!m) {
        m = new Map();
        globalReading.set(tk.reading, m);
      }
      m.set(tk.surface, (m.get(tk.surface) ?? 0) + 1);
    }
  }
  // 同じ読みで2綴り以上(総出現>=5)の読みグループ = 同音異義/表記揺れ候補
  const multiReadings = new Set<string>();
  for (const [reading, m] of globalReading) {
    if (m.size < 2) continue;
    let tot = 0;
    for (const c of m.values()) tot += c;
    if (tot >= 5) multiReadings.add(reading);
  }
  console.log(
    `multi-surface reading groups (global, total>=5): ${multiReadings.size}`,
  );

  // --- セッション局所集計 ---
  interface Cand {
    reading: string;
    minoritySurface: string;
    dominantSurface: string;
    sessionMinorityCount: number;
    sessionDominantCount: number;
    sessionIdx: number;
    globalMinorityCount: number;
    globalDominantCount: number;
    minorityPos: string;
    contextText: string;
  }
  const cands: Cand[] = [];
  const grpMixed = new Map<string, number>(); // 同一セッションに2綴り以上同居したセッション数
  const grpSplit = new Map<string, number>(); // 1綴りだけのセッション数

  sessions.forEach((sess, sIdx) => {
    const local = new Map<string, Map<string, number>>();
    const posOf = new Map<string, string>();
    for (const r of sess) {
      for (const tk of tokenizeRow(r)) {
        if (!multiReadings.has(tk.reading)) continue;
        let m = local.get(tk.reading);
        if (!m) {
          m = new Map();
          local.set(tk.reading, m);
        }
        m.set(tk.surface, (m.get(tk.surface) ?? 0) + 1);
        posOf.set(tk.surface, tk.pos);
      }
    }
    for (const [reading, m] of local) {
      if (m.size >= 2) grpMixed.set(reading, (grpMixed.get(reading) ?? 0) + 1);
      else grpSplit.set(reading, (grpSplit.get(reading) ?? 0) + 1);

      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
      const [domSurface, domCount] = sorted[0];
      if (domCount < 2) continue;
      for (let i = 1; i < sorted.length; i++) {
        const [minSurface, minCount] = sorted[i];
        if (STRICT) {
          if (minSurface.length < 2) continue; // 1文字語(キ=気/記/器/期/機…)を除外
          if (orthVariant(minSurface, domSurface)) continue; // 送り仮名の揺れを除外
          // 片方がカナのみ(漢字ゼロ)は表記揺れ/固有名詞のカナ化(コケ/苔, よう/用, トミノ/富野)。
          // 両方が漢字を含む異綴だけが「真の同音異義語の取り違え」候補。
          if (kanjiOnly(minSurface) === "" || kanjiOnly(domSurface) === "") continue;
        }
        const gMin = globalReading.get(reading)?.get(minSurface) ?? 0;
        const gDom = globalReading.get(reading)?.get(domSurface) ?? 0;
        const text = sess
          .map((r) => r.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .slice(0, 220);
        cands.push({
          reading,
          minoritySurface: minSurface,
          dominantSurface: domSurface,
          sessionMinorityCount: minCount,
          sessionDominantCount: domCount,
          sessionIdx: sIdx,
          globalMinorityCount: gMin,
          globalDominantCount: gDom,
          minorityPos: posOf.get(minSurface) ?? "",
          contextText: text,
        });
      }
    }
  });

  // --- スコアリング: 分離度(低い=セッション内混在=誤認識疑い) ---
  const scored = cands.map((c) => {
    const mixed = grpMixed.get(c.reading) ?? 0;
    const split = grpSplit.get(c.reading) ?? 0;
    const separationRatio = split / Math.max(1, split + mixed);
    return { ...c, mixed, split, separationRatio };
  });
  scored.sort((a, b) =>
    a.separationRatio !== b.separationRatio
      ? a.separationRatio - b.separationRatio
      : a.globalMinorityCount - b.globalMinorityCount,
  );

  console.log(`\n=== セッション内少数派 候補総数: ${scored.length} ===`);
  const byPos = new Map<string, number>();
  for (const c of scored) {
    const head = c.minorityPos.split(",")[0];
    byPos.set(head, (byPos.get(head) ?? 0) + 1);
  }
  console.log("少数派側の品詞内訳:");
  for (const [p, n] of [...byPos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p}: ${n}`);
  }

  console.log("\n=== 誤認識疑い 上位35件 (分離度低い順 = セッション内混在) ===");
  for (const c of scored.slice(0, 35)) {
    console.log(
      `[${c.reading}] 少"${c.minoritySurface}"(${c.sessionMinorityCount}) ↔ 多"${c.dominantSurface}"(${c.sessionDominantCount}) ` +
        `sep=${c.separationRatio.toFixed(2)} g(${c.globalMinorityCount}/${c.globalDominantCount}) ${c.minorityPos.split(",")[0]}`,
    );
    console.log(`    ctx: ${c.contextText.slice(0, 130)}`);
  }

  // --- 参考: 使い分けと推定される(セッション間分離)読みグループ ---
  const groupSep = [...multiReadings]
    .map((reading) => {
      const mixed = grpMixed.get(reading) ?? 0;
      const split = grpSplit.get(reading) ?? 0;
      const m = globalReading.get(reading)!;
      const surfaces = [...m.entries()].sort((a, b) => b[1] - a[1]);
      return { reading, mixed, split, sep: split / Math.max(1, split + mixed), surfaces };
    })
    .filter((g) => g.split + g.mixed >= 3);
  groupSep.sort((a, b) => b.sep - a.sep);
  console.log(
    "\n=== セッション間で分離(=使い分けと推定) 読みグループ top15 ===",
  );
  for (const g of groupSep.slice(0, 15)) {
    console.log(
      `[${g.reading}] sep=${g.sep.toFixed(2)} (split${g.split}/mixed${g.mixed}) :: ${g.surfaces
        .slice(0, 4)
        .map(([s, c]) => `${s}(${c})`)
        .join(", ")}`,
    );
  }

  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { gap: GAP_SEC, pos: POS_FILTER, sessions: sessions.length, candidates: scored },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${OUT_PATH} (${scored.length} candidates)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
