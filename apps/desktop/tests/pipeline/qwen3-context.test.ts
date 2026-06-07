import { describe, it, expect } from "vitest";
import {
  buildQwen3Context,
  estimateQwen3Tokens,
  MAX_QWEN3_CONTEXT_TOKENS,
} from "../../src/pipeline/providers/transcription/qwen3-context";

describe("estimateQwen3Tokens", () => {
  it("counts ASCII at ~0.25 tokens/char", () => {
    expect(estimateQwen3Tokens("abcd")).toBe(1); // 4 * 0.25
    expect(estimateQwen3Tokens("Kubernetes")).toBe(2.5); // 10 * 0.25
  });

  it("counts CJK at ~1 token/char", () => {
    expect(estimateQwen3Tokens("機械学習")).toBe(4);
    expect(estimateQwen3Tokens("こうしょう")).toBe(5);
  });

  it("counts the separator", () => {
    expect(estimateQwen3Tokens(", ")).toBe(0.5);
  });

  it("handles mixed scripts and surrogate pairs", () => {
    expect(estimateQwen3Tokens("AI辞書")).toBe(2.5); // "AI"=0.5, "辞書"=2
    // CJK Ext B (surrogate pair) counts as a single CJK character.
    expect(estimateQwen3Tokens("\u{20000}")).toBe(1);
  });
});

describe("buildQwen3Context", () => {
  it("returns undefined when there is no vocabulary", () => {
    expect(buildQwen3Context({})).toBeUndefined();
    expect(buildQwen3Context({ vocabulary: [] })).toBeUndefined();
  });

  it("returns undefined when every entry is blank", () => {
    expect(buildQwen3Context({ vocabulary: ["", "   ", "\t"] })).toBeUndefined();
  });

  it("joins vocabulary with ', '", () => {
    expect(
      buildQwen3Context({ vocabulary: ["Kubernetes", "PostgreSQL", "Amical"] }),
    ).toBe("Kubernetes, PostgreSQL, Amical");
  });

  it("trims entries and drops blanks", () => {
    expect(buildQwen3Context({ vocabulary: ["  Rust ", "", "  Tauri"] })).toBe(
      "Rust, Tauri",
    );
  });

  it("keeps multibyte (Japanese) vocabulary intact", () => {
    expect(buildQwen3Context({ vocabulary: ["redacted", "音声入力", "辞書"] })).toBe(
      "redacted, 音声入力, 辞書",
    );
  });

  it("drops whole words from the tail when over the token budget", () => {
    // Each word is 10 ASCII chars = 2.5 tokens; with ", " (0.5) the budget
    // (500) fits 166 words (2.5 + 165*3 = 497.5) but not 167 (500.5).
    const words = Array.from(
      // 4-digit index + 6 'a' = 10 ASCII chars per word, fixed length.
      { length: 300 },
      (_, i) => `${String(i).padStart(4, "0")}${"a".repeat(6)}`,
    );
    const out = buildQwen3Context({ vocabulary: words });
    expect(out).toBeDefined();
    const kept = out!.split(", ");
    // Never exceeds the budget.
    expect(estimateQwen3Tokens(out!)).toBeLessThanOrEqual(
      MAX_QWEN3_CONTEXT_TOKENS,
    );
    // Preserves caller ordering: tail dropped, head kept.
    expect(kept[0]).toBe(words[0]);
    expect(kept.length).toBe(166);
  });

  it("budgets by token estimate, not bytes — equal token-cost words fit equally regardless of script", () => {
    // 8 ASCII chars = 2 tokens; 2 CJK chars = 2 tokens. Same token cost per
    // word, so the same number survives the budget — the language-fairness
    // property a byte budget would NOT have (8 bytes vs 6 bytes per word).
    const en = Array.from({ length: 300 }, () => "abcdefgh");
    const ja = Array.from({ length: 300 }, () => "漢字");
    const enKept = buildQwen3Context({ vocabulary: en })!.split(", ").length;
    const jaKept = buildQwen3Context({ vocabulary: ja })!.split(", ").length;
    expect(enKept).toBe(jaKept);
  });

  it("keeps the earliest (most important) words when truncating", () => {
    // A single word larger than the whole budget yields nothing.
    const huge = "x".repeat(MAX_QWEN3_CONTEXT_TOKENS * 4 + 4); // > budget (ASCII /4)
    expect(buildQwen3Context({ vocabulary: [huge] })).toBeUndefined();
    // A fitting first word survives while an over-budget second is dropped.
    expect(buildQwen3Context({ vocabulary: ["ok", huge] })).toBe("ok");
  });
});
