// 過去の文字起こしを「分野（辞書カテゴリ）」で分類できるかを確かめる PoC。
//
// 目的:
//   保存済みの文字起こし（数万件）を、辞書の分野語で機械的に分類して、
//   「そのユーザーが一番多く話す分野（個人の記録）」を初日から作れるかを実データで見る。
//   CONTEXTUAL_BIASING_FIELD_ESTIMATION.md §3 / §6 の検証。
//
// 使い方:
//   1) 先に dev DB の本文を JSON へ書き出しておく:
//      sqlite3 -readonly apps/desktop/amical.db ".mode json" \
//        "SELECT id, text, language, detected_language AS dl, timestamp AS ts FROM transcriptions;" \
//        > /tmp/amical_transcripts.json
//   2) リポジトリ直下で: npx tsx apps/desktop/scripts/field-classify-poc/classify.ts
//
// ここでの分類ロジック（classifyText など）は、うまくいけば
// apps/desktop/src/utils/contextual-hints.ts の「いまの中身の証拠」部分へ昇格させる。

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DICT_DIR = join(ROOT, "apps/desktop/assets/dictionaries");
const TRANSCRIPTS = "/tmp/amical_transcripts.json";

interface Entry {
  word: string;
  replacementWord: string | null;
  isReplacement: boolean;
}
interface IndexMeta {
  id: string;
  category: string;
  file: string;
  name?: string;
  name_ja?: string;
}

// ===== 純粋ロジック（後で contextual-hints.ts へ移す候補）=====

const isAsciiOnly = (s: string) => /^[\x20-\x7e]+$/.test(s);
const isHiraganaOnly = (s: string) => /^[぀-ゟー々]+$/.test(s);

/** 分類に使える語かどうか。短すぎる語・誤爆しやすい語は落とす。 */
export function isUsableWord(s: string): boolean {
  if (!s) return false;
  // ひらがなだけの語（多くは「読み」エントリ）は一般語と衝突しやすいので分類に使わない。
  // 例: 「瑕疵」の読み "かし" が「お菓子」「〜かし」に誤爆する。固有名詞は漢字・カタカナ表記で拾える。
  if (isHiraganaOnly(s)) return false;
  const min = isAsciiOnly(s) ? 3 : 2; // 英字語は3文字以上、日本語は2文字以上
  return s.length >= min;
}

/** 語 → 分野 の対応表を作る。同じ語が複数分野にあれば先に出たほうを採用。 */
export function buildWordCategoryMap(
  dicts: { category: string; entries: Entry[] }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of dicts) {
    for (const e of d.entries) {
      for (const w of [e.word, e.replacementWord]) {
        if (w && isUsableWord(w) && !map.has(w)) map.set(w, d.category);
      }
    }
  }
  return map;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 全分野語を1本の正規表現にする（長い語を優先してマッチ）。 */
export function buildMatcher(words: string[]): RegExp {
  const sorted = [...words]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return new RegExp(sorted.join("|"), "g");
}

export interface ClassifyResult {
  category: string | null; // 一番ヒットの多かった分野（0件なら null＝不明）
  counts: Record<string, number>;
  hitWords: string[];
}

/** 本文1件を分野に分類する純関数。 */
export function classifyText(
  text: string,
  matcher: RegExp,
  wordCategory: Map<string, string>,
): ClassifyResult {
  const counts: Record<string, number> = {};
  const hitWords: string[] = [];
  matcher.lastIndex = 0;
  for (const m of text.matchAll(matcher)) {
    const cat = wordCategory.get(m[0]);
    if (!cat) continue;
    counts[cat] = (counts[cat] || 0) + 1;
    hitWords.push(m[0]);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return { category: best, counts, hitWords };
}

// ===== グルー（辞書と本文 JSON を読み、集計して表示）=====

function loadDicts() {
  const index = JSON.parse(
    readFileSync(join(DICT_DIR, "index.json"), "utf8"),
  ) as { dictionaries: IndexMeta[] };
  return index.dictionaries.map((m) => {
    const file = JSON.parse(
      readFileSync(join(DICT_DIR, m.file), "utf8"),
    ) as { entries: Entry[] };
    return { id: m.id, category: m.category, entries: file.entries };
  });
}

function main() {
  const dicts = loadDicts();
  const wordCat = buildWordCategoryMap(dicts);
  const words = [...wordCat.keys()];
  const matcher = buildMatcher(words);
  console.log(`辞書: ${dicts.length}個 / 分類に使う語: ${words.length}個`);

  const transcripts = JSON.parse(readFileSync(TRANSCRIPTS, "utf8")) as {
    id: number;
    text: string;
    language: string | null;
  }[];
  console.log(`本文: ${transcripts.length}件`);

  const catCount: Record<string, number> = {};
  let unknown = 0;
  const wordFreqByCat: Record<string, Map<string, number>> = {};
  const samplesByCat: Record<string, string[]> = {};

  for (const t of transcripts) {
    if (!t.text) {
      unknown++;
      continue;
    }
    const r = classifyText(t.text, matcher, wordCat);
    if (!r.category) {
      unknown++;
      continue;
    }
    catCount[r.category] = (catCount[r.category] || 0) + 1;
    (wordFreqByCat[r.category] ??= new Map());
    for (const w of r.hitWords) {
      wordFreqByCat[r.category].set(
        w,
        (wordFreqByCat[r.category].get(w) || 0) + 1,
      );
    }
    (samplesByCat[r.category] ??= []);
    if (samplesByCat[r.category].length < 5) {
      samplesByCat[r.category].push(t.text.slice(0, 50));
    }
  }

  const total = transcripts.length;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  console.log("\n===== 分野別の件数 =====");
  const ordered = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
  for (const [cat, n] of ordered) {
    console.log(`${cat.padEnd(14)} ${String(n).padStart(6)}  (${pct(n)}%)`);
  }
  console.log(`${"unknown".padEnd(14)} ${String(unknown).padStart(6)}  (${pct(unknown)}%)`);

  console.log("\n===== 各分野でよくヒットした語 top15（誤マッチ発見用）=====");
  for (const [cat] of ordered) {
    const top = [...wordFreqByCat[cat].entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    console.log(`-- ${cat} --`);
    console.log(top.map(([w, n]) => `${w}(${n})`).join("  "));
  }

  console.log("\n===== 各分野のサンプル本文（先頭50字）=====");
  for (const [cat] of ordered) {
    console.log(`-- ${cat} --`);
    for (const s of samplesByCat[cat]) console.log(`  ${s}`);
  }
}

main();
