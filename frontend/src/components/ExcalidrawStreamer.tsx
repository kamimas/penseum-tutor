"use client";
import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";

// Using 'any' to avoid type import issues with @excalidraw/excalidraw
type ExcalidrawAPI = any;

interface StreamerProps {
  excalidrawAPI: ExcalidrawAPI;
  room: Room;
}

// Get dimensions that match source aspect ratio, capped for bandwidth
function getStreamDimensions(sourceWidth: number, sourceHeight: number) {
  const MAX_WIDTH = 1920;
  const MAX_HEIGHT = 1080;

  let width = sourceWidth;
  let height = sourceHeight;

  // Scale down if too large (preserving aspect ratio)
  if (width > MAX_WIDTH) {
    height = Math.round(height * (MAX_WIDTH / width));
    width = MAX_WIDTH;
  }
  if (height > MAX_HEIGHT) {
    width = Math.round(width * (MAX_HEIGHT / height));
    height = MAX_HEIGHT;
  }

  // Ensure dimensions are even (required for some video codecs)
  width = Math.floor(width / 2) * 2;
  height = Math.floor(height / 2) * 2;

  // Minimum size for very small screens
  width = Math.max(width, 320);
  height = Math.max(height, 240);

  return { width, height };
}

export function ExcalidrawStreamer({ excalidrawAPI, room }: StreamerProps) {
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!excalidrawAPI || !room) return;

    let publication: any;
    let isMounted = true;

    const setup = async () => {
      // 1. Create a "Virtual" Canvas to stream from (will be resized dynamically)
      const streamCanvas = document.createElement("canvas");
      streamCanvasRef.current = streamCanvas;

      // Start with window size, will adjust on first frame
      const initial = getStreamDimensions(window.innerWidth, window.innerHeight);
      streamCanvas.width = initial.width;
      streamCanvas.height = initial.height;
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
      } catch {
        // Failed to publish track
      }

      // 4. The render loop - capture DOM canvas directly
      const renderLoop = async () => {
        if (!isMounted) return;

        try {
          // Find Excalidraw's static canvas in the DOM
          const excalidrawCanvas = document.querySelector('.excalidraw__canvas') as HTMLCanvasElement;

          if (excalidrawCanvas && streamCtx) {
            // Update stream canvas size to match source (handles resize/rotation)
            const { width: newWidth, height: newHeight } = getStreamDimensions(
              excalidrawCanvas.width,
              excalidrawCanvas.height
            );

            if (streamCanvas.width !== newWidth || streamCanvas.height !== newHeight) {
              streamCanvas.width = newWidth;
              streamCanvas.height = newHeight;
            }

            // Draw directly from Excalidraw's canvas - preserving aspect ratio
            streamCtx.fillStyle = "#ffffff";
            streamCtx.fillRect(0, 0, streamCanvas.width, streamCanvas.height);
            streamCtx.drawImage(excalidrawCanvas, 0, 0, streamCanvas.width, streamCanvas.height);
          }

          // Tell the video track "I have a new frame"
          if (videoTrack && "requestFrame" in videoTrack) {
            (videoTrack as any).requestFrame();
          }
        } catch {
          // Capture error
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
      streamCanvasRef.current = null;
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
