"use client";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { ExcalidrawStreamer } from "../components/ExcalidrawStreamer";
import { ExcalidrawToolHandler, triggerToolCall } from "../components/ExcalidrawToolHandler";
import { ChatPill } from "../components/ChatPill";
import { TutorCursor } from "../components/TutorCursor";
import { LeftNavigation } from "../components/LeftNavigation";

// Dynamic import - Excalidraw doesn't support SSR
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <div style={{ padding: 40 }}>Loading canvas...</div> }
);

// Position options for testing
const POSITIONS = [
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
  "below-last", "right-of-last"
] as const;

// Minimal custom toolbar - matches ChatPill aesthetic
function MinimalToolbar({ excalidrawAPI }: { excalidrawAPI: any }) {
  const [activeTool, setActiveTool] = useState<string>("freedraw");

  const tools = [
    { id: "freedraw", label: "Draw", icon: (
      // Pencil/pen icon
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        <path d="m15 5 4 4"/>
      </svg>
    )},
    { id: "text", label: "Text", icon: (
      // Text icon
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 7 4 4 20 4 20 7"/>
        <line x1="9" y1="20" x2="15" y2="20"/>
        <line x1="12" y1="4" x2="12" y2="20"/>
      </svg>
    )},
    { id: "image", label: "Image", icon: (
      // Image icon
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    )},
    { id: "eraser", label: "Eraser", icon: (
      // Eraser icon
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

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 6,
        background: "#FAF9F7",
        borderRadius: 20,
        padding: "8px 12px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
        border: "1px solid #E8E4DE",
        zIndex: 100,
      }}
    >
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => handleToolClick(tool.id)}
          title={tool.label}
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            border: activeTool === tool.id ? "1px solid #E2DAFB" : "1px solid transparent",
            background: activeTool === tool.id ? "#F1EDFD" : "transparent",
            color: activeTool === tool.id ? "#6F47EB" : "#999",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease",
          }}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}

// Debug Test Panel for manual tool testing
function DebugPanel({ excalidrawAPI }: { excalidrawAPI: any }) {
  const [showPanel, setShowPanel] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<string>("center");

  const testAddText = (content: string, size: "small" | "medium" | "large", position?: string) => {
    if (!excalidrawAPI) return;
    const pos = position || selectedPosition;
    triggerToolCall(excalidrawAPI, "add_text", { content, size, position: pos });
  };

  // Toggle with Cmd+D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        setShowPanel((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!showPanel) return null;

  const btnStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    cursor: "pointer",
    fontSize: 12,
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        width: 280,
        background: "white",
        borderRadius: 12,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        padding: 16,
        zIndex: 1001,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Position Test (Cmd+D to toggle)</div>

      {/* Position selector */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={selectedPosition}
          onChange={(e) => setSelectedPosition(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          {POSITIONS.map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
      </div>

      {/* Quick position grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginBottom: 8 }}>
        {["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"].map((pos) => (
          <button
            key={pos}
            onClick={() => testAddText("X", "large", pos)}
            style={{ ...btnStyle, fontSize: 10, padding: "4px 2px" }}
          >
            {pos.replace("top-", "T").replace("middle-", "M").replace("bottom-", "B").replace("-left", "L").replace("-center", "C").replace("-right", "R")}
          </button>
        ))}
      </div>

      {/* Relative positions */}
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => testAddText("↓", "medium", "below-last")} style={{ ...btnStyle, flex: 1 }}>
          below-last
        </button>
        <button onClick={() => testAddText("→", "medium", "right-of-last")} style={{ ...btnStyle, flex: 1 }}>
          right-of-last
        </button>
      </div>

      {/* Clear */}
      <button
        onClick={() => triggerToolCall(excalidrawAPI, "clear_board", {})}
        style={{ ...btnStyle, background: "#ef4444", color: "white", width: "100%", marginTop: 8 }}
      >
        Clear Board
      </button>
    </div>
  );
}

// Inner component - has access to LiveKit room context
function ExcalidrawRoom({ onReset }: { onReset: () => void }) {
  const room = useRoomContext();
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* Hide all Excalidraw UI - we use our own toolbar */}
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

      {/* Custom minimal toolbar */}
      <MinimalToolbar excalidrawAPI={excalidrawAPI} />
      {/* Full-screen Excalidraw canvas */}
      <Excalidraw
        excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
        isCollaborating={true}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveAsImage: false,
            saveToActiveFile: false,
            toggleTheme: false,
            clearCanvas: false,
          },
          tools: {
            image: true,
          },
        }}
        renderTopRightUI={() => null}
      />

      {/* Debug panel for position testing (Cmd+D to toggle) */}
      <DebugPanel excalidrawAPI={excalidrawAPI} />

      {/* Stream canvas to AI via LiveKit */}
      {excalidrawAPI && room && (
        <ExcalidrawStreamer excalidrawAPI={excalidrawAPI} room={room} />
      )}

      {/* Handle tool calls from AI */}
      {excalidrawAPI && room && (
        <ExcalidrawToolHandler excalidrawAPI={excalidrawAPI} room={room} />
      )}

      {/* Animated tutor cursor */}
      {excalidrawAPI && (
        <TutorCursor excalidrawAPI={excalidrawAPI} />
      )}

      {/* Render AI audio output */}
      <RoomAudioRenderer />

      {/* Floating ChatPill - controls + messages */}
      <ChatPill onReset={onReset} />

      {/* Left Navigation */}
      <LeftNavigation />
    </div>
  );
}

