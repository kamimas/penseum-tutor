"use client";
import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";

// Using 'any' to avoid type import issues with @excalidraw/excalidraw
type ExcalidrawAPI = any;

interface StreamerProps {
  excalidrawAPI: ExcalidrawAPI;
  room: Room;
}

export function ExcalidrawStreamer({ excalidrawAPI, room }: StreamerProps) {
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
      } catch (err) {
        console.error("[Excalidraw Stream] Failed to publish:", err);
      }

      // 4. The render loop - capture DOM canvas directly
      let frameCount = 0;
      const renderLoop = async () => {
        if (!isMounted) return;

        try {
          // Find Excalidraw's static canvas in the DOM
          const excalidrawCanvas = document.querySelector('.excalidraw__canvas') as HTMLCanvasElement;

          if (excalidrawCanvas && streamCtx) {
            // Draw directly from Excalidraw's canvas - this is exactly what the user sees
            streamCtx.fillStyle = "#ffffff";
            streamCtx.fillRect(0, 0, streamCanvas.width, streamCanvas.height);
            streamCtx.drawImage(excalidrawCanvas, 0, 0, streamCanvas.width, streamCanvas.height);

          }

          // Tell the video track "I have a new frame"
          if (videoTrack && "requestFrame" in videoTrack) {
            (videoTrack as any).requestFrame();
          }

          frameCount++;
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
      }
      if (streamData?.stream) {
        streamData.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [excalidrawAPI, room]);

  return null;
}
