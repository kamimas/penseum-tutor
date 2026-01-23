"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

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

// ============================================
// ANIMATED TEXT COMPONENT
// ============================================

export interface AnimatedTextResult {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
}

export interface AnimatedTextProps {
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  strokeColor?: string;
  duration?: number; // duration per character
  onComplete?: (result: AnimatedTextResult) => void;
}

/**
 * Animated handwriting text using SVG stroke animation.
 * Uses a simple single-stroke font approximation.
 */
export function AnimatedText({
  text,
  x,
  y,
  fontSize = 28,
  strokeColor = "#1e1e1e",
  duration = 0.08, // per character
  onComplete,
}: AnimatedTextProps) {
  const [pathData, setPathData] = useState<string>("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    // Generate path data for text using simple single-stroke glyphs
    const { path, width, height } = generateHandwritingPath(text, fontSize);
    setPathData(path);
    setDimensions({ width, height });
  }, [text, fontSize]);

  if (!pathData) return null;

  const totalDuration = text.length * duration;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      <svg
        width={dimensions.width + 10}
        height={dimensions.height + 10}
        style={{ overflow: "visible" }}
      >
        <motion.path
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration: totalDuration,
            ease: "linear",
          }}
          onAnimationComplete={onComplete}
        />
      </svg>
    </motion.div>
  );
}

/**
 * Simple single-stroke font - each character is a continuous path.
 * Based on Hershey simplex font concepts but simplified.
 */
function generateHandwritingPath(
  text: string,
  fontSize: number
): { path: string; width: number; height: number } {
  const scale = fontSize / 20; // Base font is designed at size 20
  let currentX = 0;
  const paths: string[] = [];

  for (const char of text) {
    const glyph = SIMPLE_GLYPHS[char] || SIMPLE_GLYPHS["?"];
    if (glyph) {
      // Transform glyph path to current position
      const transformed = transformGlyph(glyph.path, currentX, 0, scale);
      paths.push(transformed);
      currentX += glyph.width * scale;
    }
  }

  return {
    path: paths.join(" "),
    width: currentX,
    height: fontSize * 1.2,
  };
}

function transformGlyph(
  path: string,
  offsetX: number,
  offsetY: number,
  scale: number
): string {
  // Parse and transform SVG path commands
  return path.replace(/(-?\d+\.?\d*)/g, (match, num, offset, str) => {
    const val = parseFloat(num);
    // Determine if this is an X or Y coordinate based on command context
    const before = str.slice(0, offset);
    const lastCmd = before.match(/[MLQCZ]/gi)?.pop() || "M";
    const numsBefore = before.slice(before.lastIndexOf(lastCmd)).match(/-?\d+\.?\d*/g) || [];
    const isX = numsBefore.length % 2 === 0;

    if (isX) {
      return String(val * scale + offsetX);
    } else {
      return String(val * scale + offsetY);
    }
  });
}

