// On-device MLX proofreading LLMs (macOS only), run inside the stt-helper via
// the generic MLXLLM loader. Unlike the ASR models in models.ts (a fixed
// manifest), these are language models tracked in the DB like OpenRouter/Ollama
// entries (providerType "mlx"), so users can add ANY Hugging Face repo too.

export interface RecommendedMlxLlm {
  /** Hugging Face repo id, e.g. "mlx-community/Qwen3-1.7B-4bit". */
  id: string;
  name: string;
  sizeFormatted: string;
  /** Approximate on-disk size in bytes (UI display only). */
  sizeBytes: number;
  description: string;
}

// One-click presets. All loadable by the generic MLXLLM loader (standard
// mlx-community layout: config.json + tokenizer.json + *.safetensors). The 1.7B
// 4-bit is the recommended default: solid instruction-following for proofreading
// at low memory.
export const RECOMMENDED_MLX_LLMS: RecommendedMlxLlm[] = [
  {
    id: "mlx-community/Qwen3-1.7B-4bit",
    name: "Qwen3 1.7B (4-bit) — recommended",
    sizeFormatted: "~1.0 GB",
    sizeBytes: 1_000_000_000,
    description:
      "Balanced default. Reliable punctuation, filler removal and formatting at low memory.",
  },
  {
    id: "mlx-community/Qwen2.5-0.5B-Instruct-4bit",
    name: "Qwen2.5 0.5B (4-bit) — fastest",
    sizeFormatted: "~0.3 GB",
    sizeBytes: 300_000_000,
    description:
      "Lowest latency and memory. Great for punctuation and light cleanup.",
  },
  {
    id: "mlx-community/Qwen3-4B-4bit",
    name: "Qwen3 4B (4-bit) — highest quality",
    sizeFormatted: "~2.3 GB",
    sizeBytes: 2_300_000_000,
    description:
      "Best instruction-following of the presets. Needs more RAM; still fast on Apple Silicon.",
  },
];

/**
 * Validate and normalize a user-supplied Hugging Face reference (repo id or full
 * URL) into the canonical "namespace/name" form. Returns null if it doesn't look
 * like a repo id, so the UI can show an error instead of triggering a bad download.
 *
 * Accepts:
 *   mlx-community/Qwen3-1.7B-4bit
 *   https://huggingface.co/mlx-community/Qwen3-1.7B-4bit
 *   https://huggingface.co/mlx-community/Qwen3-1.7B-4bit/tree/main
 */
export function normalizeHfRepoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pull "namespace/name" out of a huggingface.co URL if present.
  const urlMatch = trimmed.match(
    /huggingface\.co\/([^/\s]+\/[^/\s?#]+)/i,
  );
  const candidate = urlMatch ? urlMatch[1] : trimmed;

  // Canonical repo id: exactly one slash, HF-allowed characters.
  return /^[\w.-]+\/[\w.-]+$/.test(candidate) ? candidate : null;
}
