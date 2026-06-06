/**
 * Apply vocabulary replacements to text.
 * Uses word boundaries for alphabetic languages, simple replacement for CJK.
 *
 * @param text - The text to apply replacements to
 * @param replacements - Map of words to their replacements
 * @returns The text with replacements applied
 */
export function applyTextReplacements(
  text: string,
  replacements: Map<string, string>,
): string {
  if (replacements.size === 0 || !text) {
    return text;
  }

  let result = text;

  // CJK character detection: Han (Chinese/Japanese Kanji), Hiragana, Katakana, Hangul (Korean)
  const cjkPattern =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

  // Apply longest triggers first so a shorter trigger doesn't consume a substring
  // of a longer one (e.g. `link` must not fire before `meeting link`). Map iterates
  // in insertion order, so without this sort, behavior would depend on creation order.
  const sortedEntries = [...replacements].sort(
    ([a], [b]) => b.length - a.length,
  );

  for (const [word, replacement] of sortedEntries) {
    // Escape special regex characters in the word
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Escape `$` in the replacement so $& / $1 / $$ / $` / $' aren't
    // interpreted as backreferences by String.prototype.replace.
    const literalReplacement = replacement.replace(/\$/g, "$$$$");
    const hasCJK = cjkPattern.test(word);
    // Katakana run, incl. the prolonged-sound mark ー (U+30FC, Script=Common)
    // and small kana, which are all part of katakana words.
    const katakanaClass = "\\p{Script=Katakana}\\u30FC";
    const isAllKatakana = new RegExp(`^[${katakanaClass}]+$`, "u").test(word);

    if (isAllKatakana) {
      // All-katakana trigger: replace only when it stands as its own katakana
      // run, not glued inside a longer katakana word. CJK has no spaces, so we
      // use same-script adjacency as the word boundary. Without this, a short
      // trigger eats a substring of an unrelated word that is not itself a
      // dictionary entry (so longest-first sorting can't shield it): e.g.
      // "プル"→pull breaking アップル/シンプル, "メイン"→main breaking ドメイン,
      // "マージ"→merge breaking マージン, "ヘッド"→HEAD breaking ヘッドホン.
      const regex = new RegExp(
        `(?<![${katakanaClass}])${escapedWord}(?![${katakanaClass}])`,
        "giu",
      );
      result = result.replace(regex, literalReplacement);
    } else if (hasCJK) {
      // Other CJK (kanji / hiragana / mixed): simple substring replacement.
      // Japanese/Chinese/Korean text has no spaces between words.
      const regex = new RegExp(escapedWord, "giu");
      result = result.replace(regex, literalReplacement);
    } else {
      // Alphabetic languages: Use Unicode-aware word boundary matching
      // Negative lookbehind/lookahead ensures word is not part of a larger word
      const regex = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapedWord}(?![\\p{L}\\p{N}])`,
        "giu",
      );
      result = result.replace(regex, literalReplacement);
    }
  }

  return result;
}
