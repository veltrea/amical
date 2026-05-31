// On-device MLX proofreading memory strategy. Exposed as a user option because
// some users run other local LLMs (LM Studio, etc.) alongside Amical:
//   - "balanced" (default): ASR stays resident; the LLM is loaded when formatting
//     and kept warm for subsequent dictations.
//   - "fast": both ASR and the LLM stay resident (warmed up front). Lowest latency,
//     highest RAM.
//   - "low": the LLM is unloaded after each format, leaving only ASR resident.
//     Lowest RAM; pays a reload on the next dictation.
export type MlxMemoryStrategy = "balanced" | "fast" | "low";

export interface FormatterConfig {
  enabled: boolean;
  modelId?: string; // Selection key "<providerInstanceId>::<type>::<id>" or legacy raw model ID
  fallbackModelId?: string; // Selection key "<providerInstanceId>::<type>::<id>" or legacy raw model ID
  mlxMemoryStrategy?: MlxMemoryStrategy; // default "balanced"
  // Free-form user-supplied formatting instructions (e.g. "always use polite
  // form in Japanese", "prefer Oxford comma"). Threaded into the system prompt
  // as a separate "User Preferences" block, kept distinct from the curated
  // few-shot examples so user rules cannot collide with built-in demonstrations.
  userInstructions?: string;
  // POWER-USER ESCAPE HATCH. When set (non-empty after trim) this string
  // becomes the FULL system prompt — built-in safety rules, examples, and
  // output-format instructions are all replaced. Useful when the curated
  // few-shot examples in the default template ("minimal formatting only")
  // actively work against the user's intent — e.g. converting casual speech
  // to a formal email tone, applying a domain-specific style guide, or
  // translating between language registers.
  // The user is responsible for telling the model to wrap its output in
  // <formatted_text>...</formatted_text> — otherwise extract-formatted-text
  // falls back to the raw transcription.
  customSystemPrompt?: string;
}
