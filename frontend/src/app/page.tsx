"use client";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import TutorCanvas from "../components/TutorCanvas";
import { IntelligenceDock } from "../components/IntelligenceDock";
import { ScreenShareButton } from "../components/ScreenShareButton";
import { useEffect, useState, useCallback } from "react";

// Ghost UI Reset Pill - minimal, transparent design
function StatusPill({ onReset }: { onReset: () => void }) {
  const room = useRoomContext();

  const handleReset = useCallback(async () => {
    try {
      await room.disconnect();
    } catch (e) {
      console.error("Error disconnecting:", e);
    }
    onReset();
  }, [room, onReset]);

  return (
    <div
      onClick={handleReset}
      style={{
        position: "fixed",
        top: 24,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "4px 16px",
        background: "rgba(255, 255, 255, 0.5)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: 9999,
        border: "1px solid rgba(255, 255, 255, 0.2)",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
        zIndex: 1000,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.8)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.5)";
      }}
    >
      <span style={{
        fontSize: 12,
        fontWeight: 500,
        color: "rgb(75, 85, 99)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      }}>
        Reset Canvas
      </span>
    </div>
  );
}

export default function Page() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [roomId, setRoomId] = useState(() => `penseum-${Date.now()}`);

  const fetchToken = useCallback(async (room: string) => {
    try {
      setToken(""); // Clear token to show loading
      const resp = await fetch(`/api/token?room=${room}&username=user-${Math.floor(Math.random()*1000)}`);
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

  const handleReset = useCallback(() => {
    // Generate new room ID to get a fresh room
    const newRoomId = `penseum-${Date.now()}`;
    setRoomId(newRoomId);
  }, []);

  if (error) return <div style={{ padding: 40, color: "red" }}>Error: {error}</div>;
  if (!token) return <div style={{ padding: 40 }}>Loading Tutor...</div>;

  return (
    <LiveKitRoom
      key={roomId} // Force remount on room change
      video={false}
      audio={true}
      token={token}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      connect={true}
      data-lk-theme="default"
    >
      <StatusPill onReset={handleReset} />
      <TutorCanvas />
      <RoomAudioRenderer />
      <ScreenShareButton />
      <IntelligenceDock onReset={handleReset} />
    </LiveKitRoom>
  );
}
