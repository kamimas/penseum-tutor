"use client";

import { motion } from "framer-motion";

export interface AnimationLoadingOverlayProps {
  x: number; // screen pixels
  y: number;
  width: number;
  height: number;
  onComplete?: () => void; // Called when animation loads successfully
}

/**
 * DOM overlay that shows a loading spinner at the position where an animation
 * will appear. This is rendered outside Excalidraw's canvas as a React component,
 * ensuring it's visible immediately while the p5.js code is being generated.
 */
export function AnimationLoadingOverlay({
  x,
  y,
  width,
  height,
}: AnimationLoadingOverlayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        pointerEvents: "none",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(26, 26, 46, 0.95)",
        borderRadius: "8px",
        border: "2px solid #2a2a4e",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
      }}
    >
      <div style={{ textAlign: "center", color: "#9D7CD8" }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          style={{
            width: "40px",
            height: "40px",
            border: "3px solid #2a2a4e",
            borderTopColor: "#9D7CD8",
            borderRadius: "50%",
            margin: "0 auto 16px",
          }}
        />
        <div style={{ fontSize: "14px", opacity: 0.8, fontFamily: "system-ui, sans-serif" }}>
          Generating animation...
        </div>
      </div>
    </motion.div>
  );
}