// Simple single-stroke glyphs (subset - add more as needed)
// Each glyph: { path: SVG path string, width: character width }
const SIMPLE_GLYPHS: Record<string, { path: string; width: number }> = {
  // Letters - single stroke paths
  "A": { path: "M 0 20 L 6 0 L 12 20 M 3 12 L 9 12", width: 14 },
  "B": { path: "M 0 0 L 0 20 L 8 20 Q 12 20 12 15 Q 12 10 8 10 L 0 10 M 0 0 L 8 0 Q 12 0 12 5 Q 12 10 8 10", width: 14 },
  "C": { path: "M 12 4 Q 6 0 2 4 Q 0 8 0 10 Q 0 16 6 20 Q 10 20 12 16", width: 14 },
  "D": { path: "M 0 0 L 0 20 L 6 20 Q 12 20 12 10 Q 12 0 6 0 L 0 0", width: 14 },
  "E": { path: "M 10 0 L 0 0 L 0 20 L 10 20 M 0 10 L 8 10", width: 12 },
  "F": { path: "M 10 0 L 0 0 L 0 20 M 0 10 L 8 10", width: 12 },
  "G": { path: "M 12 4 Q 6 0 2 4 Q 0 8 0 10 Q 0 16 6 20 Q 12 20 12 12 L 7 12", width: 14 },
  "H": { path: "M 0 0 L 0 20 M 12 0 L 12 20 M 0 10 L 12 10", width: 14 },
  "I": { path: "M 0 0 L 6 0 M 3 0 L 3 20 M 0 20 L 6 20", width: 8 },
  "J": { path: "M 0 0 L 8 0 M 4 0 L 4 16 Q 4 20 0 20 Q -2 20 -2 16", width: 10 },
  "K": { path: "M 0 0 L 0 20 M 10 0 L 0 10 L 10 20", width: 12 },
  "L": { path: "M 0 0 L 0 20 L 10 20", width: 12 },
  "M": { path: "M 0 20 L 0 0 L 7 12 L 14 0 L 14 20", width: 16 },
  "N": { path: "M 0 20 L 0 0 L 12 20 L 12 0", width: 14 },
  "O": { path: "M 6 0 Q 0 0 0 10 Q 0 20 6 20 Q 12 20 12 10 Q 12 0 6 0", width: 14 },
  "P": { path: "M 0 20 L 0 0 L 8 0 Q 12 0 12 5 Q 12 10 8 10 L 0 10", width: 14 },
  "Q": { path: "M 6 0 Q 0 0 0 10 Q 0 20 6 20 Q 12 20 12 10 Q 12 0 6 0 M 8 14 L 14 22", width: 16 },
  "R": { path: "M 0 20 L 0 0 L 8 0 Q 12 0 12 5 Q 12 10 8 10 L 0 10 M 6 10 L 12 20", width: 14 },
  "S": { path: "M 10 2 Q 6 0 2 2 Q 0 4 0 6 Q 0 10 6 10 Q 12 10 12 14 Q 12 18 8 20 Q 4 20 0 18", width: 12 },
  "T": { path: "M 0 0 L 12 0 M 6 0 L 6 20", width: 14 },
  "U": { path: "M 0 0 L 0 14 Q 0 20 6 20 Q 12 20 12 14 L 12 0", width: 14 },
  "V": { path: "M 0 0 L 6 20 L 12 0", width: 14 },
  "W": { path: "M 0 0 L 4 20 L 8 8 L 12 20 L 16 0", width: 18 },
  "X": { path: "M 0 0 L 12 20 M 12 0 L 0 20", width: 14 },
  "Y": { path: "M 0 0 L 6 10 L 12 0 M 6 10 L 6 20", width: 14 },
  "Z": { path: "M 0 0 L 12 0 L 0 20 L 12 20", width: 14 },
  // Lowercase
  "a": { path: "M 10 6 Q 10 4 6 4 Q 2 4 2 8 Q 2 14 6 14 Q 10 14 10 10 L 10 4 L 10 14", width: 12 },
  "b": { path: "M 0 0 L 0 14 M 0 8 Q 0 4 4 4 Q 10 4 10 8 Q 10 14 4 14 Q 0 14 0 10", width: 12 },
  "c": { path: "M 10 6 Q 6 4 2 6 Q 0 8 0 9 Q 0 12 4 14 Q 8 14 10 12", width: 12 },
  "d": { path: "M 10 0 L 10 14 M 10 8 Q 10 4 6 4 Q 0 4 0 8 Q 0 14 6 14 Q 10 14 10 10", width: 12 },
  "e": { path: "M 0 9 L 10 9 Q 10 4 5 4 Q 0 4 0 9 Q 0 14 5 14 Q 10 14 10 12", width: 12 },
  "f": { path: "M 8 0 Q 4 0 4 4 L 4 14 M 0 6 L 8 6", width: 10 },
  "g": { path: "M 10 4 L 10 18 Q 10 22 5 22 Q 0 22 0 18 M 10 8 Q 10 4 6 4 Q 0 4 0 8 Q 0 14 6 14 Q 10 14 10 10", width: 12 },
  "h": { path: "M 0 0 L 0 14 M 0 8 Q 0 4 5 4 Q 10 4 10 8 L 10 14", width: 12 },
  "i": { path: "M 3 0 L 3 1 M 3 4 L 3 14", width: 6 },
  "j": { path: "M 5 0 L 5 1 M 5 4 L 5 18 Q 5 22 0 22", width: 8 },
  "k": { path: "M 0 0 L 0 14 M 8 4 L 0 10 L 8 14", width: 10 },
  "l": { path: "M 3 0 L 3 14", width: 6 },
  "m": { path: "M 0 14 L 0 4 M 0 6 Q 0 4 4 4 Q 7 4 7 8 L 7 14 M 7 6 Q 7 4 11 4 Q 14 4 14 8 L 14 14", width: 16 },
  "n": { path: "M 0 14 L 0 4 M 0 6 Q 0 4 5 4 Q 10 4 10 8 L 10 14", width: 12 },
  "o": { path: "M 5 4 Q 0 4 0 9 Q 0 14 5 14 Q 10 14 10 9 Q 10 4 5 4", width: 12 },
  "p": { path: "M 0 4 L 0 22 M 0 8 Q 0 4 4 4 Q 10 4 10 8 Q 10 14 4 14 Q 0 14 0 10", width: 12 },
  "q": { path: "M 10 4 L 10 22 M 10 8 Q 10 4 6 4 Q 0 4 0 8 Q 0 14 6 14 Q 10 14 10 10", width: 12 },
  "r": { path: "M 0 14 L 0 4 M 0 8 Q 0 4 4 4 Q 8 4 8 6", width: 10 },
  "s": { path: "M 8 5 Q 5 4 2 5 Q 0 6 0 7 Q 0 9 5 9 Q 10 9 10 11 Q 10 13 6 14 Q 2 14 0 12", width: 10 },
  "t": { path: "M 4 0 L 4 12 Q 4 14 6 14 Q 8 14 8 12 M 0 4 L 8 4", width: 10 },
  "u": { path: "M 0 4 L 0 10 Q 0 14 5 14 Q 10 14 10 10 L 10 4 L 10 14", width: 12 },
  "v": { path: "M 0 4 L 5 14 L 10 4", width: 12 },
  "w": { path: "M 0 4 L 3 14 L 6 6 L 9 14 L 12 4", width: 14 },
  "x": { path: "M 0 4 L 10 14 M 10 4 L 0 14", width: 12 },
  "y": { path: "M 0 4 L 5 14 M 10 4 L 5 14 L 2 22", width: 12 },
  "z": { path: "M 0 4 L 10 4 L 0 14 L 10 14", width: 12 },
  // Numbers
  "0": { path: "M 5 0 Q 0 0 0 10 Q 0 20 5 20 Q 10 20 10 10 Q 10 0 5 0", width: 12 },
  "1": { path: "M 2 4 L 5 0 L 5 20 M 2 20 L 8 20", width: 10 },
  "2": { path: "M 0 4 Q 0 0 5 0 Q 10 0 10 5 Q 10 10 0 20 L 10 20", width: 12 },
  "3": { path: "M 0 2 Q 5 0 8 2 Q 10 4 10 6 Q 10 10 5 10 Q 10 10 10 14 Q 10 18 6 20 Q 2 20 0 18", width: 12 },
  "4": { path: "M 8 20 L 8 0 L 0 12 L 10 12", width: 12 },
  "5": { path: "M 10 0 L 0 0 L 0 8 Q 0 8 5 8 Q 10 8 10 14 Q 10 20 5 20 Q 0 20 0 16", width: 12 },
  "6": { path: "M 8 0 Q 4 0 2 4 Q 0 8 0 12 Q 0 20 5 20 Q 10 20 10 14 Q 10 10 5 10 Q 0 10 0 14", width: 12 },
  "7": { path: "M 0 0 L 10 0 L 4 20", width: 12 },
  "8": { path: "M 5 0 Q 0 0 0 5 Q 0 10 5 10 Q 10 10 10 5 Q 10 0 5 0 M 5 10 Q 0 10 0 15 Q 0 20 5 20 Q 10 20 10 15 Q 10 10 5 10", width: 12 },
  "9": { path: "M 2 20 Q 6 20 8 16 Q 10 12 10 8 Q 10 0 5 0 Q 0 0 0 6 Q 0 10 5 10 Q 10 10 10 6", width: 12 },
  // Punctuation & common symbols
  " ": { path: "", width: 8 },
  ".": { path: "M 2 18 Q 0 18 0 20 Q 0 22 2 22 Q 4 22 4 20 Q 4 18 2 18", width: 6 },
  ",": { path: "M 2 16 Q 4 18 2 22 Q 0 22 2 18", width: 6 },
  "!": { path: "M 2 0 L 2 12 M 2 16 L 2 20", width: 6 },
  "?": { path: "M 0 4 Q 0 0 5 0 Q 10 0 10 5 Q 10 10 5 10 L 5 14 M 5 18 L 5 20", width: 12 },
  ":": { path: "M 2 4 L 2 6 M 2 14 L 2 16", width: 6 },
  "-": { path: "M 0 10 L 8 10", width: 10 },
  "+": { path: "M 5 2 L 5 18 M 0 10 L 10 10", width: 12 },
  "=": { path: "M 0 7 L 10 7 M 0 13 L 10 13", width: 12 },
  "(": { path: "M 6 0 Q 0 5 0 10 Q 0 15 6 20", width: 8 },
  ")": { path: "M 0 0 Q 6 5 6 10 Q 6 15 0 20", width: 8 },
  "/": { path: "M 10 0 L 0 20", width: 12 },
  "'": { path: "M 2 0 L 2 6", width: 6 },
  "\"": { path: "M 2 0 L 2 6 M 8 0 L 8 6", width: 12 },
};

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
