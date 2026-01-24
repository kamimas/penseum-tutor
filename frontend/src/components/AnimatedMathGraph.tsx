"use client";

import { motion } from "framer-motion";
import { Parser } from "expr-eval";
import { useRef } from "react";

export interface AnimatedMathGraphResult {
  // SVG as data URL for Excalidraw image element
  svgDataUrl: string;
  // Dimensions
  width: number;
  height: number;
}

interface AnimatedMathGraphProps {
  expression: string; // e.g., "sin(x)", "x^2", "1/x"
  x: number; // screen pixels
  y: number;
  width: number;
  height: number;
  xMin?: number;
  xMax?: number;
  strokeColor?: string;
  axisColor?: string;
  strokeWidth?: number;
  duration?: number;
  onComplete?: (result: AnimatedMathGraphResult) => void;
}

// Create parser instance with common math functions
const parser = new Parser();

export function AnimatedMathGraph({
  expression,
  x,
  y,
  width,
  height,
  xMin = -Math.PI,
  xMax = Math.PI,
  strokeColor = "#1971c2",
  axisColor = "#868e96",
  strokeWidth = 2,
  duration = 0.8,
  onComplete,
}: AnimatedMathGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const padding = 20;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  // Parse the expression
  let expr: ReturnType<typeof parser.parse>;
  try {
    expr = parser.parse(expression);
  } catch (e) {
    console.error("[AnimatedMathGraph] Failed to parse expression:", expression, e);
    return null;
  }

  // Evaluate function and find y range
  const numPoints = 100;
  const rawPoints: { x: number; y: number }[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;

  for (let i = 0; i <= numPoints; i++) {
    const xVal = xMin + (i / numPoints) * (xMax - xMin);
    try {
      const yVal = expr.evaluate({ x: xVal, e: Math.E, pi: Math.PI, PI: Math.PI });
      if (isFinite(yVal)) {
        rawPoints.push({ x: xVal, y: yVal });
        if (yVal < yMin) yMin = yVal;
        if (yVal > yMax) yMax = yVal;
      }
    } catch {
      // Skip undefined points (e.g., 1/0)
    }
  }

  // Clamp extreme values for better visualization
  const yRange = yMax - yMin;
  if (yRange > 20) {
    const mid = (yMax + yMin) / 2;
    yMin = mid - 10;
    yMax = mid + 10;
  }
  // Add padding to y range
  const yPadding = (yMax - yMin) * 0.1 || 1;
  yMin -= yPadding;
  yMax += yPadding;

  // Map math coords to screen coords
  const toScreenX = (xVal: number) =>
    padding + ((xVal - xMin) / (xMax - xMin)) * graphWidth;
  const toScreenY = (yVal: number) =>
    padding + graphHeight - ((yVal - yMin) / (yMax - yMin)) * graphHeight;

  // Generate curve points with hand-drawn wobble
  const generateCurvePoints = (): [number, number][] => {
    const points: [number, number][] = [];
    for (const pt of rawPoints) {
      // Clamp y to visible range
      const clampedY = Math.max(yMin, Math.min(yMax, pt.y));
      const screenX = toScreenX(pt.x);
      const screenY = toScreenY(clampedY);
      // Add subtle wobble for hand-drawn feel
      const wobbleX = (Math.random() - 0.5) * 1.5;
      const wobbleY = (Math.random() - 0.5) * 1.5;
      points.push([screenX + wobbleX, screenY + wobbleY]);
    }
    return points;
  };

  // Generate axis points with wobble
  const generateAxisPoints = (): { xAxis: [number, number][]; yAxis: [number, number][] } => {
    const xAxisPoints: [number, number][] = [];
    const yAxisPoints: [number, number][] = [];

    // X-axis (horizontal line at y=0 if visible, otherwise at bottom)
    const xAxisY = yMin <= 0 && yMax >= 0 ? toScreenY(0) : padding + graphHeight;
    const segments = 20;
    for (let i = 0; i <= segments; i++) {
      const progress = i / segments;
      const px = padding + progress * graphWidth;
      const wobble = (Math.random() - 0.5) * 1;
      xAxisPoints.push([px, xAxisY + wobble]);
    }

    // Y-axis (vertical line at x=0 if visible, otherwise at left)
    const yAxisX = xMin <= 0 && xMax >= 0 ? toScreenX(0) : padding;
    for (let i = 0; i <= segments; i++) {
      const progress = i / segments;
      const py = padding + progress * graphHeight;
      const wobble = (Math.random() - 0.5) * 1;
      yAxisPoints.push([yAxisX + wobble, py]);
    }

    return { xAxis: xAxisPoints, yAxis: yAxisPoints };
  };

  const curvePoints = generateCurvePoints();
  const { xAxis, yAxis } = generateAxisPoints();

  // Convert points to SVG path
  const pointsToPath = (pts: [number, number][]): string => {
    if (pts.length === 0) return "";
    const pathParts = pts.map((p, i) =>
      i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`
    );
    return pathParts.join(" ");
  };

  const curvePath = pointsToPath(curvePoints);
  const xAxisPath = pointsToPath(xAxis);
  const yAxisPath = pointsToPath(yAxis);

  const handleAnimationComplete = () => {
    if (onComplete && svgRef.current) {
      // Clone the SVG and remove animation attributes for static export
      const svgClone = svgRef.current.cloneNode(true) as SVGSVGElement;

      // Remove Framer Motion attributes and set full path visibility
      const paths = svgClone.querySelectorAll('path');
      paths.forEach(path => {
        // Remove style attributes that might hide the path
        path.removeAttribute('style');
        // Set stroke-dasharray and stroke-dashoffset to show full path
        path.setAttribute('stroke-dasharray', 'none');
        path.setAttribute('stroke-dashoffset', '0');
      });

      // Serialize to string
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgClone);

      // Convert to data URL
      const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;

      onComplete({
        svgDataUrl,
        width,
        height,
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
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ overflow: "visible" }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* X-axis */}
        <motion.path
          d={xAxisPath}
          fill="none"
          stroke={axisColor}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration: duration * 0.3,
            ease: "easeOut",
          }}
        />
        {/* Y-axis */}
        <motion.path
          d={yAxisPath}
          fill="none"
          stroke={axisColor}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration: duration * 0.3,
            ease: "easeOut",
          }}
        />
        {/* Function curve */}
        <motion.path
          d={curvePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration: duration * 0.7,
            delay: duration * 0.3,
            ease: "easeInOut",
          }}
          onAnimationComplete={handleAnimationComplete}
        />
      </svg>
    </motion.div>
  );
}
