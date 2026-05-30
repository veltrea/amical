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
}
