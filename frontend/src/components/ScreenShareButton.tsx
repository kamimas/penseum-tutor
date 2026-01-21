"use client";
import { useLocalParticipant } from "@livekit/components-react";
import { useState, useCallback } from "react";

export function ScreenShareButton() {
  const { localParticipant } = useLocalParticipant();
  const [isSharing, setIsSharing] = useState(false);

  const toggleShare = useCallback(async () => {
    if (!localParticipant) return;

    if (isSharing) {
      await localParticipant.setScreenShareEnabled(false);
      setIsSharing(false);
    } else {
      await localParticipant.setScreenShareEnabled(true, {
        audio: false,
        video: true,
        resolution: { width: 1920, height: 1080, frameRate: 5 },
      });
      setIsSharing(true);
    }
  }, [localParticipant, isSharing]);

  return (
    <button
      onClick={toggleShare}
      style={{
        position: "fixed",
        bottom: 100,
        right: 24,
        padding: "12px 20px",
        background: isSharing ? "#ef4444" : "#3b82f6",
        color: "white",
        border: "none",
        borderRadius: 12,
        cursor: "pointer",
        fontWeight: 500,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        fontSize: 14,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 1000,
        transition: "all 0.2s ease",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "scale(1.02)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {isSharing ? "Stop Sharing" : "Share Screen with Tutor"}
    </button>
  );
}
