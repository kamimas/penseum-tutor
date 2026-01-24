"use client";

import { motion } from "framer-motion";

// Points array format for Excalidraw freedraw elements
export type FreedrawPoints = [number, number][];

export interface AnimatedAnnotationResult {
  // Points in LOCAL coordinates (relative to element origin)
  points: FreedrawPoints;
  // Pressures array (same length as points, values 0-1)
  pressures: number[];
  // Screen position where animation was shown
  screenX: number;
  screenY: number;
  // Dimensions
  width: number;
  height: number;
  // Stroke properties to match SVG appearance
  strokeColor: string;
  strokeWidth: number;
}

interface AnimatedAnnotationProps {
  shape: "circle" | "rectangle" | "arrow";
  x: number; // screen pixels
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  strokeWidth?: number;
  duration?: number;
  onComplete?: (result: AnimatedAnnotationResult) => void;
}

export function AnimatedAnnotation({
  shape,
  x,
  y,
  width,
  height,
  strokeColor = "#e03131",
  strokeWidth = 3,
  duration = 0.6,
  onComplete,
}: AnimatedAnnotationProps) {
  // Generate points for circle (used for both SVG path and freedraw)
  const generateCirclePoints = (): FreedrawPoints => {
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2 - 4;
    const ry = height / 2 - 4;
    const segments = 32;
    const points: FreedrawPoints = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      // Add small wobble for hand-drawn feel
      const wobble = Math.sin(angle * 3) * 2 + Math.cos(angle * 5) * 1.5;
      const px = cx + (rx + wobble) * Math.cos(angle);
      const py = cy + (ry + wobble) * Math.sin(angle);
      points.push([px, py]);
    }
    return points;
  };

  // Generate points for rectangle
  const generateRectPoints = (): FreedrawPoints => {
    const padding = 4;
    const l = padding;
    const t = padding;
    const r = width - padding;
    const b = height - padding;
    const points: FreedrawPoints = [];
    const segmentsPerSide = 8;

    // Top edge (left to right)
    for (let i = 0; i <= segmentsPerSide; i++) {
      const progress = i / segmentsPerSide;
      const wobble = Math.sin(progress * Math.PI * 2) * 1.5;
      points.push([l + (r - l) * progress, t + wobble]);
    }
    // Right edge (top to bottom)
    for (let i = 1; i <= segmentsPerSide; i++) {
      const progress = i / segmentsPerSide;
      const wobble = Math.sin(progress * Math.PI * 2) * 1.5;
      points.push([r + wobble, t + (b - t) * progress]);
    }
    // Bottom edge (right to left)
    for (let i = 1; i <= segmentsPerSide; i++) {
      const progress = i / segmentsPerSide;
      const wobble = Math.sin(progress * Math.PI * 2) * 1.5;
      points.push([r - (r - l) * progress, b + wobble]);
    }
    // Left edge (bottom to top)
    for (let i = 1; i <= segmentsPerSide; i++) {
      const progress = i / segmentsPerSide;
      const wobble = Math.sin(progress * Math.PI * 2) * 1.5;
      points.push([l + wobble, b - (b - t) * progress]);
    }
    return points;
  };

  // Get points based on shape
  const points = shape === "circle" ? generateCirclePoints() : generateRectPoints();

  // Generate pressures (vary slightly for natural feel)
  const pressures = points.map((_, i) => {
    const base = 0.5;
    const variation = 0.2 * Math.sin((i / points.length) * Math.PI * 4);
    return base + variation;
  });

  // Convert points to SVG path string
  const pointsToPath = (pts: FreedrawPoints): string => {
    if (pts.length === 0) return "";
    const pathParts = pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`));
    pathParts.push("Z");
    return pathParts.join(" ");
  };

  const path = pointsToPath(points);

  const handleAnimationComplete = () => {
    if (onComplete) {
      onComplete({
        points,
        pressures,
        screenX: x,
        screenY: y,
        width,
        height,
        strokeColor,
        strokeWidth,
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 1 }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <motion.path
          d={path}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration,
            ease: "easeOut",
          }}
          onAnimationComplete={handleAnimationComplete}
        />
      </svg>
    </motion.div>
  );
}
