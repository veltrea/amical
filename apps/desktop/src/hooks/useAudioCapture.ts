import { useRef, useEffect, useState, useCallback } from "react";
import audioWorkletUrl from "@/assets/audio-recorder-processor.js?url";
import { api } from "@/trpc/react";
import { Mutex } from "async-mutex";
import { AudioCaptureEngine } from "./audio-capture-engine";

// Audio configuration
const SAMPLE_RATE = 16000;

export interface UseAudioCaptureParams {
  onAudioChunk: (
    arrayBuffer: ArrayBuffer,
    speechProbability: number,
    isFinalChunk: boolean,
  ) => Promise<void> | void;
  enabled: boolean;
}

export interface UseAudioCaptureOutput {
  voiceDetected: boolean;
}

export const useAudioCapture = ({
  onAudioChunk,
  enabled,
}: UseAudioCaptureParams): UseAudioCaptureOutput => {
  const [voiceDetected, setVoiceDetected] = useState(false);
  const engineRef = useRef<AudioCaptureEngine | null>(null);
  const mutexRef = useRef(new Mutex());

  // Keep the latest chunk handler in a ref so the engine's frame callback always
  // invokes the current one without recreating the engine.
  const onAudioChunkRef = useRef(onAudioChunk);
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  // Subscribe to voice detection updates via tRPC
  api.recording.voiceDetectionUpdates.useSubscription(undefined, {
    enabled,
    onData: (detected: boolean) => {
      setVoiceDetected(detected);
    },
    onError: (err) => {
      console.error("Voice detection subscription error:", err);
    },
  });

  // Get user's preferred microphone from settings
  const { data: settings } = api.settings.getSettings.useQuery();
  const preferredMicrophoneName = settings?.recording?.preferredMicrophoneName;

  const startCapture = useCallback(async () => {
    await mutexRef.current.runExclusive(async () => {
      try {
        const overallStartTime = performance.now();
        console.log("AudioCapture: Starting audio capture");

        // Build audio constraints
        const audioConstraints: MediaTrackConstraints = {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        };

        // Add deviceId if user has a preference
        if (preferredMicrophoneName) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const preferredDevice = devices.find(
            (device) =>
              device.kind === "audioinput" &&
              device.label === preferredMicrophoneName,
          );
          if (preferredDevice) {
            audioConstraints.deviceId = { exact: preferredDevice.deviceId };
            console.log(
              "AudioCapture: Using preferred microphone:",
              preferredMicrophoneName,
            );
          }
        }

        // Lazily create the engine; it reuses one AudioContext across recordings.
        if (!engineRef.current) {
          engineRef.current = new AudioCaptureEngine({
            sampleRate: SAMPLE_RATE,
            workletUrl: audioWorkletUrl,
            onFrame: (arrayBuffer, isFinal) =>
              onAudioChunkRef.current(arrayBuffer, 0, isFinal),
          });
        }

        await engineRef.current.start(audioConstraints);

        const overallDuration = performance.now() - overallStartTime;
        console.log(
          `AudioCapture: Total startup took ${overallDuration.toFixed(2)}ms`,
        );
        console.log("AudioCapture: Audio capture started successfully");
      } catch (error) {
        console.error("AudioCapture: Failed to start capture:", error);
        throw error;
      }
    });
  }, [preferredMicrophoneName]);

  const stopCapture = useCallback(async () => {
    await mutexRef.current.runExclusive(async () => {
      try {
        console.log("AudioCapture: Stopping audio capture");
        await engineRef.current?.stop();
        console.log("AudioCapture: Audio capture stopped");
      } catch (error) {
        console.error("AudioCapture: Error during stop:", error);
        throw error;
      }
    });
  }, []);

  // Start/stop based on enabled state
  useEffect(() => {
    if (!enabled) {
      return;
    }

    startCapture().catch((error) => {
      console.error("AudioCapture: Failed to start:", error);
    });

    return () => {
      stopCapture().catch((error) => {
        console.error("AudioCapture: Failed to stop:", error);
      });
    };
  }, [enabled, startCapture, stopCapture]);

  // Release the AudioContext (and worklet) on unmount to free native resources.
  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      engineRef.current = null;
      void engine?.dispose();
    };
  }, []);

  return {
    voiceDetected,
  };
};
