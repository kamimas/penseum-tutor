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
import { ExcalidrawStreamer } from "../../components/ExcalidrawStreamer";
import { ExcalidrawToolHandler } from "../../components/ExcalidrawToolHandler";
import { IntelligenceDock } from "../../components/IntelligenceDock";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";

// Dynamic import - Excalidraw doesn't support SSR
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <div style={{ padding: 40 }}>Loading Excalidraw...</div> }
);

// Inner component - has access to LiveKit room context
function ExcalidrawRoom({ onReset }: { onReset: () => void }) {
  const room = useRoomContext();
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* Full-screen Excalidraw canvas */}
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
      />

      {/* Stream canvas to AI via LiveKit */}
      {excalidrawAPI && room && (
        <ExcalidrawStreamer excalidrawAPI={excalidrawAPI} room={room} />
      )}

      {/* Handle tool calls from AI */}
      {excalidrawAPI && room && (
        <ExcalidrawToolHandler excalidrawAPI={excalidrawAPI} room={room} />
      )}

      {/* Render AI audio output */}
      <RoomAudioRenderer />

      {/* Mic controls + hangup button */}
      <IntelligenceDock onReset={onReset} />
    </div>
  );
}

// Main page component - handles LiveKit connection
export default function ExcalidrawPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [roomId, setRoomId] = useState(() => `penseum-${Date.now()}`);

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

  useEffect(() => {
    fetchToken(roomId);
  }, [roomId, fetchToken]);

  // Reset creates a new room
  const handleReset = useCallback(() => {
    setRoomId(`penseum-${Date.now()}`);
  }, []);

  // Error state
  if (error) return <div style={{ padding: 40, color: "red" }}>Error: {error}</div>;

  // Loading state
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
