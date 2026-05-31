/**
 * Pure scanner: turns transcription texts into misrecognition candidates.
 *
 * Zero electron / DB / @amical/types imports — runnable directly via
 *   npx tsx apps/desktop/src/services/misrecognition/scanner-core.ts
 * to inspect tokenization and scoring on a sample text.
 */

export interface ScanInputRow {
  id: number;
  text: string;
}

export interface ExistingVocabularyEntry {
  word: string;
  replacementWord?: string | null;
}

export interface ExtractedCandidate {
  word: string;
  normalizedKey: string;
  occurrences: number;
  rules: string[]; // which rules fired (debug)
}

export interface ScanResult {
  candidates: ExtractedCandidate[];
  maxTranscriptionId: number;
  scannedRowCount: number;
}

// --- Tokenization -----------------------------------------------------------

// Katakana incl. half-width handling is intentionally limited; v1 targets
// full-width katakana, hiragana, kanji+okurigana, and ascii-letter runs.
const TOKEN_REGEX =
  /[゠-ヿー]+|[぀-ゟー]+|[一-鿿][぀-ゟ]*|[A-Za-z][A-Za-z0-9]*/gu;

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text.match(TOKEN_REGEX) ?? [];
}

// --- Normalization ----------------------------------------------------------

const KATAKANA_TO_HIRAGANA_OFFSET = 0x30a1 - 0x3041;

