"use client";
import { useRoomContext } from "@livekit/components-react";
import {
  Tldraw,
  useEditor,
  TLComponents,
  createShapeId,
  TLShapeId,
  Editor,
} from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { useEffect, useMemo, useRef } from "react";
import { PlotShapeUtil } from "./shapes/PlotShapeUtil";
import { TutorImageShapeUtil } from "./shapes/TutorImageShapeUtil";
import { LatexShapeUtil } from "./shapes/LatexShapeUtil";
import { TableShapeUtil } from "./shapes/TableShapeUtil";
import { FlowchartShapeUtil } from "./shapes/FlowchartShapeUtil";
import { SpatialManager, ContentType, SPACING } from "./SpatialManager";

// ============================================
// LAYOUT CONFIGURATION
// ============================================
const LAYOUT = {
  CONTENT_WIDTH: 600,
  TEXT_SIZES: {
    small: { fontSize: 16, lineHeight: 20 },
    medium: { fontSize: 24, lineHeight: 30 },
    large: { fontSize: 36, lineHeight: 44 },
  },
  SHAPE_SIZES: {
    square: { w: 150, h: 150 },
    circle: { w: 150, h: 150 },
    triangle: { w: 180, h: 160 },
    right_triangle: { w: 150, h: 150 },
  },
  PLOT_SIZE: { w: 450, h: 350 },
  IMAGE_SIZE: { w: 500, h: 420 }, // Premium Bento Card size
};

// ============================================
// ANIMATION UTILITIES
// ============================================

/**
 * Typewriter effect for text content
 * Creates premium "AI is writing" feel
 */
function animateTypewriter(
  editor: Editor,
  shapeId: TLShapeId,
  shapeType: 'text' | 'latex',
  fullContent: string,
  propName: 'text' | 'latex',
  onComplete?: () => void
): void {
  let currentLength = 0;
  const charsPerFrame = 3; // Characters to add per frame
  const frameDelay = 16; // ~60fps

  const interval = setInterval(() => {
    currentLength += charsPerFrame;

    if (currentLength >= fullContent.length) {
      // Final update with complete text
      editor.updateShape({
        id: shapeId,
        type: shapeType,
        props: { [propName]: fullContent },
      });
      clearInterval(interval);
      onComplete?.();
    } else {
      // Partial text with cursor indicator
      const partialText = fullContent.substring(0, currentLength);
      editor.updateShape({
        id: shapeId,
        type: shapeType,
        props: { [propName]: partialText + " ●" },
      });
    }
  }, frameDelay);
}

/**
 * Fade-in effect for images and visual content
 */
function animateFadeIn(
  editor: Editor,
  shapeId: TLShapeId,
  shapeType: string,
  onComplete?: () => void
): void {
  let opacity = 0;
  const opacityStep = 0.05;
  const frameDelay = 30;

  const interval = setInterval(() => {
    opacity += opacityStep;

    if (opacity >= 1) {
      editor.updateShape({ id: shapeId, type: shapeType, opacity: 1 });
      clearInterval(interval);
      onComplete?.();
    } else {
      editor.updateShape({ id: shapeId, type: shapeType, opacity: opacity });
    }
  }, frameDelay);
}

/**
 * Cinematic camera pan to focus on new content
 * "Follow the pen" - slides to new content without zooming out
 */
