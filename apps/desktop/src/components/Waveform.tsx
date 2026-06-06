import React from "react";
import { motion } from "framer-motion";

interface WaveformProps {
  index: number;
  isRecording: boolean;
  voiceDetected: boolean;
  baseHeight?: number;
  silentHeight?: number;
  color?: string;
}

export function Waveform({
  index,
  isRecording,
  voiceDetected,
  baseHeight = 20,
  silentHeight = 20,
  color = "#FFFFFF",
}: WaveformProps) {
  // Calculate animation values
  const minHeight = silentHeight;
  const maxHeight = baseHeight;
  const midHeight = minHeight + (maxHeight - minHeight) * 0.6;

  if (!isRecording) {
    return (
      <div
        className="h-[15%] w-1 rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  }

  return (
    <motion.div
      className="w-1 rounded-full gap-0.5"
      style={{ height: `${silentHeight}%`, backgroundColor: color }}
      animate={{
        height: voiceDetected
          ? [
              `${midHeight}%`,
              `${maxHeight}%`,
              `${midHeight}%`,
              `${minHeight + 5}%`,
              `${midHeight}%`,
            ]
          : `${silentHeight}%`,
      }}
      transition={{
        duration: voiceDetected ? 0.8 : 0.3,
        ease: "easeInOut",
        repeat: voiceDetected ? Number.POSITIVE_INFINITY : 0,
        repeatType: "loop",
        delay: index * 0.06,
        type: "tween",
      }}
    />
  );
}
