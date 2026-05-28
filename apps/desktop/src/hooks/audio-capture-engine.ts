/**
 * Manages the Web Audio lifecycle for microphone capture, decoupled from React.
 *
 * The AudioContext (and its loaded worklet module) is reused across start/stop
 * cycles and only released on dispose(). Recreating it per recording leaks
 * native audio resources and eventually trips the browser's concurrent-
 * AudioContext limit, which breaks recording (and therefore transcription) in
 * long sessions. This class is driven directly by the long-session stress
 * harness so the reuse/cleanup behavior is verifiable without React or a real
 * microphone.
 */
export interface AudioCaptureEngineOptions {
  sampleRate: number;
  /** URL of the AudioWorklet module that registers "audio-recorder-processor". */
  workletUrl: string;
  /** Called for each PCM frame produced by the worklet. */
  onFrame: (frame: ArrayBuffer, isFinal: boolean) => void | Promise<void>;
}

export class AudioCaptureEngine {
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private readonly options: AudioCaptureEngineOptions;

  constructor(options: AudioCaptureEngineOptions) {
    this.options = options;
  }

  /** True when a non-closed AudioContext is currently held (0 or 1 per engine). */
  get isContextAlive(): boolean {
    return this.audioContext !== null && this.audioContext.state !== "closed";
  }

  get contextState(): AudioContextState | null {
    return this.audioContext?.state ?? null;
  }

  async start(constraints: MediaTrackConstraints): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: constraints,
    });

    // A closed context cannot be reused; drop it so we recreate below.
    if (this.audioContext && this.audioContext.state === "closed") {
      this.audioContext = null;
    }

    if (!this.audioContext) {
      // First start: create the context and load the worklet once.
      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });
      await this.audioContext.audioWorklet.addModule(this.options.workletUrl);
    } else if (this.audioContext.state === "suspended") {
      // Reuse the existing context (no worklet reload needed).
      await this.audioContext.resume();
    }

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "audio-recorder-processor",
    );

    this.workletNode.port.onmessage = (event) => {
      if (event.data?.type !== "audioFrame") return;
      const frame = event.data.frame as Float32Array;
      const isFinal: boolean = event.data.isFinal || false;
      // The worklet always allocates a plain ArrayBuffer-backed Float32Array.
      const arrayBuffer = frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength,
      ) as ArrayBuffer;
      void this.options.onFrame(arrayBuffer, isFinal);
    };

    this.source.connect(this.workletNode);
  }

  async stop(): Promise<void> {
    // Flush any buffered audio so the worklet emits a final frame.
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "flush" });
    }

    if (this.source && this.workletNode) {
      this.source.disconnect(this.workletNode);
    }

    // Suspend (not close) to release the mic while keeping the context for reuse.
    if (this.audioContext && this.audioContext.state === "running") {
      await this.audioContext.suspend();
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    // Release per-recording nodes; the AudioContext is retained for reuse.
    this.source = null;
    this.workletNode = null;
    this.stream = null;
  }

  /** Fully release resources, including the reused AudioContext. */
  async dispose(): Promise<void> {
    await this.stop().catch(() => {});
    const ctx = this.audioContext;
    this.audioContext = null;
    if (ctx && ctx.state !== "closed") {
      await ctx.close().catch(() => {});
    }
  }
}
