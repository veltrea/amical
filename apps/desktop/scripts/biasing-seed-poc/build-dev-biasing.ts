// 開発（IT）分野バイアシング辞書の叩き台（300語）を組む。
//
// 候補 = キュレーション(CURATED_DEV_TERMS) ∪ Wikipedia候補(/tmp/it-term-candidates.json)。
// これを文字起こし履歴で頻度づけし、
//   1) 履歴に出た語（＝本人が実際に使う、実証済み）を頻度順に並べ、
//   2) 足りない分をキュレーション語で履歴に出なかったもの（＝汎用の開発語）で補充
// して 300 語にする。
//
// あわせて、辞書全体の推定トークン数と、1回の録音で渡せる上限
// (MAX_QWEN3_CONTEXT_TOKENS) に収まる語数を表示する。辞書サイズと「1回に渡す量」は
// 別物で、後者は Phase 1/2 が予算内で選抜する。
//
// 使い方: npx tsx apps/desktop/scripts/biasing-seed-poc/build-dev-biasing.ts

import { readFileSync, writeFileSync } from "node:fs";
import { CURATED_DEV_TERMS } from "./curated-dev-terms";
import {
  estimateQwen3Tokens,
  MAX_QWEN3_CONTEXT_TOKENS,
} from "../../src/pipeline/providers/transcription/qwen3-context";

const WIKI = "/tmp/it-term-candidates.json";
const HISTORY = "/tmp/amical_transcripts.json";
const TARGET = 300;

const isAsciiOnly = (s: string) => /^[\x20-\x7e]+$/.test(s);
function isUsableWord(s: string): boolean {
  if (!s) return false;
  if (/^[^\p{L}\p{N}]+$/u.test(s)) return false;
  const min = isAsciiOnly(s) ? 3 : 2;
  return s.length >= min;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function main() {
  const wiki = JSON.parse(readFileSync(WIKI, "utf8")) as string[];
  const curatedSet = new Set(CURATED_DEV_TERMS.filter(isUsableWord));
  const wikiSet = new Set(wiki.filter(isUsableWord));
  const candidates = [...new Set([...curatedSet, ...wikiSet])];

  const history = JSON.parse(readFileSync(HISTORY, "utf8")) as { text: string }[];
  const matcher = new RegExp(
    [...candidates].sort((a, b) => b.length - a.length).map(esc).join("|"),
    "g",
  );
  const docCount = new Map<string, number>();
  const hitCount = new Map<string, number>();
  for (const h of history) {
    if (!h.text) continue;
    const seen = new Set<string>();
    matcher.lastIndex = 0;
    for (const m of h.text.matchAll(matcher)) {
      const w = m[0];
      hitCount.set(w, (hitCount.get(w) || 0) + 1);
      seen.add(w);
    }
    for (const w of seen) docCount.set(w, (docCount.get(w) || 0) + 1);
  }

  const src = (w: string) =>
    curatedSet.has(w) && wikiSet.has(w)
      ? "both"
      : curatedSet.has(w)
        ? "curated"
        : "wiki";

  // 1) 履歴に出た語、頻度（出現文書数）順
  const seenRanked = candidates
    .filter((w) => (docCount.get(w) || 0) > 0)
    .sort((a, b) => {
      const d = (docCount.get(b) || 0) - (docCount.get(a) || 0);
      return d !== 0 ? d : (hitCount.get(b) || 0) - (hitCount.get(a) || 0);
    });

  const out: { word: string; docs: number; hits: number; source: string }[] = [];
  const used = new Set<string>();
  for (const w of seenRanked) {
    if (out.length >= TARGET) break;
    out.push({ word: w, docs: docCount.get(w) || 0, hits: hitCount.get(w) || 0, source: src(w) });
    used.add(w);
  }
  const seenCount = out.length;
  // 2) 補充：キュレーション語で履歴に出なかったもの
  for (const w of CURATED_DEV_TERMS) {
    if (out.length >= TARGET) break;
    if (used.has(w) || !isUsableWord(w)) continue;
    out.push({ word: w, docs: 0, hits: 0, source: "curated(補充)" });
    used.add(w);
  }

  // トークン予算: 辞書全体と、予算内に収まる語数
  const SEP_T = estimateQwen3Tokens(", ");
  const totalTokens = Math.round(
    out.reduce((s, o, i) => s + estimateQwen3Tokens(o.word) + (i === 0 ? 0 : SEP_T), 0),
  );
  let budgetWords = 0;
  let t = 0;
  for (const o of out) {
    const add = estimateQwen3Tokens(o.word) + (budgetWords === 0 ? 0 : SEP_T);
    if (t + add > MAX_QWEN3_CONTEXT_TOKENS) break;
    t += add;
    budgetWords++;
  }

  console.log(
    `候補: ${candidates.length}（キュレーション ${curatedSet.size} / Wikipedia ${wikiSet.size}）`,
  );
  console.log(
    `履歴に出た語: ${seenRanked.length} / 補充: ${out.length - seenCount} / 合計: ${out.length}`,
  );
  console.log(
    `辞書全体の推定トークン: 約${totalTokens} / 1回の上限 ${MAX_QWEN3_CONTEXT_TOKENS} → 予算内で先頭から約${budgetWords}語`,
  );
  console.log(`\n履歴に出た語トップ40（順位. 語 | 文書数 | 出所）:`);
  for (let i = 0; i < Math.min(seenCount, 40); i++) {
    const o = out[i];
    console.log(`${String(i + 1).padStart(3)}. ${o.word}  | ${o.docs}件 | ${o.source}`);
  }
  console.log(`\n補充（履歴に無いが汎用の開発語）サンプル30:`);
  console.log(out.filter((o) => o.docs === 0).slice(0, 30).map((o) => o.word).join("  "));

  writeFileSync("/tmp/dev-biasing-300.json", JSON.stringify(out, null, 0));
  console.log(`\n→ /tmp/dev-biasing-300.json (${out.length}語)`);
}

main();
