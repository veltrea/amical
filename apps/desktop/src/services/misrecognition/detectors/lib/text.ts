/**
 * Surface-only text helpers shared by Rule-category detectors.
 *
 * v3 deliberately removes v1's `normalizeKey` (dakuten/handakuten stripping
 * + long-mark vowel expansion). v1's stripping caused `ノード ≡ ノート`
 * misclassification. v3 instead reserves reading-based grouping for the
 * morphological detector (`same-reading-group`); Rule detectors stay on
 * surface form and pairwise edit distance.
 */

export const TOKEN_REGEX =
  /[゠-ヿー]+|[぀-ゟー]+|[一-鿿][぀-ゟ]*|[A-Za-z][A-Za-z0-9]*/gu;

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text.match(TOKEN_REGEX) ?? [];
}

const KATAKANA_TO_HIRAGANA_OFFSET = 0x30a1 - 0x3041;

export function kataToHira(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code - KATAKANA_TO_HIRAGANA_OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Surface-shaped grouping key. Katakana → hiragana, ASCII → lowercase.
 * Dakuten and long-mark are kept intact — Rule detectors compare members of
 * the group by pairwise edit distance, not by approximate phonetic identity.
 */
export function surfaceNormalizeKey(word: string): string {
  return kataToHira(word).toLowerCase();
}

export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export function isKatakanaToken(t: string): boolean {
  return /^[゠-ヿー]+$/u.test(t);
}

export function isAsciiToken(t: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(t);
}

export function hasMixedAsciiJapanese(t: string): boolean {
  return /[A-Za-z]/.test(t) && /[぀-ヿ一-鿿]/u.test(t);
}