function panToShape(
  editor: Editor,
  shapeId: TLShapeId,
  immediate: boolean = false
): void {
  const shape = editor.getShape(shapeId);
  if (!shape) return;

  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) return;

  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight - 40; // Account for header

  // Fixed zoom level - close enough to read comfortably
  const targetZoom = 1;

  // Calculate camera position to center the shape in viewport
  // Camera x/y in tldraw is the offset, so we need to position it
  // so the shape center appears at viewport center
  const shapeCenterX = bounds.minX + bounds.width / 2;
  const shapeCenterY = bounds.minY + bounds.height / 2;

  // Camera position = viewport center offset - shape center
  const cameraX = (viewportWidth / 2) / targetZoom - shapeCenterX;
  const cameraY = (viewportHeight / 2) / targetZoom - shapeCenterY;

  if (immediate) {
    editor.setCamera({ x: cameraX, y: cameraY, z: targetZoom });
  } else {
    // Smooth animated pan with easing
    const startCamera = editor.getCamera();
    const duration = 800;
    const startTime = performance.now();

    // Smooth ease-in-out function
    const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOut(progress);

      const currentX = startCamera.x + (cameraX - startCamera.x) * eased;
      const currentY = startCamera.y + (cameraY - startCamera.y) * eased;
      const currentZ = startCamera.z + (targetZoom - startCamera.z) * eased;

      editor.setCamera({ x: currentX, y: currentY, z: currentZ });

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }
}

// ============================================
// TOOL HANDLERS
// ============================================

interface ToolParams {
  content?: string;
  size?: "small" | "medium" | "large";
  shape_type?: "square" | "circle" | "triangle" | "right_triangle";
  color?: string;
  equation?: string;
  query?: string;
  url?: string;
  alt?: string;
  headers?: string[];
  rows?: string[][];
  steps?: string[];
  topic?: string; // Optional topic name for frame labeling
  // Annotation tool params (0-1000 normalized coordinates)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  from_x?: number;
  from_y?: number;
  to_x?: number;
  to_y?: number;
  label?: string;
  text?: string;
}