// Tutor mode type
type TutorMode = "guided" | "normal";

// Mode selector component - shown before connecting
function ModeSelector({ onSelect }: { onSelect: (mode: TutorMode) => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#FAF9F7",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 600, marginBottom: 8, color: "#1a1a1a" }}>
        Penseum Tutor
      </h1>
      <p style={{ fontSize: 16, color: "#666", marginBottom: 40 }}>
        Choose your learning mode
      </p>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Guided Mode */}
        <button
          onClick={() => onSelect("guided")}
          style={{
            width: 200,
            padding: "24px 20px",
            borderRadius: 16,
            border: "2px solid #E8E4DE",
            background: "white",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = "#4A90D9";
            e.currentTarget.style.transform = "translateY(-2px)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = "#E8E4DE";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>📚</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4, color: "#1a1a1a" }}>
            Guided Lesson
          </div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.4 }}>
            Follow a structured lesson with concepts and exercises
          </div>
        </button>

        {/* Normal Mode */}
        <button
          onClick={() => onSelect("normal")}
          style={{
            width: 200,
            padding: "24px 20px",
            borderRadius: 16,
            border: "2px solid #E8E4DE",
            background: "white",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = "#4A90D9";
            e.currentTarget.style.transform = "translateY(-2px)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = "#E8E4DE";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4, color: "#1a1a1a" }}>
            Free Tutoring
          </div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.4 }}>
            Ask anything and learn at your own pace
          </div>
        </button>
      </div>
    </div>
  );
}

// Main page component - handles LiveKit connection
export default function Page() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<TutorMode | null>(null);
  const [roomId, setRoomId] = useState("");

  // Fetch LiveKit token
  const fetchToken = useCallback(async (room: string) => {
    try {
      setToken("");
      const resp = await fetch(`/api/token?room=${room}&username=user-${Math.floor(Math.random() * 1000)}`);
      const data = await resp.json();
      if (data.error) {
        setError(data.error);
      } else {
        setToken(data.token);
      }
    } catch (e) {
      setError("Failed to fetch token");
    }
  }, []);

  // When mode is selected, create room with mode in the name
  const handleModeSelect = useCallback((selectedMode: TutorMode) => {
    setMode(selectedMode);
    // Room name format: penseum-{mode}-{timestamp}
    const newRoomId = `penseum-${selectedMode}-${Date.now()}`;
    setRoomId(newRoomId);
    console.log(`[Mode] Selected: ${selectedMode}, Room: ${newRoomId}`);
  }, []);

  // Fetch token when roomId changes (after mode selection)
  useEffect(() => {
    if (roomId) {
      fetchToken(roomId);
    }
  }, [roomId, fetchToken]);

  // Reset creates a new room with same mode
  const handleReset = useCallback(() => {
    if (mode) {
      const newRoomId = `penseum-${mode}-${Date.now()}`;
      setRoomId(newRoomId);
      console.log(`[Reset] New room: ${newRoomId}`);
    }
  }, [mode]);

  // Back to mode selection
  const handleBackToModeSelect = useCallback(() => {
    setMode(null);
    setRoomId("");
    setToken("");
  }, []);

  // Error state
  if (error) return <div style={{ padding: 40, color: "red" }}>Error: {error}</div>;

  // Mode selection screen (shown first)
  if (!mode) {
    return <ModeSelector onSelect={handleModeSelect} />;
  }

  // Loading state (after mode selected, waiting for token)
  if (!token) return <div style={{ padding: 40 }}>Loading Tutor...</div>;

  return (
    <LiveKitRoom
      key={roomId}
      video={false}
      audio={true}
      token={token}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      connect={true}
      data-lk-theme="default"
    >
      <ExcalidrawRoom onReset={handleReset} />
    </LiveKitRoom>
  );
}
