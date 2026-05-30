// On-device MLX proofreading LLMs (macOS only), run inside the stt-helper via
// the generic MLXLLM loader. Unlike the ASR models in models.ts (a fixed
// manifest), these are language models tracked in the DB like OpenRouter/Ollama
// entries (providerType "mlx"), so users can add ANY Hugging Face repo too.

export interface RecommendedMlxLlm {
  /** Hugging Face repo id, e.g. "mlx-community/Llama-3.2-3B-Instruct-4bit". */
  id: string;
  name: string;
  sizeFormatted: string;
  /** Approximate on-disk size in bytes (UI display only). */
  sizeBytes: number;
  description: string;
  /**
   * Language codes this model is recommended FOR (e.g. ["ja"]). Amical is
   * internationalized, so we don't pick one "best" model — we recommend per
   * language. The UI surfaces the entries matching the user's dictation language
   * first, then the rest (nothing is hidden). Undefined/empty = general.
   */
  languages?: string[];
}

// Per-language one-click presets. All loadable by the generic MLXLLM loader and
// verified present on Hugging Face. Speech proofreading is short and low-context,
// where a model's fallback language matters more than benchmark scores — hence
// Japanese-specialized models for "ja", and Qwen (strongest at CJK) parked under
// "zh" rather than dropped.
export const RECOMMENDED_MLX_LLMS: RecommendedMlxLlm[] = [
  // 🇯🇵 Japanese
  {
    id: "LiquidAI/LFM2.5-1.2B-JP-MLX-8bit",
    name: "LFM2.5 1.2B JP",
    sizeFormatted: "~1.3 GB",
    sizeBytes: 1_300_000_000,
    description:
      "Japanese-specialized, ultra-light. No Chinese leakage on short input, good instruction-following. First pick for Japanese.",
    languages: ["ja"],
  },
  {
    id: "mlx-community/Llama-3.1-Swallow-8B-Instruct-v0.3-4bit",
    name: "Llama 3.1 Swallow 8B (JP)",
    sizeFormatted: "~4.5 GB",
    sizeBytes: 4_500_000_000,
    description:
      "Japanese-enhanced Llama (continual pretraining). Higher quality; needs more RAM.",
    languages: ["ja"],
  },
  // 🇬🇧 English
  {
    id: "mlx-community/Phi-4-mini-instruct-4bit",
    name: "Phi-4 mini",
    sizeFormatted: "~2.2 GB",
    sizeBytes: 2_200_000_000,
    description:
      "Top-tier instruction-following at a small size — keeps to 'just format' well. Recommended for English.",
    languages: ["en"],
  },
  {
    id: "mlx-community/Llama-3.2-3B-Instruct-4bit",
    name: "Llama 3.2 3B",
    sizeFormatted: "~1.8 GB",
    sizeBytes: 1_800_000_000,
    description:
      "Light, fast, solid general instruction-following. Good English default.",
    languages: ["en"],
  },
  // 🇨🇳 Chinese
  {
    id: "mlx-community/Qwen2.5-3B-Instruct-4bit",
    name: "Qwen2.5 3B",
    sizeFormatted: "~1.8 GB",
    sizeBytes: 1_800_000_000,
    description:
      "Strongest at Chinese / CJK. Note: on short Japanese input it can fall back to Chinese — prefer the JP models above for Japanese.",
    languages: ["zh"],
  },
];

/**
 * Validate and normalize a user-supplied Hugging Face reference (repo id or full
 * URL) into the canonical "namespace/name" form. Returns null if it doesn't look
 * like a repo id, so the UI can show an error instead of triggering a bad download.
 *
 * Accepts:
 *   mlx-community/Llama-3.2-3B-Instruct-4bit
 *   https://huggingface.co/mlx-community/Llama-3.2-3B-Instruct-4bit
 *   https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-MLX-8bit/tree/main
 */
export function normalizeHfRepoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pull "namespace/name" out of a huggingface.co URL if present.
  const urlMatch = trimmed.match(/huggingface\.co\/([^/\s]+\/[^/\s?#]+)/i);
  const candidate = urlMatch ? urlMatch[1] : trimmed;

  // Canonical repo id: exactly one slash, HF-allowed characters.
  return /^[\w.-]+\/[\w.-]+$/.test(candidate) ? candidate : null;
}
