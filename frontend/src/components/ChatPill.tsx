"use client";
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import {
  useConnectionState,
  useRoomContext,
  useLocalParticipant,
  useVoiceAssistant,
  useTranscriptions,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { motion, AnimatePresence } from "framer-motion";

// ===========================================
// TYPES
// ===========================================

type AIState = "idle" | "listening" | "speaking" | "connecting" | "thinking";

interface ChatPillProps {
  onReset: () => void;
  isMobile?: boolean;
}

interface DisplayMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
}

// ===========================================
// MESSAGE COMPONENT (Desktop only)
// ===========================================

function MessageBubble({
  message,
  index,
  total,
}: {
  message: DisplayMessage;
  index: number;
  total: number;
}) {
  const position = total - index;
  const opacity = Math.max(0.3, 1 - (position - 1) * 0.25);

  if (message.isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.95 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex justify-end"
      >
        <div
          style={{
            background: "#EDE9E3",
            borderRadius: 16,
            padding: "10px 14px",
            maxWidth: "85%",
            color: "#4A4A4A",
            fontSize: 14,
            lineHeight: 1.4,
          }}
        >
          {message.text}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      style={{
        color: "#4A4A4A",
        fontSize: 14,
        lineHeight: 1.5,
        paddingRight: 20,
      }}
    >
      {message.text}
    </motion.div>
  );
}

// ===========================================
// COMPONENT
// ===========================================

