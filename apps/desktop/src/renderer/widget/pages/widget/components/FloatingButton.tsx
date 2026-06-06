import React, { useState, useRef, useEffect } from "react";
import { NotebookPen, Square } from "lucide-react";
import { Waveform } from "@/components/Waveform";
import { useRecording } from "@/hooks/useRecording";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { api } from "@/trpc/react";
import { NOTE_WINDOW_FEATURE_FLAG } from "@/utils/feature-flags";
import { DEFAULT_WIDGET_APPEARANCE } from "@/constants/widget-appearance";
import { useTranslation } from "react-i18next";

const NUM_WAVEFORM_BARS = 6;
const DEBOUNCE_DELAY = 100;
const DRAG_THRESHOLD = 5;
const TOAST_INTERACTION_STATE_EVENT = "widget:toast-interaction-state";

// Separate component for the stop button
const StopButton: React.FC<{ onClick: (e: React.MouseEvent) => void }> = ({
  onClick,
}) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center w-[20px] h-[20px] rounded transition-colors"
    aria-label="Stop recording"
  >
    <Square className="w-[12px] h-[12px] text-red-500 fill-red-500" />
  </button>
);

// Separate component for the processing indicator
const ProcessingIndicator: React.FC<{ color: string }> = ({ color }) => (
  <div className="flex gap-[4px] items-center justify-center flex-1 h-6">
    <div
      className="w-[4px] h-[4px] rounded-full animate-bounce [animation-delay:-0.3s]"
      style={{ backgroundColor: color }}
    />
    <div
      className="w-[4px] h-[4px] rounded-full animate-bounce [animation-delay:-0.15s]"
      style={{ backgroundColor: color }}
    />
    <div
      className="w-[4px] h-[4px] rounded-full animate-bounce"
      style={{ backgroundColor: color }}
    />
  </div>
);

// Separate component for the waveform visualization
const WaveformVisualization: React.FC<{
  isRecording: boolean;
  voiceDetected: boolean;
  color: string;
}> = ({ isRecording, voiceDetected, color }) => (
  <>
    {Array.from({ length: NUM_WAVEFORM_BARS }).map((_, index) => (
      <Waveform
        key={index}
        index={index}
        isRecording={isRecording}
        voiceDetected={voiceDetected}
        baseHeight={60}
        silentHeight={20}
        color={color}
      />
    ))}
  </>
);

