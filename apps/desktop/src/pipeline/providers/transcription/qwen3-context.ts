/**
 * Build the system `context` string passed to Qwen3-ASR.
 *
 * Unlike Whisper's `initial_prompt` — a decoder prefix where only the tail
 * survives the ~224-token cap — Qwen3-ASR injects this verbatim into the chat
 * template's system message (`<|im_start|>system\n{context}<|im_end|>`, see
 * speech-swift's `Qwen3ASRModel.generateText`). The model reads it as
 * background knowledge / a glossary and biases recognition toward these terms.
 *
 * The effect is soft: it nudges the decoder's token probabilities, it does not
 * force output. Confident, deterministic spelling normalization therefore still
 * belongs in the post-format `applyTextReplacements` pass. This path only
 * carries the non-replacement vocabulary hints (proper nouns, jargon) — the
 * same words WhisperProvider already feeds into `initial_prompt` — so they get
 * biased at recognition time instead of only patched up afterwards.
 */

/**
 * CJK code-point test (Han ideographs, kana, CJK punctuation, fullwidth forms,
 * and the supplementary ideograph planes). Used only by the token estimator.
 */
function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) || // CJK symbols & punctuation
    (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana + Katakana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xff00 && cp <= 0xffef) || // Halfwidth & Fullwidth forms
    (cp >= 0x20000 && cp <= 0x2fa1f) // CJK Unified Ext B–F + Compat Supplement
  );
}

/**
 * Rough token-count estimate for the Qwen tokenizer, used to budget the system
 * context without a round-trip to the helper's real tokenizer.
 *
 * Why not bytes: prefill cost (latency + KV cache) scales with TOKENS, and the
 * bytes-per-token ratio is strongly language-dependent — CJK packs roughly one
 * token per (3-byte) character while ASCII runs ~4 chars per token. Budgeting in
 * bytes therefore taxes languages unequally: a fixed byte cap buys Japanese far
 * fewer tokens of prefill than English for the same byte count. See Petrov et
 * al. 2023 (arXiv:2305.15425) and Ahia et al. 2023 (arXiv:2305.13707) on
 * tokenizer "unfairness" / token premiums across languages.
 *
 * The per-character weights are deliberately on the high side so the estimate
 * over- rather than under-counts: overshooting keeps us safely under the real
 * prefill budget (we drop a word one too early, never one too late). This is an
 * approximation; Phase 2+ may swap it for the helper's exact tokenizer count
 * (see CONTEXTUAL_BIASING_PLAN.md).
 */
export function estimateQwen3Tokens(s: string): number {
  let tokens = 0;
  // for...of iterates by code point, so surrogate pairs count as one char.
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isCjkCodePoint(cp)) {
      tokens += 1; // CJK: ~1 token per character
    } else if (cp < 0x80) {
      tokens += 0.25; // ASCII: ~4 characters per token
    } else {
      tokens += 0.5; // other scripts (Cyrillic, Hangul, …): conservative middle
    }
  }
  return tokens;
}

/**
 * Max estimated tokens for the Qwen3 system context.
 *
 * This is a prefill cost: every token here runs through the decoder's first
 * forward pass before any audio token is read. The value is anchored to the old
 * 1500-byte cap's worst case — CJK text hit ~500 tokens at 1500 bytes — so the
 * heaviest language keeps its previous prefill cost while lighter-script
 * languages (English, etc.), which were leaving budget unused under the byte
 * cap, can now pack more hints into the same token cost. `selectVocabularyHints*`
 * still caps the hint list at 200 words upstream; this token budget is the
 * secondary, language-fair guard.
 */
export const MAX_QWEN3_CONTEXT_TOKENS = 500;

/** Joiner between glossary terms. */
const SEP = ", ";
const SEP_TOKENS = estimateQwen3Tokens(SEP);

export interface BuildQwen3ContextOptions {
  /**
   * Non-replacement vocabulary / hotwords (proper nouns, jargon). The caller is
   * expected to order these by importance (manual entries before dictionary
   * entries, as `selectVocabularyHintsFromMixed` does) — the token budget drops
   * words from the TAIL, so the most important ones survive truncation.
   */
  vocabulary?: readonly string[];
}

/**
 * Join the vocabulary into a comma-separated glossary, truncated to
 * `MAX_QWEN3_CONTEXT_TOKENS` (estimated) by dropping whole words from the tail
 * (so we never emit a half-word and the caller's importance ordering is
 * respected).
 *
 * Returns `undefined` when there's nothing to bias with — callers pass that
 * straight through, and the helper treats an empty/absent context as "no bias".
 */
export function buildQwen3Context(
  opts: BuildQwen3ContextOptions,
): string | undefined {
  const vocab = (opts.vocabulary ?? [])
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (vocab.length === 0) return undefined;

  const kept: string[] = [];
  let tokens = 0;
  for (const word of vocab) {
    const add = (kept.length === 0 ? 0 : SEP_TOKENS) + estimateQwen3Tokens(word);
    if (tokens + add > MAX_QWEN3_CONTEXT_TOKENS) break;
    kept.push(word);
    tokens += add;
  }

  if (kept.length === 0) return undefined;
  return kept.join(SEP);
}
