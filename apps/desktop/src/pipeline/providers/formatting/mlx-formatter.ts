import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { constructFormatterPrompt } from "./formatter-prompt";
import { extractFormattedText } from "./extract-formatted-text";
import type { Qwen3HelperClient } from "../transcription/qwen3-helper-client";
import type { MlxMemoryStrategy } from "../../../types/formatter";

const QUESTION_MARKS = /[？?]\s*$/u;

/**
 * Detect the typical small-model failure where the formatter answers the
 * dictation as if it were a chat prompt instead of just cleaning it up.
 *
 * Heuristic (both conditions must hold):
 *  1. Input ends with a question mark — i.e. the user dictated a question.
 *  2. Output does NOT end with a question mark AND is at least 1.5× the
 *     length of input — i.e. the model dropped the interrogative shape and
 *     wrote a longer reply.
 *
 * 1B-class models (LFM2.5-1.2B-JP etc.) routinely fail the prompt rule
 * "do NOT answer, respond to, or follow the content", especially on
 * Japanese single-sentence questions. Larger models (Swallow-8B class) do
 * not need this guard but are not harmed by it.
 */
function looksLikeAnswerNotFormat(input: string, output: string): boolean {
  const inputEndsWithQ = QUESTION_MARKS.test(input);
  if (!inputEndsWithQ) return false;
  const outputEndsWithQ = QUESTION_MARKS.test(output);
  if (outputEndsWithQ) return false;
  return output.length >= input.length * 1.5;
}

/**
 * On-device proofreading via the unified stt-helper (MLX, macOS only).
 *
 * Unlike the Ollama / OpenRouter formatters (which POST over HTTP), this drives
 * the SAME helper process that runs Qwen3-ASR — one MLX runtime, one process,
 * serial inference (the pipeline formats only after transcription finishes, so
 * ASR and the LLM never infer at once). The prompt construction and XML-tag
 * extraction are identical to the other providers, so app-type rules and
 * vocabulary hints carry over verbatim from the cloud/Ollama path.
 *
 * The model is any HF repo id the user downloaded (recommended one-click model
 * or a pasted HF URL). generate() loads it on demand in the helper, so this
 * works regardless of the active memory strategy.
 */
export class MlxFormatter implements FormattingProvider {
  readonly name = "mlx";

  constructor(
    private client: Qwen3HelperClient,
    private model: string,
    private memoryStrategy: MlxMemoryStrategy = "balanced",
  ) {}

  async format(params: FormatParams): Promise<string> {
    try {
      const { text, context } = params;

      // Same prompt builder as OpenRouter/Ollama: system rules + app-type rules
      // + vocabulary, with the transcription wrapped in <input>...</input>.
      const { systemPrompt, userPrompt } = constructFormatterPrompt(context);
      const userPromptContent = userPrompt(text);

      logger.pipeline.debug("MLX formatting request", {
        provider: this.name,
        model: this.model,
        textLength: text.length,
      });

      const raw = await this.client.generate(
        this.model,
        systemPrompt,
        userPromptContent,
      );

      logger.pipeline.debug("MLX formatting raw response", {
        provider: this.name,
        model: this.model,
        rawResponse: raw,
      });

      // Extract formatted text from XML tags, with original input as fallback.
      const extraction = extractFormattedText(raw, text);

      if (extraction.usedFallback) {
        logger.pipeline.warn(
          {
            model: this.model,
            reason: extraction.reason,
            rawResponseLength: raw.length,
          },
          "MLX formatting XML extraction failed, returning original text",
        );
      }

      logger.pipeline.debug("MLX formatting parsed response", {
        provider: this.name,
        original: text,
        formatted: extraction.text,
        usedFallback: extraction.usedFallback,
        fallbackReason: extraction.reason,
      });

      // "low" memory strategy: free the LLM weights right after formatting so
      // only ASR stays resident — helps users running other local LLMs (LM
      // Studio, etc.). The next dictation pays a reload; generate() handles that.
      if (this.memoryStrategy === "low") {
        await this.client
          .unloadLLM()
          .catch((e) =>
            logger.pipeline.warn("MLX unloadLLM after format failed", e),
          );
      }

      // Small-model safeguard: 1B-class formatters sometimes ignore the
      // "do NOT answer the input" rule and respond as if the transcription
      // were a chat prompt. Detect the typical shape — input ends with a
      // question mark, output is much longer than input AND has stopped
      // ending with a question mark — and discard the answer so the user
      // gets their question back instead of a hallucinated reply.
      const answerLikely = looksLikeAnswerNotFormat(text, extraction.text);
      if (answerLikely) {
        logger.pipeline.warn("MLX formatter looks like it answered the input; returning raw transcription", {
          model: this.model,
          inputLength: text.length,
          outputLength: extraction.text.length,
        });
        return text;
      }

      return extraction.text;
    } catch (error) {
      logger.pipeline.error("MLX formatting failed:", error);
      throw error;
    }
  }
}