function kataToHira(s: string): string {
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

// Map small-kana → normal kana so that vowel-extraction of `ー` still works
// for things like `ジョー` (consider as じよう → じよう), and unify common
// reading variants.
const SMALL_TO_NORMAL: Record<string, string> = {
  ぁ: "あ",
  ぃ: "い",
  ぅ: "う",
  ぇ: "え",
  ぉ: "お",
  っ: "つ",
  ゃ: "や",
  ゅ: "ゆ",
  ょ: "よ",
  ゎ: "わ",
};

const HIRA_VOWEL: Record<string, string> = {
  // a-row
  あ: "あ",
  か: "あ",
  が: "あ",
  さ: "あ",
  ざ: "あ",
  た: "あ",
  だ: "あ",
  な: "あ",
  は: "あ",
  ば: "あ",
  ぱ: "あ",
  ま: "あ",
  や: "あ",
  ら: "あ",
  わ: "あ",
  // i-row
  い: "い",
  き: "い",
  ぎ: "い",
  し: "い",
  じ: "い",
  ち: "い",
  ぢ: "い",
  に: "い",
  ひ: "い",
  び: "い",
  ぴ: "い",
  み: "い",
  り: "い",
  // u-row
  う: "う",
  く: "う",
  ぐ: "う",
  す: "う",
  ず: "う",
  つ: "う",
  づ: "う",
  ぬ: "う",
  ふ: "う",
  ぶ: "う",
  ぷ: "う",
  む: "う",
  ゆ: "う",
  る: "う",
  // e-row
  え: "え",
  け: "え",
  げ: "え",
  せ: "え",
  ぜ: "え",
  て: "え",
  で: "え",
  ね: "え",
  へ: "え",
  べ: "え",
  ぺ: "え",
  め: "え",
  れ: "え",
  // o-row
  お: "お",
  こ: "お",
  ご: "お",
  そ: "お",
  ぞ: "お",
  と: "お",
  ど: "お",
  の: "お",
  ほ: "お",
  ぼ: "お",
  ぽ: "お",
  も: "お",
  よ: "お",
  ろ: "お",
  を: "お",
};

const DAKUTEN_STRIP: Record<string, string> = {
  が: "か",
  ぎ: "き",
  ぐ: "く",
  げ: "け",
  ご: "こ",
  ざ: "さ",
  じ: "し",
  ず: "す",
  ぜ: "せ",
  ぞ: "そ",
  だ: "た",
  ぢ: "ち",
  づ: "つ",
  で: "て",
  ど: "と",
  ば: "は",
  び: "ひ",
  ぶ: "ふ",
  べ: "へ",
  ぼ: "ほ",
  ぱ: "は",
  ぴ: "ひ",
  ぷ: "ふ",
  ぺ: "へ",
  ぽ: "ほ",
};

/**
 * Reading-shaped key used to group "same reading" variants.
 *
 * - katakana → hiragana
 * - small kana → normal kana (`ジョー` → `しよお`)
 * - long mark `ー` → previous char's vowel
 * - dakuten/handakuten stripped (`バス` ≡ `パス` ≡ `はす`) — intentionally
 *   over-matches; UI-driven dismissal handles the noise.
 * - ascii letters → lowercase
 * - everything else passed through (kanji are kept distinct on purpose so a
 *   `OCR-broken` kanji+kana mix doesn't get falsely grouped)
 */
export function normalizeKey(word: string): string {
  const hira = kataToHira(word);
  let out = "";
  for (const ch of hira) {
    let c = SMALL_TO_NORMAL[ch] ?? ch;
    if (c === "ー") {
      const prev = out[out.length - 1] ?? "";
      const vowel = HIRA_VOWEL[prev];
      if (vowel) {
        out += vowel;
        continue;
      }
      // unknown previous char (kanji, ascii, …) — keep the mark
      out += c;
      continue;
    }
    c = DAKUTEN_STRIP[c] ?? c;
    if (/[A-Za-z]/.test(c)) {
      c = c.toLowerCase();
    }
    out += c;
  }
  return out;
}

// --- Edit distance (for ニアミス検出) ----------------------------------------

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

// --- Character class helpers ------------------------------------------------

function isKatakanaToken(t: string): boolean {
  return /^[゠-ヿー]+$/u.test(t);
}
function isAsciiToken(t: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(t);
}
function hasMixedAsciiJapanese(t: string): boolean {
  const hasAscii = /[A-Za-z]/.test(t);
  const hasJa = /[぀-ヿ一-鿿]/u.test(t);
  return hasAscii && hasJa;
}

// --- Scoring rules ----------------------------------------------------------

const MIN_TOKEN_LENGTH = 3;
const LOW_FREQ_MAX = 3;
const NEAR_MISS_MAX_EDIT = 1;
const KATAKANA_VARIANT_MAX_EDIT = 2;

export interface ScoringOptions {
  /** Drop tokens shorter than this when checking low-frequency rule. */
  minTokenLength?: number;
}

interface TokenCount {
  word: string;
  count: number;
}

/**
 * Run all rules over the counted tokens. Returns the subset that should be
 * surfaced as candidates, with the firing rule names attached (for logging).
 *
 * Existing vocabulary words are excluded from the result and used as a
 * reference set for the "near-miss against vocabulary" rule.
 */
export function extractCandidates(
  tokenCounts: TokenCount[],
  vocabulary: ExistingVocabularyEntry[],
  options: ScoringOptions = {},
): ExtractedCandidate[] {
  const minLen = options.minTokenLength ?? MIN_TOKEN_LENGTH;

  // Build vocabulary lookup sets.
  const vocabWords = new Set<string>();
  const vocabReplacements = new Set<string>();
  for (const v of vocabulary) {
    vocabWords.add(v.word);
    if (v.replacementWord) vocabReplacements.add(v.replacementWord);
  }
  const isInVocab = (w: string) =>
    vocabWords.has(w) || vocabReplacements.has(w);

  // Group katakana tokens by normalizedKey for the variant rule.
  const kataByKey = new Map<string, TokenCount[]>();
  for (const tc of tokenCounts) {
    if (!isKatakanaToken(tc.word)) continue;
    const key = normalizeKey(tc.word);
    const arr = kataByKey.get(key) ?? [];
    arr.push(tc);
    kataByKey.set(key, arr);
  }

  // Pre-compute: which katakana words have a near-edit-distance variant in
  // their key group AND are minority (non-dominant) members of that group.
  //
  // The dominant member (highest occurrence) is treated as the intended
  // spelling and is NOT flagged — only the rarer variants are candidates
  // for replacement. Without this filter common words (`テスト` × 792) get
  // flagged just because a single typo (`デスト` × 1) shares the reading.
  const katakanaVariantWords = new Set<string>();
  for (const arr of kataByKey.values()) {
    if (arr.length < 2) continue;
    const maxCount = Math.max(...arr.map((t) => t.count));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (
          editDistance(arr[i].word, arr[j].word, KATAKANA_VARIANT_MAX_EDIT) <=
          KATAKANA_VARIANT_MAX_EDIT
        ) {
          if (arr[i].count < maxCount) katakanaVariantWords.add(arr[i].word);
          if (arr[j].count < maxCount) katakanaVariantWords.add(arr[j].word);
        }
      }
    }
  }

  // Vocabulary list for near-miss rule (cap to a small set per token to keep
  // O(n*m) bounded; in practice vocabulary is small).
  const vocabList = [...vocabWords];

  const out: ExtractedCandidate[] = [];
  for (const tc of tokenCounts) {
    if (isInVocab(tc.word)) continue;

    const rules: string[] = [];

    if (katakanaVariantWords.has(tc.word)) {
      rules.push("katakana-variant");
    }

    if (
      tc.count <= LOW_FREQ_MAX &&
      tc.word.length >= minLen &&
      (isKatakanaToken(tc.word) || isAsciiToken(tc.word))
    ) {
      rules.push("low-frequency");
    }

    if (hasMixedAsciiJapanese(tc.word)) {
      rules.push("mixed-script");
    }

    // near-vocab: only fire on low-frequency tokens. High-frequency tokens
    // that happen to be edit-distance 1 from a vocabulary entry are usually
    // legitimate words, not typos of the vocab entry.
    if (tc.count <= LOW_FREQ_MAX && tc.word.length >= minLen) {
      for (const v of vocabList) {
        if (Math.abs(v.length - tc.word.length) > NEAR_MISS_MAX_EDIT) continue;
        if (editDistance(v, tc.word, NEAR_MISS_MAX_EDIT) <= NEAR_MISS_MAX_EDIT) {
          rules.push("near-vocab");
          break;
        }
      }
    }

    if (rules.length === 0) continue;

    out.push({
      word: tc.word,
      normalizedKey: normalizeKey(tc.word),
      occurrences: tc.count,
      rules,
    });
  }

  return out;
}

