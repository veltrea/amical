import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { AppError, ErrorCodes } from "../../../types/error";
import { extractSpeechFromVad } from "../../utils/vad-audio-filter";
import { Qwen3HelperClient } from "./qwen3-helper-client";
import { buildQwen3Context } from "./qwen3-context";

/**
 * Qwen3-ASR provider (macOS / Apple Silicon, via the stt-helper MLX process).
 *
 * Mirrors WhisperProvider's frame-buffering + VAD-silence cadence: callers feed
 * 512-sample frames; we aggregate until a silence boundary (or buffer cap), then
 * transcribe the whole utterance (Qwen3-ASR is non-streaming). Inference runs in
 * the dedicated stt-helper process, never in this one.
 *
 * Qwen3-ASR auto-detects language and transcribes in the source language (no
 * translation), so a single selected language is passed only as a hint.
 */
export class Qwen3Provider implements TranscriptionProvider {
  readonly name = "qwen3-local";

  private client: Qwen3HelperClient;

  // HF repo id of the selected Qwen3-ASR variant (e.g. the 0.6B vs 1.7B build).
  // Set from the chosen model before warmup/transcribe; undefined => helper default.
  private modelId?: string;

  // Frame aggregation state (same cadence as WhisperProvider).
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;

  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_AUDIO_DURATION_MS = 500;
  private readonly MAX_SILENCE_DURATION_MS = 3000;
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;
  // Skip slivers too short to be real speech (Qwen3 hallucinates on <~0.2s).
  private readonly MIN_TRANSCRIBE_SAMPLES = 3200; // 0.2s at 16kHz

  constructor(client?: Qwen3HelperClient) {
    this.client = client ?? new Qwen3HelperClient();
  }

  /** Choose which Qwen3-ASR variant the helper loads (HF repo id). */
  setModelId(modelId: string | undefined): void {
    this.modelId = modelId;
  }

  async warmup(): Promise<void> {
    await this.client.prepare(this.modelId);
  }

  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
    const { audioData, speechProbability = 1, context } = params;

    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;
    if (isSpeech) {
      this.currentSilenceFrameCount = 0;
    } else {
      this.currentSilenceFrameCount++;
    }

    if (!this.shouldTranscribe()) {
      return { text: "" };
    }

    return this.doTranscription(context);
  }

  async flush(context: TranscribeContext): Promise<TranscriptionOutput> {
    if (this.frameBuffer.length === 0) {
      return { text: "" };
    }
    return this.doTranscription(context);
  }

  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  private async doTranscription(
    context: TranscribeContext,
  ): Promise<TranscriptionOutput> {
    try {
      const vadProbs = [...this.frameBufferSpeechProbabilities];
      const rawAudio = this.aggregateFrames();
      this.reset();

      const { audio: aggregatedAudio, segments: speechSegments } =
        extractSpeechFromVad(rawAudio, vadProbs);

      if (aggregatedAudio.length < this.MIN_TRANSCRIBE_SAMPLES) {
        logger.transcription.debug(
          "Qwen3: skipping transcription - too little speech after VAD filter",
          { samples: aggregatedAudio.length },
        );
        return { text: "" };
      }

      logger.transcription.debug(
        `Qwen3: VAD filtered ${rawAudio.length} → ${aggregatedAudio.length} samples (${speechSegments.length} segments), transcribing ${((aggregatedAudio.length / this.SAMPLE_RATE) * 1000).toFixed(0)}ms`,
      );

      // Qwen3-ASR auto-detects; pass a single selected language only as a hint.
      const language =
        context.languages?.length === 1 ? context.languages[0] : undefined;

      // Bias recognition toward the activated dictionaries' non-replacement
      // hints by injecting them as Qwen3-ASR's system context (see
      // qwen3-context.ts). Mirrors WhisperProvider's initial_prompt path; the
      // replacement-mode entries still run through the post-format pass.
      const asrContext = buildQwen3Context({ vocabulary: context.vocabulary });

      const text = await this.client.transcribe(
        aggregatedAudio,
        this.SAMPLE_RATE,
        language,
        this.modelId,
        asrContext,
      );

      logger.transcription.debug(
        `Qwen3: transcription completed, length ${text.length}`,
      );

      return { text };
    } catch (error) {
      logger.transcription.error("Qwen3 transcription failed:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Qwen3-ASR transcription failed: ${error instanceof Error ? error.message : error}`,
        ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
      );
    }
  }

  private shouldTranscribe(): boolean {
    const audioDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;

    if (
      audioDurationMs >= this.MIN_AUDIO_DURATION_MS &&
      silenceDurationMs > this.MAX_SILENCE_DURATION_MS
    ) {
      return true;
    }

    // Cap buffer at 30s to bound latency/memory.
    if (audioDurationMs > 30000) {
      return true;
    }

    return false;
  }

  private aggregateFrames(): Float32Array {
    const totalLength = this.frameBuffer.reduce(
      (sum, frame) => sum + frame.length,
      0,
    );
    const aggregated = new Float32Array(totalLength);
    let offset = 0;
    for (const frame of this.frameBuffer) {
      aggregated.set(frame, offset);
      offset += frame.length;
    }
    return aggregated;
  }

  async dispose(): Promise<void> {
    this.client.dispose();
    this.reset();
  }
}
