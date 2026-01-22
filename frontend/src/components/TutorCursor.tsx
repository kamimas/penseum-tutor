"use client";
import { useEffect, useRef, useCallback } from "react";

// Types matching Excalidraw's collaborator system
type SocketId = string & { _brand: "SocketId" };

interface Collaborator {
  pointer?: {
    x: number;
    y: number;
    tool: "pointer" | "laser";
    renderCursor?: boolean;
  };
  username?: string | null;
  color?: {
    background: string;
    stroke: string;
  };
  isCurrentUser?: boolean;
}

interface TutorCursorProps {
  excalidrawAPI: any;
}

// Tutor cursor config
const TUTOR_SOCKET_ID = "tutor-cursor" as SocketId;
const TUTOR_COLOR = {
  background: "#ff69b4", // Hot pink
  stroke: "#ff1493",     // Deep pink
};

// Animation config
const ANIMATION_DURATION = 400; // ms
const CURSOR_OFFSET = { x: 20, y: 20 }; // Offset from bottom-right of content

// Easing function (ease-out cubic)
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * TutorCursor - Renders an animated collaborator cursor that points to the
 * bottom-right of the most recently added content on the Excalidraw canvas.
 */
export function TutorCursor({ excalidrawAPI }: TutorCursorProps) {
  const currentPosRef = useRef({ x: 0, y: 0 });
  const targetPosRef = useRef({ x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  /**
   * Update the collaborator cursor position in Excalidraw
   */
  const updateCursorPosition = useCallback((x: number, y: number) => {
    if (!excalidrawAPI) {
      console.log("[TutorCursor] No excalidrawAPI");
      return;
    }

    console.log(`[TutorCursor] Setting cursor at (${x.toFixed(0)}, ${y.toFixed(0)})`);

    const collaborators = new Map<SocketId, Collaborator>();
    collaborators.set(TUTOR_SOCKET_ID, {
      pointer: {
        x,
        y,
        tool: "pointer",
        renderCursor: true,
      },
      username: "Tutor",
      color: TUTOR_COLOR,
      isCurrentUser: false,
    });

    excalidrawAPI.updateScene({ collaborators });

    // Verify it was set
    const appState = excalidrawAPI.getAppState();
    console.log("[TutorCursor] Collaborators after update:", appState.collaborators);
  }, [excalidrawAPI]);

  /**
   * Animate cursor from current position to target position
   */
  const animateTo = useCallback((targetX: number, targetY: number) => {
    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const startPos = { ...currentPosRef.current };
    const startTime = performance.now();

    targetPosRef.current = { x: targetX, y: targetY };

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      const easedProgress = easeOutCubic(progress);

      const newX = startPos.x + (targetX - startPos.x) * easedProgress;
      const newY = startPos.y + (targetY - startPos.y) * easedProgress;

      currentPosRef.current = { x: newX, y: newY };
      updateCursorPosition(newX, newY);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [updateCursorPosition]);

  /**
   * Calculate the bottom-right position of all content on the canvas
   */
  const getContentBottomRight = useCallback(() => {
    if (!excalidrawAPI) return null;

    const elements = excalidrawAPI.getSceneElements();
    if (!elements || elements.length === 0) return null;

    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of elements) {
      if (el.isDeleted) continue;
      const right = el.x + el.width;
      const bottom = el.y + el.height;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }

    if (maxX === -Infinity) return null;

    return {
      x: maxX + CURSOR_OFFSET.x,
      y: maxY + CURSOR_OFFSET.y,
    };
  }, [excalidrawAPI]);

  /**
   * Move cursor to the bottom-right of all content
   */
  const moveToCon = useCallback(() => {
    const pos = getContentBottomRight();
    if (pos) {
      animateTo(pos.x, pos.y);
    }
  }, [getContentBottomRight, animateTo]);

  /**
   * Initialize cursor and listen for scene changes
   */
  useEffect(() => {
    if (!excalidrawAPI) {
      console.log("[TutorCursor] Waiting for excalidrawAPI...");
      return;
    }

    console.log("[TutorCursor] excalidrawAPI available, initializing...");

    // Initialize cursor position
    if (!isInitializedRef.current) {
      const initialPos = getContentBottomRight();
      console.log("[TutorCursor] Initial content position:", initialPos);

      if (initialPos) {
        currentPosRef.current = initialPos;
        updateCursorPosition(initialPos.x, initialPos.y);
      } else {
        // Default to center of viewport
        const appState = excalidrawAPI.getAppState();
        console.log("[TutorCursor] AppState:", {
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          width: appState.width,
          height: appState.height
        });
        const centerX = -appState.scrollX + (appState.width || 800) / 2;
        const centerY = -appState.scrollY + (appState.height || 600) / 2;
        console.log("[TutorCursor] Defaulting to center:", { centerX, centerY });
        currentPosRef.current = { x: centerX, y: centerY };
        updateCursorPosition(centerX, centerY);
      }
      isInitializedRef.current = true;
    }

    // Subscribe to scene changes
    const unsubscribe = excalidrawAPI.onChange(
      (elements: any[], _appState: any, _files: any) => {
        // When elements change, move cursor to new content position
        if (elements.length > 0) {
          // Small delay to let the element render
          setTimeout(moveToCon, 50);
        }
      }
    );

    return () => {
      unsubscribe();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [excalidrawAPI, getContentBottomRight, updateCursorPosition, moveToCon]);

  // This component doesn't render anything visible - it just manages the cursor
  return null;
}

/**
 * Utility function to manually trigger cursor movement (can be called from tool handler)
 */
export function moveTutorCursorTo(
  excalidrawAPI: any,
  x: number,
  y: number
): void {
  if (!excalidrawAPI) return;

  const collaborators = new Map<SocketId, Collaborator>();
  collaborators.set(TUTOR_SOCKET_ID, {
    pointer: {
      x,
      y,
      tool: "pointer",
      renderCursor: true,
    },
    username: "Tutor",
    color: TUTOR_COLOR,
    isCurrentUser: false,
  });

  excalidrawAPI.updateScene({ collaborators });
}