/**
 * High-level entry point used by the DB-backed service. Counts tokens across
 * the input rows, then runs `extractCandidates`. Pure — no DB access.
 */
export function scanRows(
  rows: ScanInputRow[],
  vocabulary: ExistingVocabularyEntry[],
  options: ScoringOptions = {},
): ScanResult {
  const counts = new Map<string, number>();
  let maxId = 0;
  for (const row of rows) {
    if (row.id > maxId) maxId = row.id;
    for (const tok of tokenize(row.text)) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  const tokenCounts: TokenCount[] = [...counts.entries()].map(
    ([word, count]) => ({ word, count }),
  );
  const candidates = extractCandidates(tokenCounts, vocabulary, options);
  return {
    candidates,
    maxTranscriptionId: maxId,
    scannedRowCount: rows.length,
  };
}

// --- tsx-friendly demo ------------------------------------------------------

// Allow `npx tsx scanner-core.ts` to print a quick demo.
// Avoids any Node-specific imports so the file stays bundler-friendly.
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === (module as unknown)
) {
  const demo = scanRows(
    [
      {
        id: 1,
        text: "今日はアミカルを使った。あみかるは便利だ。Apple果物。",
      },
      { id: 2, text: "アミ狩るって誤認識された。コーヒも変だ。" },
      { id: 3, text: "コーヒーが美味しい。" },
    ],
    [{ word: "コーヒー" }],
  );
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(demo, null, 2));
}
