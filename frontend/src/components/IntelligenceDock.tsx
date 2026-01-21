"use client";
import { useCallback, useEffect, useState } from "react";
import {
  useConnectionState,
  useRoomContext,
  useLocalParticipant,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { motion, AnimatePresence } from "framer-motion";

type AIState = 'idle' | 'listening' | 'speaking' | 'connecting' | 'thinking';

export function IntelligenceDock({ onReset }: { onReset: () => void }) {
  const connectionState = useConnectionState();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { state: agentState } = useVoiceAssistant();

  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [volume] = useState(0.1);

  // Map agent state to our UI state
  const aiState: AIState = (() => {
    if (connectionState !== ConnectionState.Connected) return 'connecting';
    if (agentState === 'speaking') return 'speaking';
    if (agentState === 'thinking') return 'thinking';
    if (agentState === 'listening') return 'listening';
    if (agentState === 'connecting' || agentState === 'initializing') return 'connecting';
    return 'connecting';
  })();

  // Track mic state
  useEffect(() => {
    if (localParticipant) {
      const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone);
      setIsMicEnabled(!micTrack?.isMuted);
    }
  }, [localParticipant]);

  // Toggle mic
  const handleToggleMic = useCallback(async () => {
    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
      setIsMicEnabled(!isMicEnabled);
    }
  }, [localParticipant, isMicEnabled]);

  // End session
  const handleEndSession = useCallback(async () => {
    try {
      await room.disconnect();
    } catch (e) {
      console.error("Error disconnecting:", e);
    }
    onReset();
  }, [room, onReset]);

  // Apple Intelligence colors - seamless conic gradient (start = end for smooth loop)
  const glowingBorder = "conic-gradient(from 0deg, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #8b5cf6, #3b82f6, #06b6d4)";

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center">

      {/* 1. THE ATMOSPHERE (Static, Soft Backlight) */}
      <motion.div
        animate={{ opacity: aiState === 'speaking' ? 0.5 : 0 }}
        transition={{ duration: 0.5 }}
        className="absolute inset-0 rounded-full blur-[40px]"
        style={{
          background: "linear-gradient(to top, #4f46e5, #ec4899)",
          width: "120%",
          height: "100%",
          left: "-10%",
        }}
      />

      {/* 2. THE MOVING BORDER (The "Rim Light") */}
      <motion.div
        animate={{ opacity: aiState === 'speaking' ? 1 : 0 }}
        className="absolute -inset-[2px] rounded-full blur-[2px] overflow-hidden"
      >
        <motion.div
          className="w-full h-full rounded-full"
          style={{ background: glowingBorder }}
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
      </motion.div>

      {/* 3. THE HARDWARE (The Black Pill) */}
      <div className="relative bg-black/90 backdrop-blur-3xl rounded-full px-3 py-3 flex items-center gap-5 shadow-2xl ring-1 ring-white/10">

        {/* --- ORB SECTION --- */}
        <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
          {aiState === 'speaking' ? (
            // The "Siri" Orb - Contained inside the circle
            <div className="w-full h-full rounded-full relative overflow-hidden ring-1 ring-white/10">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute inset-[-50%] opacity-80 blur-sm"
                style={{ background: glowingBorder }}
              />
              {/* Dark center to make it look like an eye/lens */}
              <div className="absolute inset-[15%] bg-black rounded-full" />
              {/* Top gloss */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent pointer-events-none" />
            </div>
          ) : aiState === 'thinking' ? (
            // THINKING STATE
            <motion.div
              animate={{ scale: [1, 1.1, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="w-10 h-10 rounded-full bg-purple-500/60"
            />
          ) : aiState === 'connecting' ? (
            // CONNECTING STATE
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-8 h-8 rounded-full bg-amber-500/50"
            />
          ) : (
            // Listening State (Simple Waveform)
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
              <div className="flex gap-1 h-3 items-center">
                {[1, 2, 3].map(i => (
                  <motion.div
                    key={i}
                    animate={{ height: [4, 8 + (volume * 15), 4] }}
                    transition={{ duration: 0.2, repeat: Infinity, delay: i * 0.1 }}
                    className="w-1 bg-white rounded-full"
                    style={{ boxShadow: "0 0 8px rgba(255,255,255,0.5)" }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* --- TEXT SECTION --- */}
        <div className="flex flex-col min-w-[110px]">
          <span className="text-[10px] font-bold text-gray-500 tracking-[0.2em] uppercase mb-0.5">
            AI Tutor
          </span>
          <AnimatePresence mode="wait">
            <motion.span
              key={aiState}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className={`text-sm font-semibold truncate ${
                aiState === 'speaking'
                  ? 'text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-white to-purple-300'
                  : aiState === 'thinking'
                    ? 'text-purple-400'
                    : aiState === 'connecting'
                      ? 'text-amber-400'
                      : 'text-white'
              }`}
            >
              {aiState === 'speaking' ? "Speaking..." : aiState === 'thinking' ? "Thinking..." : aiState === 'connecting' ? "Connecting..." : "Listening"}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* --- CONTROLS --- */}
        <div className="flex items-center gap-3 pl-4 border-l border-white/10">
          {/* Mic Button */}
          <button
            onClick={handleToggleMic}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              isMicEnabled
                ? 'bg-white text-black'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              {isMicEnabled ? (
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
              ) : (
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
              )}
            </svg>
          </button>

          {/* Hangup Button */}
          <button
            onClick={handleEndSession}
            className="w-10 h-10 rounded-full bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white flex items-center justify-center transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
}