export const FloatingButton: React.FC = () => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const appearanceQuery = api.settings.getWidgetAppearance.useQuery();
  const appearance = appearanceQuery.data ?? DEFAULT_WIDGET_APPEARANCE;
  const [isHovered, setIsHovered] = useState(false);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for debounce timeout
  const clickTimeRef = useRef<number | null>(null); // Track when user clicked
  const hasActiveToastRef = useRef(false);

  const setIgnoreMouseEvents = api.widget.setIgnoreMouseEvents.useMutation();
  const openNotesWindow = api.widget.openNotesWindow.useMutation();
  const startDragMutation = api.widget.startDrag.useMutation();
  const endDragMutation = api.widget.endDrag.useMutation();
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ screenX: number; screenY: number } | null>(null);
  const justDraggedRef = useRef(false);
  const noteWindowFeatureFlag = useFeatureFlag(NOTE_WINDOW_FEATURE_FLAG);

  // Log component initialization
  useEffect(() => {
    console.log("FloatingButton component initialized");

    const handleToastInteractionState = (event: Event) => {
      const customEvent = event as CustomEvent<{ active: boolean }>;
      hasActiveToastRef.current = !!customEvent.detail?.active;
    };

    window.addEventListener(
      TOAST_INTERACTION_STATE_EVENT,
      handleToastInteractionState,
    );

    return () => {
      window.removeEventListener(
        TOAST_INTERACTION_STATE_EVENT,
        handleToastInteractionState,
      );
      console.debug("FloatingButton component unmounting");
    };
  }, []);

  // Repaint immediately when the user changes HUD colors in settings.
  useEffect(() => {
    const handler = () => {
      utils.settings.getWidgetAppearance.invalidate();
    };
    window.electronAPI?.on?.("widget:appearance-changed", handler);
    return () => {
      window.electronAPI?.off?.("widget:appearance-changed", handler);
    };
  }, [utils]);

  const { recordingStatus, stopRecording, voiceDetected, startRecording } =
    useRecording();
  // STARTING is a brief handshake before renderer capture begins; keep the
  // widget expanded and waveform-shaped like the pre-FSM flow.
  const isRecording =
    recordingStatus.state === "recording" ||
    recordingStatus.state === "starting";
  const isStopping = recordingStatus.state === "stopping";
  const isHandsFreeMode = recordingStatus.mode === "hands-free";
  const isNoteWindowEnabled = noteWindowFeatureFlag.enabled;

  // Track when recording state changes to "recording" after a click
  useEffect(() => {
    if (recordingStatus.state === "recording" && clickTimeRef.current) {
      const timeSinceClick = performance.now() - clickTimeRef.current;
      console.log(
        `FAB: Recording state became 'recording' ${timeSinceClick.toFixed(2)}ms after user click`,
      );
      clickTimeRef.current = null; // Reset
    }
  }, [recordingStatus.state]);

  // Handler for widget click to start recording in hands-free mode
  const handleButtonClick = async (e: React.MouseEvent) => {
    if (justDraggedRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const clickTime = performance.now();
    clickTimeRef.current = clickTime;
    console.log("FAB: Button clicked at", clickTime);
    console.log("FAB: Current status:", recordingStatus);

    if (recordingStatus.state === "idle") {
      const startRecordingCallTime = performance.now();
      await startRecording();
      const startRecordingReturnTime = performance.now();
      console.log(
        `FAB: startRecording() call took ${(startRecordingReturnTime - startRecordingCallTime).toFixed(2)}ms to return`,
      );
      console.log("FAB: Started hands-free recording");
    } else {
      console.log("FAB: Already recording, ignoring click");
      clickTimeRef.current = null; // Reset since we're not starting
    }
  };

  // Handler for stop button in hands-free mode
  const handleStopClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("FAB: Stopping hands-free recording");
    await stopRecording();
  };

  const handleOpenNotesClick = async (e: React.MouseEvent) => {
    if (justDraggedRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isNoteWindowEnabled) {
      return;
    }
    try {
      await openNotesWindow.mutateAsync();
    } catch (error) {
      console.error("Failed to open notes window widget", error);
    }
  };

  const handleMouseLeave = async () => {
    if (isDraggingRef.current) return;
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    leaveTimeoutRef.current = setTimeout(async () => {
      setIsHovered(false);
      if (hasActiveToastRef.current) {
        console.debug(
          "Skipped re-enabling mouse pass-through while toast is active",
        );
        return;
      }
      // Re-enable mouse event forwarding when not hovering
      try {
        await setIgnoreMouseEvents.mutateAsync({ ignore: true });
        console.debug("Re-enabled mouse event forwarding");
      } catch (error) {
        console.error("Failed to re-enable mouse event forwarding:", error);
      }
    }, DEBOUNCE_DELAY);
  };

  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragStartRef.current = { screenX: e.screenX, screenY: e.screenY };

    const onMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = ev.screenX - dragStartRef.current.screenX;
      const dy = ev.screenY - dragStartRef.current.screenY;
      if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        startDragMutation.mutate({
          screenX: dragStartRef.current.screenX,
          screenY: dragStartRef.current.screenY,
        });
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (isDraggingRef.current) {
        endDragMutation.mutate();
        isDraggingRef.current = false;
        justDraggedRef.current = true;
        if (leaveTimeoutRef.current) {
          clearTimeout(leaveTimeoutRef.current);
          leaveTimeoutRef.current = null;
        }
        if (isRecording || isStopping) {
          // Keep widget interactive so stop button remains usable
        } else {
          setIsHovered(false);
          setIgnoreMouseEvents.mutate({ ignore: true });
        }
        setTimeout(() => { justDraggedRef.current = false; }, 150);
      }
      dragStartRef.current = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleMouseEnter = async () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsHovered(true);
    // Disable mouse event forwarding to make widget clickable
    await setIgnoreMouseEvents.mutateAsync({ ignore: false });
    console.debug("Disabled mouse event forwarding for clicking");
  };

  const isWidgetActive = isRecording || isStopping || isHovered;
  const showNotesAction =
    isNoteWindowEnabled && isHovered && !isRecording && !isStopping;
  const sizeClass = !isWidgetActive
    ? "h-[8px] w-[48px]"
    : showNotesAction
      ? "h-[24px] w-[124px]"
      : "h-[24px] w-[96px]";

  // Function to render widget content based on state
  const renderWidgetContent = () => {
    if (!isWidgetActive) return null;

    // Show processing indicator when stopping.
    if (isStopping) {
      return <ProcessingIndicator color={appearance.accent} />;
    }

    // Show waveform with stop button when in hands-free mode and recording
    if (isHandsFreeMode && isRecording) {
      return (
        <>
          <div className="justify-center items-center flex flex-1 gap-1">
            <WaveformVisualization
              isRecording={isRecording}
              voiceDetected={voiceDetected}
              color={appearance.accent}
            />
          </div>
          <div className="h-full items-center flex mr-2">
            <StopButton onClick={handleStopClick} />
          </div>
        </>
      );
    }

    // Show waveform visualization for all other states
    return (
      <>
        <button
          className="justify-center items-center flex flex-1 gap-1 h-full"
          role="button"
          onClick={handleButtonClick}
        >
          <WaveformVisualization
            isRecording={isRecording}
            voiceDetected={voiceDetected}
            color={appearance.accent}
          />
        </button>

        {showNotesAction && (
          <button
            className="h-full px-2 flex items-center justify-center text-white/80 hover:text-white transition-colors"
            onClick={handleOpenNotesClick}
            aria-label={t("settings.notes.note.actions.openInNotesWindow")}
            title={t("settings.notes.note.actions.openInNotesWindow")}
          >
            <NotebookPen className="w-[14px] h-[14px]" />
          </button>
        )}
      </>
    );
  };

  return (
    <div
      onMouseDown={handleDragMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        transition-all duration-200 ease-in-out
        ${sizeClass}
        rounded-[24px] backdrop-blur-md
        before:content-[''] before:absolute before:inset-[1px] before:rounded-[23px] before:outline before:outline-white/15 before:pointer-events-none
        mb-2 cursor-pointer select-none
      `}
      style={{
        pointerEvents: "auto",
        background: appearance.background,
        boxShadow: `0 0 0 1px ${appearance.border}, 0px 0px 15px 0px rgba(0,0,0,0.40)`,
      }}
    >
      {isWidgetActive && (
        <div className="flex gap-[2px] h-full w-full justify-between">
          {renderWidgetContent()}
        </div>
      )}
    </div>
  );
};
