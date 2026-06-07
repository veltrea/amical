// 候補語リスト（/tmp/it-term-candidates.json）× 自分の文字起こし履歴
// （/tmp/amical_transcripts.json）→ よく使う語トップ N。
// これが「IT分野バイアシング辞書」の叩き台になる。
//
// 順位づけは「出現した文書数（何件の文字起こしに登場したか）」を主、総回数を従にする。
// 1件で連呼された語より、多くの録音に散らばって出る語のほうが、その人の口癖として安定。
//
// 使い方: リポジトリ直下で
//   npx tsx apps/desktop/scripts/biasing-seed-poc/count-matches.ts

import { readFileSync, writeFileSync } from "node:fs";

const CANDIDATES = "/tmp/it-term-candidates.json";
const HISTORY = "/tmp/amical_transcripts.json";
const TOP_N = 300;

const isAsciiOnly = (s: string) => /^[\x20-\x7e]+$/.test(s);

/** 誤マッチ源（短すぎ・記号のみ）を落とす。 */
function isUsableWord(s: string): boolean {
  if (!s) return false;
  if (/^[^\p{L}\p{N}]+$/u.test(s)) return false; // 記号のみ
  const min = isAsciiOnly(s) ? 3 : 2; // 英字語は3文字以上、日本語は2文字以上
  return s.length >= min;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const rawCandidates = JSON.parse(readFileSync(CANDIDATES, "utf8")) as string[];
  const candidates = [...new Set(rawCandidates.filter(isUsableWord))];
  const history = JSON.parse(readFileSync(HISTORY, "utf8")) as { text: string }[];

  // 候補語を長い順に並べて1本の正規表現に（最長一致優先）。
  const matcher = new RegExp(
    [...candidates].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"),
    "g",
  );

  const docCount = new Map<string, number>(); // 何件の文字起こしに出たか
  const hitCount = new Map<string, number>(); // 総出現回数

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

  const ranked = candidates
    .filter((w) => (docCount.get(w) || 0) > 0)
    .sort((a, b) => {
      const d = (docCount.get(b) || 0) - (docCount.get(a) || 0);
      return d !== 0 ? d : (hitCount.get(b) || 0) - (hitCount.get(a) || 0);
    });

  const top = ranked.slice(0, TOP_N);

  console.log(
    `候補語(フィルタ後): ${candidates.length} / 履歴に出た候補: ${ranked.length}`,
  );
  console.log(`\nトップ60（順位. 語 | 出た文書数 | 総回数）:`);
  for (let i = 0; i < Math.min(top.length, 60); i++) {
    const w = top[i];
    console.log(
      `${String(i + 1).padStart(3)}. ${w}  |  ${docCount.get(w)}  |  ${hitCount.get(w)}`,
    );
  }

  writeFileSync(
    "/tmp/biasing-it-top.json",
    JSON.stringify(
      top.map((w) => ({ word: w, docs: docCount.get(w), hits: hitCount.get(w) })),
      null,
      0,
    ),
  );
  console.log(`\nトップ${TOP_N} → /tmp/biasing-it-top.json`);
}

main();
