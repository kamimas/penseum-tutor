"use client";
// =============================================================================
// GEMINI DIRECT - Production copy with LiveKit replaced by direct Gemini
// =============================================================================

import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { triggerToolCall } from "../../components/ExcalidrawToolHandler";
import { TutorCursor } from "../../components/TutorCursor";
import { LeftNavigation } from "../../components/LeftNavigation";

// Import Gemini client and audio from experiments
import { GeminiLiveClient, ConnectionState, ToolCall } from "../experiments/gemini-direct/lib/GeminiLiveClient";
import { AudioPlayback } from "../experiments/gemini-direct/lib/AudioPlayback";
import { AudioCapture } from "../experiments/gemini-direct/lib/AudioCapture";

// Import types for tool definitions
import {
  FunctionDeclaration,
  Type,
  Behavior,
  FunctionResponseScheduling,
} from "@google/genai";

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

// Dynamic import - Excalidraw doesn't support SSR
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <div style={{ padding: 40 }}>Loading canvas...</div> }
);

// =============================================================================
// GEMINI CONFIGURATION (matches tutor.py)
// =============================================================================

const SYSTEM_INSTRUCTION = `You are PAI, a tutor created by Penseum. S

IMPORTANT: SHOW, DON'T TELL. Always use draw() instead of explaining verbally. Visuals first, brief speech after.

RULES:
1. ONE draw() call per response - don't batch multiple draws
2. Never lie to the student - correct mistakes honestly
3. Keep speech brief between tool calls
4. Include speed hints in draw() based on how long you'll talk:
   - "quick" = you'll say 1-2 sentences (fast diagram/text)
   - No hint = you'll say a few sentences (image or diagram)
   - "show how" / "demonstrate" = core concept worth waiting for (animation)

TOOLS:
- draw(query) - Describe what to show. Add speed hints: "quick X", "show how X works", "photo of X"
- clear_board() - Clear when switching topics

VISION:
You can see the student's screen. Reference what you see when relevant. When content is already on the board, prefer annotating it over adding new content.

GOOD EXAMPLES:

Student: "Teach me about the heart"
draw("the heart")
"This is the heart with its four chambers."

Student: "How does the heart pump blood?"
draw("show how the heart beats")
"Watch it contract - the left side pumps to your body, the right to your lungs."

Student: "What are the steps of photosynthesis?"
draw("quick steps of photosynthesis")
"Sunlight, water, CO2 in - glucose and oxygen out."

Student: "What does a platypus look like?"
draw("photo of a platypus")
"Notice the duck-like bill and beaver tail."

Student: [Board shows a cell diagram] "Where's the mitochondria?"
draw("circle the mitochondria")
"Right here - it's the powerhouse of the cell."

Student: "Explain gravity"
draw("demonstrate gravity with a falling ball")
"See how it speeds up as it falls? That's acceleration due to gravity."

BAD EXAMPLES - Don't do this:

Student: "Explain photosynthesis"
"Photosynthesis is when plants convert sunlight into energy using chlorophyll..."
[Wrong: Too much talking, no visuals]

Student: "Teach me about the heart"
draw("the heart")
draw("circle the left ventricle")
draw("blood flow animation")
[Wrong: Multiple draws in one response - do ONE at a time]

Student: "What is the heart?"
draw("the heart")
"The heart has four chambers. The right atrium receives deoxygenated blood..."
[Wrong: Wall of text - keep it brief]

`;

const DRAW_TOOL: FunctionDeclaration = {
  name: "draw",
  description:
    "Draw visuals on the whiteboard. USE THIS for any visual content: text, images, diagrams. Also use this to annotate/circle/highlight things on the whiteboard.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Natural language description of what to show',
      },
    },
    required: ["query"],
  },
  behavior: Behavior.NON_BLOCKING,
};

const CLEAR_BOARD_TOOL: FunctionDeclaration = {
  name: "clear_board",
  description: "Clear the whiteboard. USE THIS when switching to a new topic or when the board is cluttered.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
  behavior: Behavior.NON_BLOCKING,
};

