"use client";
import { useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import type { Room } from "livekit-client";

interface StreamerProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  room: Room;
}

export function ExcalidrawStreamer({ excalidrawAPI, room }: StreamerProps) {
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [debugPreview, setDebugPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!excalidrawAPI || !room) return;

    let publication: any;
    let isMounted = true;

    const setup = async () => {
      // 1. Create a "Virtual" Canvas to stream from
      const streamCanvas = document.createElement("canvas");
      streamCanvas.width = 1280;
      streamCanvas.height = 720;
      const streamCtx = streamCanvas.getContext("2d");

      // 2. Create the Video Stream (0 FPS initially, we push frames manually)
      const stream = streamCanvas.captureStream(0);
      const videoTrack = stream.getVideoTracks()[0];
      videoTrackRef.current = videoTrack;

      // 3. Publish to LiveKit
      try {
        const { Track } = await import("livekit-client");
        publication = await room.localParticipant.publishTrack(videoTrack, {
          name: "whiteboard_stream",
          source: Track.Source.ScreenShare,
        });
        console.log("[Excalidraw Stream] Published track:", publication.trackSid);
      } catch (err) {
        console.error("[Excalidraw Stream] Failed to publish:", err);
      }

      // 4. Dynamically import exportToCanvas to avoid SSR issues
      const { exportToCanvas } = await import("@excalidraw/excalidraw");

      // 5. The render loop
      let frameCount = 0;
      const renderLoop = async () => {
        if (!isMounted) return;

        try {
          const elements = excalidrawAPI.getSceneElements();
          const appState = excalidrawAPI.getAppState();
          const files = excalidrawAPI.getFiles();

          // Generate a clean Canvas from Excalidraw data
          const tempCanvas = await exportToCanvas({
            elements,
            appState: {
              ...appState,
              viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
              exportWithDarkMode: false,
            },
            files,
            getDimensions: () => ({ width: 1280, height: 720, scale: 1 }),
          });

          // Draw to our Stream Canvas
          if (streamCtx) {
            streamCtx.fillStyle = "#ffffff";
            streamCtx.fillRect(0, 0, streamCanvas.width, streamCanvas.height);
            streamCtx.drawImage(tempCanvas, 0, 0, streamCanvas.width, streamCanvas.height);
          }

          // Tell the video track "I have a new frame"
          if (videoTrack && "requestFrame" in videoTrack) {
            (videoTrack as any).requestFrame();
          }

          // Update debug preview every 3rd frame
          frameCount++;
          if (frameCount % 3 === 0) {
            setDebugPreview(streamCanvas.toDataURL("image/jpeg", 0.5));
            console.log(`[Excalidraw Stream] Frame ${frameCount}, elements: ${elements.length}`);
          }
        } catch (err) {
          console.warn("[Excalidraw Stream] Capture error:", err);
        }
      };

      // Run every 1000ms (1 FPS)
      intervalRef.current = setInterval(renderLoop, 1000);
      // Render first frame immediately
      renderLoop();

      // Return cleanup data
      return { stream, videoTrack };
    };

    let streamData: { stream: MediaStream; videoTrack: MediaStreamTrack } | undefined;

    setup().then((data) => {
      streamData = data;
    });

    return () => {
      isMounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (publication && videoTrackRef.current) {
        room.localParticipant.unpublishTrack(videoTrackRef.current);
        console.log("[Excalidraw Stream] Unpublished track");
      }
      if (streamData?.stream) {
        streamData.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [excalidrawAPI, room]);

  return (
    <>
      {/* Debug preview */}
      {debugPreview && (
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            left: "20px",
            border: "2px solid #10b981",
            borderRadius: "8px",
            overflow: "hidden",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            zIndex: 1000,
            backgroundColor: "#000",
          }}
        >
          <div
            style={{
              backgroundColor: "#10b981",
              color: "white",
              fontSize: "10px",
              padding: "2px 6px",
              fontWeight: "bold",
            }}
          >
            AI View (Excalidraw)
          </div>
          <img
            src={debugPreview}
            alt="AI Canvas View"
            style={{
              width: "200px",
              height: "112px",
              display: "block",
            }}
          />
        </div>
      )}
    </>
  );
}