// Check if content contains LaTeX math notation
function containsLatex(content: string): boolean {
  const latexPatterns = [
    /\\\w+/,
    /\^{/,
    /_{/,
    /\\[(\[]/,
    /\$.*\$/,
    /\$\$.*\$\$/,
  ];
  return latexPatterns.some((pattern) => pattern.test(content));
}

// Fix escaping issues from JSON
function fixEscaping(content: string): string {
  return content.replace(/\\\\/g, '\\');
}

// Convert mixed text+LaTeX content to pure LaTeX for KaTeX
function convertToKatex(content: string): string {
  let fixed = fixEscaping(content.trim());

  // Remove $$ delimiters if present
  if (fixed.startsWith('$$') && fixed.endsWith('$$')) {
    return fixed.slice(2, -2).trim();
  }

  // Remove $ delimiters if present
  if (fixed.startsWith('$') && fixed.endsWith('$') && (fixed.match(/\$/g) || []).length === 2) {
    return fixed.slice(1, -1).trim();
  }

  // If content contains LaTeX commands (like \frac, \lim, \sum), pass it directly
  // This handles cases where agent sends raw LaTeX without $ delimiters
  if (/\\[a-zA-Z]+/.test(fixed)) {
    return fixed;
  }

  // Otherwise, try to parse mixed text+LaTeX with $ delimiters
  const parts = fixed.split(/(\$[^$]+\$)/g);
  let result = '';

  for (const part of parts) {
    if (part.startsWith('$') && part.endsWith('$')) {
      result += part.slice(1, -1);
    } else if (part.trim()) {
      result += `\\text{${part}}`;
    }
  }

  return result;
}

// Strip markdown formatting for plain text display
function stripMarkdown(content: string): string {
  let stripped = content.trim();
  stripped = stripped.replace(/^#{1,6}\s+/, '');
  stripped = stripped.replace(/\*\*(.*?)\*\*/g, '$1');
  stripped = stripped.replace(/\*(.*?)\*/g, '$1');
  stripped = stripped.replace(/`(.*?)`/g, '$1');
  return stripped;
}

// ============================================
// INDIVIDUAL TOOL HANDLERS WITH ANIMATIONS
// ============================================

function handleAddText(
  editor: Editor,
  spatial: SpatialManager,
  params: ToolParams
): void {
  const { content = "", size = "medium", topic } = params;
  const shapeId = createShapeId();

  const sizeConfig = LAYOUT.TEXT_SIZES[size] || LAYOUT.TEXT_SIZES.medium;
  const isLatex = containsLatex(content);

  let contentType: ContentType = isLatex ? 'latex' : 'text';
  let finalContent: string;
  let estimatedHeight: number;

  if (isLatex) {
    finalContent = convertToKatex(content);
    estimatedHeight = sizeConfig.fontSize * 2.5;
  } else {
    finalContent = stripMarkdown(content);
    const lines = Math.ceil(finalContent.length / 60) || 1;
    estimatedHeight = lines * sizeConfig.lineHeight + 20;
  }

  // Get spatial position
  const pos = spatial.getPosition(contentType, estimatedHeight);

  if (isLatex) {
    // Create LaTeX shape (start empty for animation)
    editor.createShapes([{
      id: shapeId,
      type: "latex",
      x: pos.x,
      y: pos.y,
      props: {
        w: 600,
        h: estimatedHeight,
        latex: "", // Start empty
        fontSize: sizeConfig.fontSize,
      },
    }]);

    // Register with spatial manager
    spatial.registerShape(shapeId, estimatedHeight, pos.isNewCluster, topic);

    // Animate camera then typewriter
    panToShape(editor, shapeId);
    setTimeout(() => {
      animateTypewriter(editor, shapeId, 'latex', finalContent, 'latex');
    }, 300);

  } else {
    // Create text shape (start empty for animation)
    editor.createShapes([{
      id: shapeId,
      type: "text",
      x: pos.x,
      y: pos.y,
      props: {
        text: "", // Start empty
        size: size === "small" ? "s" : size === "large" ? "xl" : "l",
        color: "black",
        font: "sans",
        autoSize: true,
      },
    }]);

    // Register with spatial manager
    spatial.registerShape(shapeId, estimatedHeight, pos.isNewCluster, topic);

    // Animate camera then typewriter
    panToShape(editor, shapeId);
    setTimeout(() => {
      animateTypewriter(editor, shapeId, 'text', finalContent, 'text');
    }, 300);
  }

  console.log(`[add_text] Created ${contentType} at (${pos.x}, ${pos.y}), newCluster: ${pos.isNewCluster}`);
}

function handleAddShape(
  editor: Editor,
  spatial: SpatialManager,
  params: ToolParams
): void {
  const { shape_type = "square", color = "blue", topic } = params;
  const size = LAYOUT.SHAPE_SIZES[shape_type] || LAYOUT.SHAPE_SIZES.square;
  const pos = spatial.getPosition('shape', size.h);

  // Handle right_triangle specially
  if (shape_type === "right_triangle") {
    const baseId = createShapeId();
    const heightLineId = createShapeId();
    const hypId = createShapeId();
    const markerId = createShapeId();

    // Base line
    editor.createShapes([{
      id: baseId,
      type: "line",
      x: pos.x,
      y: pos.y + size.h,
      opacity: 0,
      props: {
        color: color as any,
        size: "l",
        points: {
          a1: { id: "a1", index: "a1", x: 0, y: 0 },
          a2: { id: "a2", index: "a2", x: size.w, y: 0 },
        },
      },
    }]);

    // Height line
    editor.createShapes([{
      id: heightLineId,
      type: "line",
      x: pos.x,
      y: pos.y,
      opacity: 0,
      props: {
        color: color as any,
        size: "l",
        points: {
          a1: { id: "a1", index: "a1", x: 0, y: 0 },
          a2: { id: "a2", index: "a2", x: 0, y: size.h },
        },
      },
    }]);

    // Hypotenuse
    editor.createShapes([{
      id: hypId,
      type: "line",
      x: pos.x,
      y: pos.y,
      opacity: 0,
      props: {
        color: color as any,
        size: "l",
        points: {
          a1: { id: "a1", index: "a1", x: 0, y: 0 },
          a2: { id: "a2", index: "a2", x: size.w, y: size.h },
        },
      },
    }]);

    // Right angle marker
    editor.createShapes([{
      id: markerId,
      type: "geo",
      x: pos.x,
      y: pos.y + size.h - 20,
      opacity: 0,
      props: {
        geo: "rectangle",
        color: color as any,
        w: 20,
        h: 20,
        fill: "none",
        size: "s",
      },
    }]);

    spatial.registerShape(baseId, size.h, pos.isNewCluster, topic);
    panToShape(editor, baseId);

    // Fade in all lines
    setTimeout(() => {
      animateFadeIn(editor, baseId, 'line');
      animateFadeIn(editor, heightLineId, 'line');
      animateFadeIn(editor, hypId, 'line');
      animateFadeIn(editor, markerId, 'geo');
    }, 300);

    console.log(`[add_shape] Created right_triangle at (${pos.x}, ${pos.y})`);
    return;
  }

  // Standard shapes
  const shapeMap: Record<string, string> = {
    square: "rectangle",
    circle: "ellipse",
    triangle: "triangle",
  };

  const shapeId = createShapeId();

  editor.createShapes([{
    id: shapeId,
    type: "geo",
    x: pos.x,
    y: pos.y,
    opacity: 0, // Start invisible
    props: {
      geo: shapeMap[shape_type] || "rectangle",
      color: color as any,
      w: size.w,
      h: size.h,
      fill: "none",
      size: "l",
    },
  }]);

  spatial.registerShape(shapeId, size.h, pos.isNewCluster, topic);
  panToShape(editor, shapeId);

  setTimeout(() => {
    animateFadeIn(editor, shapeId, 'geo');
  }, 300);

  console.log(`[add_shape] Created ${shape_type} at (${pos.x}, ${pos.y})`);
}

function handlePlotFunction(
  editor: Editor,
  spatial: SpatialManager,
  params: ToolParams
): void {
  const { equation = "x^2", topic } = params;
  const shapeId = createShapeId();
  const pos = spatial.getPosition('plot', LAYOUT.PLOT_SIZE.h);

  editor.createShapes([{
    id: shapeId,
    type: "plot",
    x: pos.x,
    y: pos.y,
    opacity: 0, // Start invisible
    props: {
      w: LAYOUT.PLOT_SIZE.w,
      h: LAYOUT.PLOT_SIZE.h,
      equation: equation,
      xDomain: [-10, 10],
      yDomain: [-10, 10],
      color: "#3b82f6",
    },
  }]);

  spatial.registerShape(shapeId, LAYOUT.PLOT_SIZE.h, pos.isNewCluster, topic || `Plot: ${equation}`);
  panToShape(editor, shapeId);

  setTimeout(() => {
    animateFadeIn(editor, shapeId, 'plot');
  }, 300);

  console.log(`[plot_function] Created plot for "${equation}" at (${pos.x}, ${pos.y})`);
}

async function handleShowImage(
  editor: Editor,
  spatial: SpatialManager,
  params: ToolParams
): Promise<void> {
  const { query, url, alt = "Image", topic } = params;
  const shapeId = createShapeId();
  const pos = spatial.getPosition('image', LAYOUT.IMAGE_SIZE.h);

  let imageUrl = url || "";

  // If query is provided, search for the image
  if (query && !url) {
    try {
      const response = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data.url) {
        imageUrl = data.url;
      } else {
        console.warn(`[show_image] No image found for query: ${query}`);
        // Create placeholder text
        editor.createShapes([{
          id: shapeId,
          type: "text",
          x: pos.x,
          y: pos.y,
          props: {
            text: `[Image: ${query}]`,
            size: "m",
            color: "grey",
            font: "sans",
          },
        }]);
        spatial.registerShape(shapeId, 40, pos.isNewCluster, topic);
        panToShape(editor, shapeId);
        return;
      }
    } catch (error) {
      console.error(`[show_image] Search failed:`, error);
      editor.createShapes([{
        id: shapeId,
        type: "text",
        x: pos.x,
        y: pos.y,
        props: {
          text: `[Image: ${query}]`,
          size: "m",
          color: "grey",
          font: "sans",
        },
      }]);
      spatial.registerShape(shapeId, 40, pos.isNewCluster, topic);
      panToShape(editor, shapeId);
      return;
    }
  }

  // Determine the title for the card
  const cardTitle = topic || alt || query || "Concept";

  editor.createShapes([{
    id: shapeId,
    type: "tutor-image",
    x: pos.x,
    y: pos.y,
    opacity: 0, // Start invisible for fade-in
    props: {
      w: LAYOUT.IMAGE_SIZE.w,
      h: LAYOUT.IMAGE_SIZE.h,
      url: imageUrl,
      alt: alt || query || "Image",
      title: cardTitle, // Premium card title
    },
  }]);

  spatial.registerShape(shapeId, LAYOUT.IMAGE_SIZE.h, pos.isNewCluster, cardTitle);
  panToShape(editor, shapeId);

  setTimeout(() => {
    animateFadeIn(editor, shapeId, 'tutor-image');
  }, 300);

  console.log(`[show_image] Created image at (${pos.x}, ${pos.y}), url=${imageUrl}`);
}

function handleClearBoard(editor: Editor, spatial: SpatialManager): void {
  const allShapeIds = editor.getCurrentPageShapeIds();
  if (allShapeIds.size > 0) {
    editor.deleteShapes(Array.from(allShapeIds));
  }
  spatial.reset();

  // Reset camera to origin
  editor.setCamera({ x: 0, y: 0, z: 1 });

  console.log("[clear_board] Board cleared, spatial manager reset");
}

function handleDrawTable(
  editor: Editor,
  spatial: SpatialManager,
  params: ToolParams
): void {
  const { headers = ["Column 1", "Column 2"], rows = [], topic } = params;
  const shapeId = createShapeId();

  const numRows = rows.length + 1;
  const estimatedHeight = numRows * 40 + 20;
  const estimatedWidth = Math.max(400, headers.length * 150);

  const pos = spatial.getPosition('table', estimatedHeight);

  editor.createShapes([{
    id: shapeId,
    type: "table",
    x: pos.x,
    y: pos.y,
    opacity: 0, // Start invisible
    props: {
      w: estimatedWidth,
      h: estimatedHeight,
      headers,
      rows,
    },
  }]);

  spatial.registerShape(shapeId, estimatedHeight, pos.isNewCluster, topic || 'Data Table');
  panToShape(editor, shapeId);

  setTimeout(() => {
    animateFadeIn(editor, shapeId, 'table');
  }, 300);

  console.log(`[draw_table] Created table at (${pos.x}, ${pos.y})`);
}

function handleDrawFlowchart(
  editor: Editor,
  spatial: SpatialManager,
  params: ToolParams
): void {
  const { steps = ["Step 1", "Step 2"], topic } = params;
  const shapeId = createShapeId();

  const estimatedHeight = steps.length * 70 + 20;
  const pos = spatial.getPosition('flowchart', estimatedHeight);

  editor.createShapes([{
    id: shapeId,
    type: "flowchart",
    x: pos.x,
    y: pos.y,
    opacity: 0, // Start invisible
    props: {
      w: 300,
      h: estimatedHeight,
      steps,
    },
  }]);

  spatial.registerShape(shapeId, estimatedHeight, pos.isNewCluster, topic || 'Process Flow');
  panToShape(editor, shapeId);

  setTimeout(() => {
    animateFadeIn(editor, shapeId, 'flowchart');
  }, 300);

  console.log(`[draw_flowchart] Created flowchart at (${pos.x}, ${pos.y})`);
}

// ============================================
// ANNOTATION HANDLERS (Vision-Aware)
// ============================================

/**
 * Convert 0-1000 normalized coordinates to canvas page coordinates.
 * Gemini sees the viewport; we need to map to tldraw's infinite canvas.
 */
function normalizedToCanvas(
  editor: Editor,
  normX: number,
  normY: number
): { x: number; y: number } {
  const camera = editor.getCamera();
  const viewport = editor.getViewportScreenBounds();

  // Convert 0-1000 to 0-1
  const fracX = normX / 1000;
  const fracY = normY / 1000;

  // Convert to screen pixels
  const screenX = fracX * viewport.width;
  const screenY = fracY * viewport.height;

  // Convert to canvas page coordinates (accounting for zoom/pan)
  const pageX = (screenX / camera.z) - camera.x;
  const pageY = (screenY / camera.z) - camera.y;

  return { x: pageX, y: pageY };
}

function handleHighlightArea(editor: Editor, params: ToolParams): void {
  const { x = 500, y = 500, width = 100, height = 50, color = "yellow" } = params;

  const topLeft = normalizedToCanvas(editor, x, y);
  const bottomRight = normalizedToCanvas(editor, x + width, y + height);
  const w = bottomRight.x - topLeft.x;
  const h = bottomRight.y - topLeft.y;

  const shapeId = createShapeId();
  editor.createShapes([{
    id: shapeId,
    type: "geo",
    x: topLeft.x,
    y: topLeft.y,
    opacity: 0.3,
    props: {
      geo: "rectangle",
      w: Math.abs(w),
      h: Math.abs(h),
      color: color as any,
      fill: "solid",
    },
  }]);

  console.log(`[highlight_area] Created highlight at (${topLeft.x}, ${topLeft.y})`);
}

function handleDrawCircle(editor: Editor, params: ToolParams): void {
  const { x = 500, y = 500, radius = 30, color = "red" } = params;

  const center = normalizedToCanvas(editor, x, y);
  const edge = normalizedToCanvas(editor, x + radius, y);
  const r = Math.abs(edge.x - center.x);

  const shapeId = createShapeId();
  editor.createShapes([{
    id: shapeId,
    type: "geo",
    x: center.x - r,
    y: center.y - r,
    props: {
      geo: "ellipse",
      w: r * 2,
      h: r * 2,
      color: color as any,
      fill: "none",
      size: "l",
    },
  }]);

  console.log(`[draw_circle] Created circle at (${center.x}, ${center.y})`);
}

function handleDrawArrow(editor: Editor, params: ToolParams): void {
  const { from_x = 400, from_y = 400, to_x = 600, to_y = 600, label = "" } = params;

  const start = normalizedToCanvas(editor, from_x, from_y);
  const end = normalizedToCanvas(editor, to_x, to_y);

  const shapeId = createShapeId();
  editor.createShapes([{
    id: shapeId,
    type: "arrow",
    x: start.x,
    y: start.y,
    props: {
      start: { x: 0, y: 0 },
      end: { x: end.x - start.x, y: end.y - start.y },
      color: "red" as any,
      size: "l",
      text: label,
    },
  }]);

  console.log(`[draw_arrow] Created arrow from (${start.x}, ${start.y}) to (${end.x}, ${end.y})`);
}

function handleAddAnnotation(editor: Editor, params: ToolParams): void {
  const { x = 500, y = 500, text = "", color = "blue" } = params;

  const pos = normalizedToCanvas(editor, x, y);

  const shapeId = createShapeId();
  editor.createShapes([{
    id: shapeId,
    type: "text",
    x: pos.x,
    y: pos.y,
    props: {
      text: text,
      size: "m",
      color: color as any,
      font: "sans",
    },
  }]);

  console.log(`[add_annotation] Created annotation at (${pos.x}, ${pos.y}): ${text}`);
}

// ============================================
// MAIN TOOL CALL HANDLER
// ============================================
export async function handleToolCall(
  editor: Editor,
  spatial: SpatialManager,
  toolName: string,
  params: ToolParams
): Promise<void> {
  console.log(`[handleToolCall] Tool: ${toolName}, Params:`, params);

  switch (toolName) {
    case "add_text":
      handleAddText(editor, spatial, params);
      break;
    case "add_shape":
      handleAddShape(editor, spatial, params);
      break;
    case "plot_function":
      handlePlotFunction(editor, spatial, params);
      break;
    case "show_image":
      await handleShowImage(editor, spatial, params);
      break;
    case "clear_board":
      handleClearBoard(editor, spatial);
      break;
    case "draw_table":
      handleDrawTable(editor, spatial, params);
      break;
    case "draw_flowchart":
      handleDrawFlowchart(editor, spatial, params);
      break;
    // Annotation tools (vision-aware)
    case "highlight_area":
      handleHighlightArea(editor, params);
      break;
    case "draw_circle":
      handleDrawCircle(editor, params);
      break;
    case "draw_arrow":
      handleDrawArrow(editor, params);
      break;
    case "add_annotation":
      handleAddAnnotation(editor, params);
      break;
    default:
      console.warn(`[handleToolCall] Unknown tool: ${toolName}`);
  }
}

// ============================================
// CANVAS LISTENER COMPONENT
// ============================================
function CanvasListener() {
  const room = useRoomContext();
  const editor = useEditor();
  const spatialRef = useRef<SpatialManager | null>(null);

  // Initialize spatial manager when editor is ready
  useEffect(() => {
    if (editor && !spatialRef.current) {
      spatialRef.current = new SpatialManager(editor);
    }
  }, [editor]);

  useEffect(() => {
    if (!room || !editor || !spatialRef.current) return;

    console.log("CanvasListener initialized with SpatialManager");

    const handleData = (
      payload: Uint8Array,
      _participant?: any,
      _kind?: any,
      topic?: string
    ) => {
      if (!topic || topic !== "tutor_draw") return;
      if (!spatialRef.current) return;

      try {
        const str = new TextDecoder().decode(payload);
        const msg = JSON.parse(str);
        console.log("Received message:", msg);

        // Handle tool call format: { tool: "tool_name", params: {...} }
        if (msg.tool && typeof msg.tool === "string") {
          handleToolCall(editor, spatialRef.current, msg.tool, msg.params || {});
        }
        // Legacy format support
        else if (msg.action) {
          const legacyToolMap: Record<string, string> = {
            write_text: "add_text",
            draw_shape: "add_shape",
            clear_board: "clear_board",
          };
          const toolName = legacyToolMap[msg.action] || msg.action;
          const params = msg.data || {};

          if (msg.action === "write_text") {
            params.content = params.text;
          }
          if (msg.action === "draw_shape") {
            params.shape_type = params.shape;
          }

          handleToolCall(editor, spatialRef.current, toolName, params);
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    };

    room.on("dataReceived", handleData);
    return () => {
      room.off("dataReceived", handleData);
    };
  }, [room, editor]);

  return null;
}

// ============================================
// HIDE UI COMPONENTS
// ============================================
const components: TLComponents = {
  Toolbar: null,
  MainMenu: null,
  PageMenu: null,
  NavigationPanel: null,
  ZoomMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  HelperButtons: null,
  DebugMenu: null,
  DebugPanel: null,
  StylePanel: null,
  KeyboardShortcutsDialog: null,
  HelpMenu: null,
  MenuPanel: null,
  Minimap: null,
};

// ============================================
// CUSTOM SHAPE UTILS
// ============================================
const customShapeUtils = [PlotShapeUtil, TutorImageShapeUtil, LatexShapeUtil, TableShapeUtil, FlowchartShapeUtil];

// ============================================
// MAIN COMPONENT
// ============================================
export default function TutorCanvas() {
  const handleMount = useMemo(
    () => (editor: Editor) => {
      // Start with camera at origin
      editor.setCamera({ x: 100, y: 50, z: 1 });
      console.log("TutorCanvas mounted with SpatialManager");
    },
    []
  );

  return (
    <div style={{ position: "fixed", inset: 0, top: 40 }}>
      <Tldraw
        shapeUtils={customShapeUtils}
        components={components}
        hideUi={true}
        onMount={handleMount}
      >
        <CanvasListener />
      </Tldraw>
    </div>
  );
}