// =============================================================================
// CANVAS CAPTURE (same as production ExcalidrawToolHandler)
// =============================================================================

function captureCanvas(): string | null {
  try {
    const canvas = document.querySelector(".excalidraw__canvas") as HTMLCanvasElement;
    if (!canvas) return null;
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } catch (e) {
    return null;
  }
}

// =============================================================================
// MINIMAL TOOLBAR (same as production)
// =============================================================================

function MinimalToolbar({ excalidrawAPI, isMobile }: { excalidrawAPI: any; isMobile: boolean }) {
  const [activeTool, setActiveTool] = useState<string>("freedraw");

  const tools = [
    { id: "freedraw", label: "Draw", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        <path d="m15 5 4 4"/>
      </svg>
    )},
    { id: "text", label: "Text", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 7 4 4 20 4 20 7"/>
        <line x1="9" y1="20" x2="15" y2="20"/>
        <line x1="12" y1="4" x2="12" y2="20"/>
      </svg>
    )},
    { id: "image", label: "Image", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    )},
    { id: "eraser", label: "Eraser", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
        <path d="M22 21H7"/>
        <path d="m5 11 9 9"/>
      </svg>
    )},
  ];

  const handleToolClick = (toolId: string) => {
    if (!excalidrawAPI) return;
    setActiveTool(toolId);
    excalidrawAPI.setActiveTool({ type: toolId });
  };

  if (!excalidrawAPI) return null;

  if (isMobile) {
    return (
      <div style={{ position: "fixed", right: 16, bottom: 100, display: "flex", flexDirection: "column", gap: 8, background: "#FAF9F7", borderRadius: 16, padding: "10px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", border: "1px solid #E8E4DE", zIndex: 100 }}>
        {tools.map((tool) => (
          <button key={tool.id} onClick={() => handleToolClick(tool.id)} title={tool.label} style={{ width: 44, height: 44, borderRadius: 12, border: activeTool === tool.id ? "1px solid #E2DAFB" : "1px solid transparent", background: activeTool === tool.id ? "#F1EDFD" : "transparent", color: activeTool === tool.id ? "#6F47EB" : "#999", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {tool.icon}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, background: "#FAF9F7", borderRadius: 20, padding: "8px 12px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", border: "1px solid #E8E4DE", zIndex: 100 }}>
      {tools.map((tool) => (
        <button key={tool.id} onClick={() => handleToolClick(tool.id)} title={tool.label} style={{ width: 36, height: 36, borderRadius: 12, border: activeTool === tool.id ? "1px solid #E2DAFB" : "1px solid transparent", background: activeTool === tool.id ? "#F1EDFD" : "transparent", color: activeTool === tool.id ? "#6F47EB" : "#999", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {tool.icon}
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// GEMINI CHAT PILL (matches production ChatPill visual design)
// =============================================================================

type AIState = "idle" | "listening" | "speaking" | "connecting" | "thinking";

interface DisplayMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
}

interface GeminiChatPillProps {
  connectionState: ConnectionState;
  isMicEnabled: boolean;
  onToggleMic: () => void;
  onEndSession: () => void;
  aiState: AIState;
  isMobile: boolean;
  messageHistory: DisplayMessage[];
}

// Message bubble component with Framer Motion animations
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

function GeminiChatPill({ connectionState, isMicEnabled, onToggleMic, onEndSession, aiState, isMobile, messageHistory }: GeminiChatPillProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(() => messageHistory.slice(-4), [messageHistory]);
  const latestMessage = useMemo(() => messageHistory[messageHistory.length - 1] || null, [messageHistory]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [visibleMessages]);

  const statusText = (() => {
    if (connectionState === "connecting") return "Connecting...";
    if (connectionState === "disconnected") return "Disconnected";
    if (connectionState === "error") return "Error";
    switch (aiState) {
      case "speaking": return "Speaking";
      case "thinking": return "Thinking";
      case "listening": return "Listening";
      default: return "Ready";
    }
  })();

  const statusColor = connectionState !== "connected" ? "#E5A853" : aiState === "speaking" ? "#9D7CD8" : "#7EC699";

  // ===========================================
  // MOBILE LAYOUT - Bottom bar
  // ===========================================
  if (isMobile) {
    return (
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
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
              <div style={{
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
              }}>
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
              <button onClick={onToggleMic} disabled={connectionState !== "connected"} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #E8E4DE", background: isMicEnabled ? "#FAF9F7" : "#EDE9E3", display: "flex", alignItems: "center", justifyContent: "center", cursor: connectionState === "connected" ? "pointer" : "not-allowed", opacity: connectionState === "connected" ? 1 : 0.5 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill={isMicEnabled ? "#4A4A4A" : "#999"}>
                  {isMicEnabled ? (
                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                  ) : (
                    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                  )}
                </svg>
              </button>

              <button onClick={onEndSession} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #E8E4DE", background: "#FAF9F7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#999"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================
  // DESKTOP LAYOUT - Right side panel (matches ChatPill)
  // ===========================================
  return (
    <div className="fixed right-6 top-1/2 -translate-y-1/2 z-[1000] flex flex-col" style={{ width: 320 }}>
      <div style={{ background: "#FAF9F7", border: "1px solid #E8E4DE", borderRadius: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.08)", overflow: "hidden", position: "relative" }}>
        {/* End Session Button */}
        <button onClick={onEndSession} className="absolute top-3 right-3 transition-all hover:scale-110 active:scale-95 hover:bg-red-50" style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #E8E4DE", background: "#FAF9F7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10 }} title="End session">
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
            <button onClick={onToggleMic} disabled={connectionState !== "connected"} className="transition-all hover:scale-105 active:scale-95" style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid #E8E4DE", background: isMicEnabled ? "#FAF9F7" : "#EDE9E3", display: "flex", alignItems: "center", justifyContent: "center", cursor: connectionState === "connected" ? "pointer" : "not-allowed", opacity: connectionState === "connected" ? 1 : 0.5 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={isMicEnabled ? "#4A4A4A" : "#999"}>
                {isMicEnabled ? (
                  <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                ) : (
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CANVAS STREAMER (sends frames to Gemini)
// =============================================================================

function GeminiCanvasStreamer({ excalidrawAPI, client, connectionState }: { excalidrawAPI: any; client: GeminiLiveClient | null; connectionState: ConnectionState }) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!excalidrawAPI || !client || connectionState !== "connected") {
      return;
    }

    const captureAndSend = () => {
      try {
        const canvas = document.querySelector(".excalidraw__canvas") as HTMLCanvasElement;
        if (!canvas) return;

        // Create a smaller canvas for streaming (max 1024px)
        const maxDim = 1024;
        let width = canvas.width;
        let height = canvas.height;

        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const streamCanvas = document.createElement("canvas");
        streamCanvas.width = width;
        streamCanvas.height = height;
        const ctx = streamCanvas.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(canvas, 0, 0, width, height);

        // Convert to JPEG base64
        const dataUrl = streamCanvas.toDataURL("image/jpeg", 0.7);
        const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
        client.sendImage(base64);
      } catch (e) {
        // Silent fail
      }
    };

    // Stream at 1 FPS
    intervalRef.current = setInterval(captureAndSend, 1000);
    captureAndSend();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [excalidrawAPI, client, connectionState]);

  return null;
}

// =============================================================================
// MAIN ROOM COMPONENT
// =============================================================================

function GeminiRoom({ onReset }: { onReset: () => void }) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [aiState, setAiState] = useState<AIState>("idle");
  const [messageHistory, setMessageHistory] = useState<DisplayMessage[]>([]);
  const isMobile = useIsMobile();

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const excalidrawAPIRef = useRef<any>(null);

  // Track current turn's message IDs for updating in-progress transcriptions
  const currentUserMsgIdRef = useRef<string | null>(null);
  const currentAiMsgIdRef = useRef<string | null>(null);
  const turnCounterRef = useRef(0);

  // Keep ref in sync
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  // Handle draw tool call
  const handleDrawToolCall = useCallback(async (query: string, toolCallId: string) => {
    // Send tool response IMMEDIATELY to prevent Gemini from retrying
    clientRef.current?.sendToolResponse(toolCallId, "draw", "Done.", FunctionResponseScheduling.SILENT);

    const screenshot = captureCanvas();

    try {
      const response = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, screenshot }),
      });

      if (!response.ok) return;

      const data = await response.json();

      // Execute each tool call on Excalidraw
      if (data.toolCalls && Array.isArray(data.toolCalls) && excalidrawAPIRef.current) {
        for (const toolCall of data.toolCalls) {
          triggerToolCall(excalidrawAPIRef.current, toolCall.tool, toolCall.params);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    } catch (err) {
      // Silent fail
    }
  }, []);

  // Handle clear_board tool call
  const handleClearBoardToolCall = useCallback((toolCallId: string) => {
    if (excalidrawAPIRef.current) {
      excalidrawAPIRef.current.resetScene();
    }
    clientRef.current?.sendToolResponse(toolCallId, "clear_board", "Done.", FunctionResponseScheduling.SILENT);
  }, []);

  // Connect to Gemini on mount
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) return;

    const connect = async () => {
      // Initialize audio playback
      audioPlaybackRef.current = new AudioPlayback();
      await audioPlaybackRef.current.resume();

      // Create Gemini client
      const client = new GeminiLiveClient({
        apiKey,
        tools: [DRAW_TOOL, CLEAR_BOARD_TOOL],
        systemInstruction: SYSTEM_INSTRUCTION,
      });
      clientRef.current = client;

      // Set up event handlers
      client.on("stateChange", setConnectionState);

      client.on("setupComplete", () => {
        setAiState("listening");
      });

      client.on("audio", (buffer) => {
        audioPlaybackRef.current?.addPCM16(buffer);
        setAiState("speaking");
      });

      client.on("toolCall", (toolCalls: ToolCall[]) => {
        setAiState("thinking");
        for (const tc of toolCalls) {
          if (tc.name === "draw" && tc.args.query) {
            handleDrawToolCall(tc.args.query as string, tc.id);
          } else if (tc.name === "clear_board") {
            handleClearBoardToolCall(tc.id);
          }
        }
      });

      client.on("turnComplete", () => {
        setAiState("listening");
        currentUserMsgIdRef.current = null;
        currentAiMsgIdRef.current = null;
        turnCounterRef.current += 1;
      });

      client.on("interrupted", () => {
        audioPlaybackRef.current?.stop();
        setAiState("listening");
      });

      client.on("inputTranscription", (text) => {
        // Gemini sends incremental transcription chunks, so we append
        if (!currentUserMsgIdRef.current) {
          currentUserMsgIdRef.current = `user-${turnCounterRef.current}-${Date.now()}`;
          setMessageHistory((prev) => [
            ...prev,
            { id: currentUserMsgIdRef.current!, text, isUser: true, timestamp: Date.now() },
          ]);
        } else {
          setMessageHistory((prev) =>
            prev.map((msg) =>
              msg.id === currentUserMsgIdRef.current ? { ...msg, text: msg.text + text } : msg
            )
          );
        }
      });

      client.on("outputTranscription", (text) => {
        // Gemini sends incremental transcription chunks, so we append
        if (!currentAiMsgIdRef.current) {
          currentAiMsgIdRef.current = `ai-${turnCounterRef.current}-${Date.now()}`;
          setMessageHistory((prev) => [
            ...prev,
            { id: currentAiMsgIdRef.current!, text, isUser: false, timestamp: Date.now() },
          ]);
        } else {
          setMessageHistory((prev) =>
            prev.map((msg) =>
              msg.id === currentAiMsgIdRef.current ? { ...msg, text: msg.text + text } : msg
            )
          );
        }
      });

      client.on("error", () => {});

      // Connect
      await client.connect();
    };

    connect();

    return () => {
      clientRef.current?.disconnect();
      audioPlaybackRef.current?.stop();
      audioCaptureRef.current?.stop();
    };
  }, [handleDrawToolCall, handleClearBoardToolCall]);

  // Toggle microphone
  const handleToggleMic = useCallback(async () => {
    if (isMicEnabled) {
      audioCaptureRef.current?.stop();
      audioCaptureRef.current = null;
      setIsMicEnabled(false);
    } else {
      try {
        const capture = new AudioCapture();
        audioCaptureRef.current = capture;
        capture.on("data", (base64Audio) => {
          clientRef.current?.sendAudio(base64Audio);
        });
        await capture.start();
        setIsMicEnabled(true);
      } catch (err) {
        // Silent fail
      }
    }
  }, [isMicEnabled]);

  // End session
  const handleEndSession = useCallback(() => {
    clientRef.current?.disconnect();
    audioPlaybackRef.current?.stop();
    audioCaptureRef.current?.stop();
    onReset();
  }, [onReset]);

  return (
    <div style={{ width: "100vw", height: "100dvh" }}>
      {/* Hide Excalidraw UI */}
      <style>{`
        .excalidraw .App-menu,
        .excalidraw .App-menu_top__left,
        .excalidraw .layer-ui__wrapper__footer-left,
        .excalidraw .layer-ui__wrapper__footer-right,
        .excalidraw .HelpButton,
        .excalidraw .zoom-actions,
        .excalidraw .undo-redo-buttons,
        .excalidraw .library-button,
        .excalidraw .App-toolbar__extra-tools-trigger,
        .excalidraw [class*="dropdown-menu"],
        .excalidraw .main-menu-trigger,
        .excalidraw .App-toolbar-container {
          display: none !important;
        }
      `}</style>

      {/* Mobile logo */}
      {isMobile && (
        <div style={{ position: "fixed", top: 16, left: 16, zIndex: 100 }}>
          <img src="/penseum_logo.svg" alt="Penseum" style={{ width: 40, height: 40 }} />
        </div>
      )}

      {/* Excalidraw */}
      <Excalidraw
        excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
        isCollaborating={true}
        UIOptions={{
          canvasActions: { loadScene: false, export: false, saveAsImage: false, saveToActiveFile: false, toggleTheme: false, clearCanvas: false },
          tools: { image: true },
        }}
        renderTopRightUI={() => null}
      />

      {/* Toolbar */}
      <MinimalToolbar excalidrawAPI={excalidrawAPI} isMobile={isMobile} />

      {/* Stream canvas to Gemini */}
      {excalidrawAPI && clientRef.current && (
        <GeminiCanvasStreamer excalidrawAPI={excalidrawAPI} client={clientRef.current} connectionState={connectionState} />
      )}

      {/* Tutor cursor */}
      {excalidrawAPI && <TutorCursor excalidrawAPI={excalidrawAPI} />}

      {/* Chat controls */}
      <GeminiChatPill
        connectionState={connectionState}
        isMicEnabled={isMicEnabled}
        onToggleMic={handleToggleMic}
        onEndSession={handleEndSession}
        aiState={aiState}
        isMobile={isMobile}
        messageHistory={messageHistory}
      />

      {/* Left nav (desktop) */}
      <LeftNavigation />
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function GeminiDirectPage() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100dvh", padding: 20, background: "#FAF9F7", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8, color: "#1a1a1a" }}>
          Gemini Direct
        </h1>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 32, textAlign: "center", maxWidth: 400 }}>
          Experimental: Direct browser-to-Gemini connection (no LiveKit)
        </p>

        <button
          onClick={() => setStarted(true)}
          style={{
            padding: "16px 32px",
            borderRadius: 12,
            border: "none",
            background: "#6F47EB",
            color: "white",
            fontSize: 16,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Start Session
        </button>

        <div style={{ marginTop: 40, padding: 20, background: "#fff", borderRadius: 12, border: "1px solid #E8E4DE", maxWidth: 400 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>What to test:</h3>
          <ul style={{ fontSize: 13, color: "#666", lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
            <li>Voice conversation (click mic after connecting)</li>
            <li>Say &quot;teach me about photosynthesis&quot;</li>
            <li>The draw() tool should trigger and render on canvas</li>
            <li>Canvas is streamed to Gemini at 1 FPS</li>
          </ul>
        </div>
      </div>
    );
  }

  return <GeminiRoom onReset={() => setStarted(false)} />;
}
