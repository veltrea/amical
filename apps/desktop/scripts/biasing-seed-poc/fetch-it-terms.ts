// バイアシング辞書の「候補語リスト（叩き台）」を、日本語Wikipedia の
// 情報技術系カテゴリの見出し語から作る PoC。
//
// 狙い: 外部の公開・合法ソース（Wikipedia 公式 API, CC-BY-SA）から、IT 分野の
// 見出し語を広く集めて候補リストにする。これを別スクリプトで「自分の文字起こし
// 履歴」と突き合わせ、よく使う語トップ N をバイアシング辞書にする。
// CONTEXTUAL_BIASING の議論（2026-06-07）に基づく。Web クロールは使わない。
//
// 使い方: リポジトリ直下で
//   npx tsx apps/desktop/scripts/biasing-seed-poc/fetch-it-terms.ts
// 出力: /tmp/it-term-candidates.json （候補語の配列）

import { writeFileSync } from "node:fs";

// 取得対象の Wikipedia カテゴリ（日本語版）。叩き台なので主要どころを直下のみ。
// 取得数を見て、足りなければサブカテゴリ展開や対象追加を検討する。
const CATEGORIES = [
  "プログラミング言語",
  "プログラミング",
  "ソフトウェア",
  "ソフトウェア開発",
  "情報技術",
  "データベース",
  "アルゴリズム",
  "データ構造",
  "計算機科学",
  "コンピュータ",
  "オペレーティングシステム",
  "プログラミング言語の概念",
  "ソフトウェア開発工程",
  "機械学習",
  "人工知能",
];

const API = "https://ja.wikipedia.org/w/api.php";
// Wikipedia API のマナーとして UA を明示する（連絡先がわりの識別子）。
const UA = "amical-biasing-poc/0.1 (local research; contact: dev)";

interface CmMember {
  title: string;
  ns: number;
}

/** 1カテゴリの直下メンバー（記事のみ）を全件取得する。 */
async function fetchCategoryMembers(cat: string): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined;
  do {
    const url = new URL(API);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "categorymembers");
    url.searchParams.set("cmtitle", `Category:${cat}`);
    url.searchParams.set("cmlimit", "500");
    url.searchParams.set("cmtype", "page"); // 記事のみ（サブカテゴリ・テンプレ除く）
    url.searchParams.set("format", "json");
    if (cmcontinue) url.searchParams.set("cmcontinue", cmcontinue);

    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`  [${cat}] HTTP ${res.status}`);
      break;
    }
    const data = (await res.json()) as {
      query?: { categorymembers?: CmMember[] };
      continue?: { cmcontinue?: string };
    };
    for (const m of data.query?.categorymembers ?? []) {
      if (m.ns === 0) titles.push(m.title); // ns=0 は通常記事
    }
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);
  return titles;
}

/** 用語として不向きな見出しを落とす。 */
function isUsableTitle(t: string): boolean {
  if (t.includes("一覧")) return false; // 「○○の一覧」記事
  if (t.includes("（曖昧さ回避）")) return false;
  if (t.includes("(曖昧さ回避)")) return false;
  if (t.includes("年表")) return false;
  if (t.includes("歴史")) return false;
  if (t.length <= 1) return false;
  return true;
}

async function main() {
  const all = new Set<string>();
  for (const cat of CATEGORIES) {
    try {
      const members = await fetchCategoryMembers(cat);
      const usable = members.filter(isUsableTitle);
      console.log(
        `${cat.padEnd(20)} 取得 ${String(members.length).padStart(4)} / 採用 ${String(usable.length).padStart(4)}`,
      );
      for (const t of usable) all.add(t);
    } catch (e) {
      console.error(`  [${cat}] error:`, (e as Error).message);
    }
  }

  const list = [...all].sort();
  writeFileSync("/tmp/it-term-candidates.json", JSON.stringify(list, null, 0));
  console.log(`\n候補語（重複排除後）: ${list.length} 語 → /tmp/it-term-candidates.json`);
  console.log("\nサンプル（先頭40語）:");
  console.log(list.slice(0, 40).join("  "));
}

main();