export function ChatPill({ onReset, isMobile = false }: ChatPillProps) {
  const connectionState = useConnectionState();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { state: agentState } = useVoiceAssistant();
  const allTranscriptions = useTranscriptions();

  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [messageHistory, setMessageHistory] = useState<DisplayMessage[]>([]);
  const [currentSpeed, setCurrentSpeed] = useState<number>(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Process transcriptions
  useEffect(() => {
    if (!allTranscriptions || allTranscriptions.length === 0) return;

    const localIdentity = localParticipant?.identity;

    allTranscriptions.forEach((transcription) => {
      const streamId = transcription.streamInfo?.id;
      if (!streamId) return;
      if (!transcription.text || transcription.text.trim() === "") return;

      const isUser = transcription.participantInfo.identity === localIdentity;
      const id = `stream-${streamId}`;

      setMessageHistory((prev) => {
        const existingIndex = prev.findIndex((m) => m.id === id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            text: transcription.text,
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id,
              text: transcription.text,
              isUser,
              timestamp: Date.now(),
            },
          ];
        }
      });
    });
  }, [allTranscriptions, localParticipant?.identity]);

  const visibleMessages = useMemo(() => messageHistory.slice(-4), [messageHistory]);
  const latestMessage = useMemo(() => messageHistory[messageHistory.length - 1] || null, [messageHistory]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [visibleMessages]);

  const aiState: AIState = (() => {
    if (connectionState !== ConnectionState.Connected) return "connecting";
    if (agentState === "speaking") return "speaking";
    if (agentState === "thinking") return "thinking";
    if (agentState === "listening") return "listening";
    if (agentState === "connecting" || agentState === "initializing") return "connecting";
    return "idle";
  })();

  useEffect(() => {
    if (localParticipant) {
      const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone);
      setIsMicEnabled(!micTrack?.isMuted);
    }
  }, [localParticipant]);

  const handleToggleMic = useCallback(async () => {
    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
      setIsMicEnabled(!isMicEnabled);
    }
  }, [localParticipant, isMicEnabled]);

  const handleTogglePause = useCallback(() => {
    const audioElements = document.querySelectorAll("audio");
    audioElements.forEach((audio) => {
      if (isPaused) {
        audio.play();
      } else {
        audio.pause();
      }
    });
    setIsPaused(!isPaused);
  }, [isPaused]);

  const handleEndSession = useCallback(async () => {
    try {
      await room.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    onReset();
  }, [room, onReset]);

  const SPEED_OPTIONS = [1, 1.25, 1.5, 2];
  const handleCycleSpeed = useCallback(() => {
    const currentIndex = SPEED_OPTIONS.indexOf(currentSpeed);
    const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
    const newSpeed = SPEED_OPTIONS[nextIndex];
    setCurrentSpeed(newSpeed);

    const payload = JSON.stringify({ type: "set_speed", speed: newSpeed });
    room.localParticipant.publishData(new TextEncoder().encode(payload), {
      reliable: true,
      topic: "tutor_control",
    });
  }, [currentSpeed, room.localParticipant]);

  const statusText = (() => {
    if (isPaused) return "Paused";
    switch (aiState) {
      case "speaking": return "Speaking";
      case "thinking": return "Thinking";
      case "listening": return "Listening";
      case "connecting": return "Connecting";
      default: return "Ready";
    }
  })();

  const statusColor =
    aiState === "connecting" ? "#E5A853" : aiState === "speaking" ? "#9D7CD8" : "#7EC699";

  // ===========================================
  // MOBILE LAYOUT - Bottom bar
  // ===========================================
  if (isMobile) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Single line transcription */}
        <AnimatePresence>
          {latestMessage && (
            <motion.div
              key={latestMessage.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              style={{ padding: "0 20px 8px", textAlign: "center" }}
            >
              <div
                style={{
                  display: "inline-block",
                  maxWidth: "80%",
                  padding: "8px 16px",
                  background: latestMessage.isUser ? "rgba(237, 233, 227, 0.9)" : "rgba(250, 249, 247, 0.9)",
                  borderRadius: 16,
                  fontSize: 14,
                  color: "#4A4A4A",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  backdropFilter: "blur(8px)",
                }}
              >
                {latestMessage.text}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom bar */}
        <div style={{ background: "#FAF9F7", borderTop: "1px solid #E8E4DE", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 500, margin: "0 auto", gap: 12 }}>
            {/* Status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 90 }}>
              <motion.div
                animate={{ scale: aiState === "speaking" ? [1, 1.3, 1] : 1 }}
                transition={{ duration: 0.8, repeat: aiState === "speaking" ? Infinity : 0 }}
                style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor }}
              />
              <span style={{ fontSize: 13, color: "#6B6B6B" }}>{statusText}</span>
            </div>

            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={handleToggleMic} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #E8E4DE", background: isMicEnabled ? "#FAF9F7" : "#EDE9E3", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill={isMicEnabled ? "#4A4A4A" : "#999"}>
                  {isMicEnabled ? (
                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                  ) : (
                    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                  )}
                </svg>
              </button>

              <button onClick={handleTogglePause} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: isPaused ? "#7EC699" : "#9D7CD8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title={isPaused ? "Resume" : "Pause"}>
                {isPaused ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                )}
              </button>

              <button onClick={handleCycleSpeed} style={{ fontSize: 12, fontWeight: 600, color: "#4A4A4A", padding: "8px 12px", background: "#EDE9E3", borderRadius: 18, border: "1px solid #D4D0C8", cursor: "pointer", minWidth: 42 }} title="Change playback speed">
                {currentSpeed}x
              </button>

              <button onClick={handleEndSession} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #E8E4DE", background: "#FAF9F7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="End session">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#999"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================
  // DESKTOP LAYOUT - Right side panel
  // ===========================================
  return (
    <div
      className="fixed right-6 top-1/2 -translate-y-1/2 z-[1000] flex flex-col"
      style={{ width: 320 }}
    >
      <div
        style={{
          background: "#FAF9F7",
          border: "1px solid #E8E4DE",
          borderRadius: 24,
          boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* End Session Button */}
        <button
          onClick={handleEndSession}
          className="absolute top-3 right-3 transition-all hover:scale-110 active:scale-95 hover:bg-red-50"
          style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #E8E4DE", background: "#FAF9F7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10 }}
          title="End session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#999"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>

        {/* Message Area */}
        <div style={{ padding: "20px 20px 16px", minHeight: 200, maxHeight: 300, position: "relative", overflowY: "auto", overflowX: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 40, background: "linear-gradient(to bottom, #FAF9F7 0%, transparent 100%)", pointerEvents: "none", zIndex: 1 }} />
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {visibleMessages.length === 0 ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} style={{ color: "#999", fontSize: 14, textAlign: "center", paddingTop: 60 }}>
                  Start speaking to begin...
                </motion.div>
              ) : (
                visibleMessages.map((msg, index) => (
                  <MessageBubble key={msg.id} message={msg} index={index} total={visibleMessages.length} />
                ))
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div style={{ height: 1, background: "#E8E4DE", margin: "0 20px" }} />

        {/* Status + Controls */}
        <div style={{ padding: "16px 20px 20px" }}>
          <div className="flex items-center justify-center gap-2 mb-4" style={{ color: "#6B6B6B", fontSize: 13 }}>
            <motion.div
              animate={{ scale: aiState === "speaking" ? [1, 1.2, 1] : 1 }}
              transition={{ duration: 1, repeat: aiState === "speaking" ? Infinity : 0 }}
              style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor }}
            />
            <span>{statusText}</span>
          </div>

          {/* Audio Visualizer Dots */}
          <div className="flex justify-center gap-1 mb-4">
            {Array.from({ length: 20 }).map((_, i) => (
              <motion.div
                key={i}
                animate={{ opacity: aiState === "speaking" ? [0.4, 0.8, 0.4] : 0.5, scale: aiState === "speaking" ? [1, 1.2, 1] : 1 }}
                transition={{ duration: 0.5, repeat: aiState === "speaking" ? Infinity : 0, delay: i * 0.05 }}
                style={{ width: 4, height: 4, borderRadius: "50%", background: aiState === "speaking" ? "#9D7CD8" : "#D4D0C8" }}
              />
            ))}
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-center gap-4">
            <button onClick={handleToggleMic} className="transition-all hover:scale-105 active:scale-95" style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid #E8E4DE", background: isMicEnabled ? "#FAF9F7" : "#EDE9E3", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={isMicEnabled ? "#4A4A4A" : "#999"}>
                {isMicEnabled ? (
                  <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                ) : (
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                )}
              </svg>
            </button>

            <button onClick={handleTogglePause} className="transition-all hover:scale-105 active:scale-95" style={{ width: 52, height: 52, borderRadius: "50%", border: "none", background: isPaused ? "#7EC699" : "#9D7CD8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title={isPaused ? "Resume" : "Pause"}>
              {isPaused ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              )}
            </button>

            <button onClick={handleCycleSpeed} className="transition-all hover:scale-105 active:scale-95" style={{ fontSize: 13, fontWeight: 600, color: "#4A4A4A", padding: "8px 14px", background: "#EDE9E3", borderRadius: 16, border: "1px solid #D4D0C8", cursor: "pointer", minWidth: 52 }} title="Change playback speed">
              {currentSpeed}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
