"use client";
import { useEffect, useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import type { Room } from "livekit-client";

// ============================================
// TYPES
// ============================================

interface ToolParams {
  content?: string;
  size?: "small" | "medium" | "large";
  query?: string;
  url?: string;
  alt?: string;
  headers?: string[];
  rows?: string[][];
  steps?: string[];
  topic?: string;
  // Annotation params (0-1000 normalized coordinates)
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
  color?: string;
}

interface ExcalidrawToolHandlerProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  room: Room;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Generate a unique ID for Excalidraw elements
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Convert normalized coordinates (0-1000) to Excalidraw scene coordinates.
 *
 * The AI sends coordinates in a 0-1000 normalized space.
 * We need to convert to Excalidraw's scene coordinate system.
 */
function normalizedToExcalidraw(
  excalidrawAPI: ExcalidrawImperativeAPI,
  normX: number,
  normY: number
): { x: number; y: number } {
  const appState = excalidrawAPI.getAppState();

  // Get canvas dimensions
  const width = appState.width || window.innerWidth;
  const height = appState.height || window.innerHeight;

  // Get current scroll and zoom
  const scrollX = appState.scrollX || 0;
  const scrollY = appState.scrollY || 0;
  const zoom = appState.zoom?.value || 1;

  // Convert normalized (0-1000) to screen pixels
  const screenX = (normX / 1000) * width;
  const screenY = (normY / 1000) * height;

  // Convert screen to scene coords (reverse the pan/zoom transform)
  const sceneX = (screenX / zoom) - scrollX;
  const sceneY = (screenY / zoom) - scrollY;

  return { x: sceneX, y: sceneY };
}

/**
 * Convert normalized size to scene size
 */
function normalizedSizeToExcalidraw(
  excalidrawAPI: ExcalidrawImperativeAPI,
  normSize: number
): number {
  const appState = excalidrawAPI.getAppState();
  const width = appState.width || window.innerWidth;
  const zoom = appState.zoom?.value || 1;

  return (normSize / 1000) * width / zoom;
}

/**
 * Map color names to hex values
 */
function colorToHex(color: string): string {
  const colorMap: Record<string, string> = {
    red: "#e03131",
    blue: "#1971c2",
    green: "#2f9e44",
    yellow: "#f08c00",
    orange: "#e8590c",
    purple: "#9c36b5",
    pink: "#c2255c",
    black: "#1e1e1e",
    white: "#ffffff",
  };
  return colorMap[color.toLowerCase()] || color;
}

/**
 * Get font size based on size parameter
 */
function getFontSize(size: "small" | "medium" | "large"): number {
  const sizeMap = {
    small: 16,
    medium: 24,
    large: 36,
  };
  return sizeMap[size] || 24;
}

// ============================================
// ELEMENT CREATORS
// ============================================

/**
 * Create a base Excalidraw element with common properties
 */
function createBaseElement(
  type: ExcalidrawElement["type"],
  x: number,
  y: number,
  width: number,
  height: number
): Partial<ExcalidrawElement> {
  return {
    id: generateId(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

/**
 * Create a text element
 */
function createTextElement(
  x: number,
  y: number,
  text: string,
  fontSize: number = 24,
  color: string = "#1e1e1e"
): ExcalidrawElement {
  return {
    ...createBaseElement("text", x, y, 0, 0),
    type: "text",
    text,
    fontSize,
    fontFamily: 1, // Virgil (hand-drawn)
    textAlign: "left",
    verticalAlign: "top",
    strokeColor: color,
    originalText: text,
    lineHeight: 1.25,
  } as ExcalidrawElement;
}

/**
 * Create a rectangle element (for highlights)
 */
function createRectangleElement(
  x: number,
  y: number,
  width: number,
  height: number,
  strokeColor: string = "#f08c00",
  backgroundColor: string = "transparent",
  fillStyle: "solid" | "hachure" | "cross-hatch" = "solid"
): ExcalidrawElement {
  return {
    ...createBaseElement("rectangle", x, y, width, height),
    type: "rectangle",
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeWidth: 3,
    roundness: { type: 3 }, // Rounded corners
  } as ExcalidrawElement;
}

/**
 * Create an ellipse element (for circles)
 */
function createEllipseElement(
  x: number,
  y: number,
  width: number,
  height: number,
  strokeColor: string = "#e03131"
): ExcalidrawElement {
  return {
    ...createBaseElement("ellipse", x, y, width, height),
    type: "ellipse",
    strokeColor,
    strokeWidth: 3,
  } as ExcalidrawElement;
}

/**
 * Create an arrow element
 */
function createArrowElement(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  strokeColor: string = "#e03131"
): ExcalidrawElement {
  const width = endX - startX;
  const height = endY - startY;

  return {
    ...createBaseElement("arrow", startX, startY, width, height),
    type: "arrow",
    strokeColor,
    strokeWidth: 3,
    points: [
      [0, 0],
      [width, height],
    ],
    startArrowhead: null,
    endArrowhead: "arrow",
  } as ExcalidrawElement;
}

/**
 * Create an image element
 */
function createImageElement(
  x: number,
  y: number,
  width: number,
  height: number,
  fileId: string
): ExcalidrawElement {
  return {
    ...createBaseElement("image", x, y, width, height),
    type: "image",
    fileId,
    status: "saved",
    scale: [1, 1],
  } as ExcalidrawElement;
}

// ============================================
// TOOL HANDLERS
// ============================================

// Track annotation element IDs for clear_annotations
let annotationIds: Set<string> = new Set();

function handleClearBoard(excalidrawAPI: ExcalidrawImperativeAPI): void {
  excalidrawAPI.resetScene();
  annotationIds.clear();
  console.log("[clear_board] Canvas reset");
}

function handleAddText(
  excalidrawAPI: ExcalidrawImperativeAPI,
  params: ToolParams
): void {
  const { content = "", size = "medium", x, y } = params;

  const elements = excalidrawAPI.getSceneElements();
  const fontSize = getFontSize(size);

  let posX: number, posY: number;

  if (x !== undefined && y !== undefined) {
    // Use provided normalized coordinates
    const pos = normalizedToExcalidraw(excalidrawAPI, x, y);
    posX = pos.x;
    posY = pos.y;
  } else {
    // Auto-position: find lowest element and add below
    const appState = excalidrawAPI.getAppState();
    const scrollX = appState.scrollX || 0;
    const scrollY = appState.scrollY || 0;

    if (elements.length === 0) {
      // Start near top-left of visible area
      posX = -scrollX + 50;
      posY = -scrollY + 50;
    } else {
      // Find the bottommost element
      let maxY = -Infinity;
      for (const el of elements) {
        const bottom = el.y + (el.height || 0);
        if (bottom > maxY) maxY = bottom;
      }
      posX = -scrollX + 50;
      posY = maxY + 40; // Add spacing
    }
  }

  const textElement = createTextElement(posX, posY, content, fontSize);

  excalidrawAPI.updateScene({
    elements: [...elements, textElement],
  });

  console.log(`[add_text] Added "${content}" at (${posX.toFixed(0)}, ${posY.toFixed(0)})`);
}

function handleHighlightArea(
  excalidrawAPI: ExcalidrawImperativeAPI,
  params: ToolParams
): void {
  const { x = 500, y = 500, width = 100, height = 50, color = "yellow" } = params;

  const topLeft = normalizedToExcalidraw(excalidrawAPI, x, y);
  const bottomRight = normalizedToExcalidraw(excalidrawAPI, x + width, y + height);
  const w = bottomRight.x - topLeft.x;
  const h = bottomRight.y - topLeft.y;

  const elements = excalidrawAPI.getSceneElements();
  const rectElement = createRectangleElement(
    topLeft.x,
    topLeft.y,
    Math.abs(w),
    Math.abs(h),
    colorToHex(color),
    colorToHex(color) + "40", // Semi-transparent fill
    "solid"
  );

  annotationIds.add(rectElement.id);

  excalidrawAPI.updateScene({
    elements: [...elements, rectElement],
  });

  console.log(`[highlight_area] Created at (${topLeft.x.toFixed(0)}, ${topLeft.y.toFixed(0)}), size: ${w.toFixed(0)}x${h.toFixed(0)}`);
}

function handleDrawCircle(
  excalidrawAPI: ExcalidrawImperativeAPI,
  params: ToolParams
): void {
  const { x = 500, y = 500, radius = 30, color = "red" } = params;

  const center = normalizedToExcalidraw(excalidrawAPI, x, y);
  const radiusSize = normalizedSizeToExcalidraw(excalidrawAPI, radius);

  const elements = excalidrawAPI.getSceneElements();
  const ellipseElement = createEllipseElement(
    center.x - radiusSize,
    center.y - radiusSize,
    radiusSize * 2,
    radiusSize * 2,
    colorToHex(color)
  );

  annotationIds.add(ellipseElement.id);

  excalidrawAPI.updateScene({
    elements: [...elements, ellipseElement],
  });

  console.log(`[draw_circle] Created at (${center.x.toFixed(0)}, ${center.y.toFixed(0)}), radius: ${radiusSize.toFixed(0)}`);
}

function handleDrawArrow(
  excalidrawAPI: ExcalidrawImperativeAPI,
  params: ToolParams
): void {
  const { from_x = 400, from_y = 400, to_x = 600, to_y = 600, color = "red" } = params;

  const start = normalizedToExcalidraw(excalidrawAPI, from_x, from_y);
  const end = normalizedToExcalidraw(excalidrawAPI, to_x, to_y);

  const elements = excalidrawAPI.getSceneElements();
  const arrowElement = createArrowElement(
    start.x,
    start.y,
    end.x,
    end.y,
    colorToHex(color)
  );

  annotationIds.add(arrowElement.id);

  excalidrawAPI.updateScene({
    elements: [...elements, arrowElement],
  });

  console.log(`[draw_arrow] Created from (${start.x.toFixed(0)}, ${start.y.toFixed(0)}) to (${end.x.toFixed(0)}, ${end.y.toFixed(0)})`);
}

function handleAddAnnotation(
  excalidrawAPI: ExcalidrawImperativeAPI,
  params: ToolParams
): void {
  const { x = 500, y = 500, text = "", color = "blue" } = params;

  const pos = normalizedToExcalidraw(excalidrawAPI, x, y);

  const elements = excalidrawAPI.getSceneElements();
  const textElement = createTextElement(pos.x, pos.y, text, 20, colorToHex(color));

  annotationIds.add(textElement.id);

  excalidrawAPI.updateScene({
    elements: [...elements, textElement],
  });

  console.log(`[add_annotation] Added "${text}" at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`);
}

function handleClearAnnotations(excalidrawAPI: ExcalidrawImperativeAPI): void {
  const elements = excalidrawAPI.getSceneElements();
  const filtered = elements.filter((el) => !annotationIds.has(el.id));

  const removedCount = elements.length - filtered.length;

  excalidrawAPI.updateScene({
    elements: filtered,
  });

  annotationIds.clear();

  console.log(`[clear_annotations] Removed ${removedCount} annotations`);
}

async function handleShowImage(
  excalidrawAPI: ExcalidrawImperativeAPI,
  params: ToolParams
): Promise<void> {
  const { query, url, x, y } = params;

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
        // Add placeholder text instead
        handleAddText(excalidrawAPI, { content: `[Image: ${query}]`, size: "medium", x, y });
        return;
      }
    } catch (error) {
      console.error(`[show_image] Search failed:`, error);
      handleAddText(excalidrawAPI, { content: `[Image: ${query}]`, size: "medium", x, y });
      return;
    }
  }

  if (!imageUrl) {
    console.warn(`[show_image] No URL or query provided`);
    return;
  }

  try {
    // Fetch the image and convert to data URL
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

    // Get image dimensions
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = dataUrl;
    });

    // Scale image to reasonable size (max 500px width)
    const maxWidth = 500;
    const scale = Math.min(1, maxWidth / img.width);
    const width = img.width * scale;
    const height = img.height * scale;

    // Generate file ID for Excalidraw
    const fileId = generateId();

    // Determine position
    let posX: number, posY: number;
    if (x !== undefined && y !== undefined) {
      const pos = normalizedToExcalidraw(excalidrawAPI, x, y);
      posX = pos.x;
      posY = pos.y;
    } else {
      // Auto-position below existing content
      const elements = excalidrawAPI.getSceneElements();
      const appState = excalidrawAPI.getAppState();
      const scrollX = appState.scrollX || 0;
      const scrollY = appState.scrollY || 0;

      if (elements.length === 0) {
        posX = -scrollX + 50;
        posY = -scrollY + 50;
      } else {
        let maxY = -Infinity;
        for (const el of elements) {
          const bottom = el.y + (el.height || 0);
          if (bottom > maxY) maxY = bottom;
        }
        posX = -scrollX + 50;
        posY = maxY + 40;
      }
    }

    // Create image element
    const elements = excalidrawAPI.getSceneElements();
    const imageElement = createImageElement(posX, posY, width, height, fileId);

    // Add the file to Excalidraw's file store
    const files = excalidrawAPI.getFiles();
    const mimeType = blob.type || "image/png";

    excalidrawAPI.updateScene({
      elements: [...elements, imageElement],
    });

    // Add file separately using addFiles
    excalidrawAPI.addFiles([
      {
        id: fileId,
        dataURL: dataUrl,
        mimeType: mimeType as any,
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    ]);

    console.log(`[show_image] Added image at (${posX.toFixed(0)}, ${posY.toFixed(0)}), size: ${width.toFixed(0)}x${height.toFixed(0)}`);
  } catch (error) {
    console.error(`[show_image] Failed to load image:`, error);
    handleAddText(excalidrawAPI, { content: `[Image failed: ${query || url}]`, size: "medium", x, y });
  }
}

// ============================================
// MAIN TOOL DISPATCHER
// ============================================

function handleToolCall(
  excalidrawAPI: ExcalidrawImperativeAPI,
  toolName: string,
  params: ToolParams
): void {
  console.log(`[handleToolCall] Tool: ${toolName}, Params:`, params);

  switch (toolName) {
    case "clear_board":
      handleClearBoard(excalidrawAPI);
      break;
    case "add_text":
      handleAddText(excalidrawAPI, params);
      break;
    case "highlight_area":
      handleHighlightArea(excalidrawAPI, params);
      break;
    case "draw_circle":
      handleDrawCircle(excalidrawAPI, params);
      break;
    case "draw_arrow":
      handleDrawArrow(excalidrawAPI, params);
      break;
    case "add_annotation":
      handleAddAnnotation(excalidrawAPI, params);
      break;
    case "clear_annotations":
      handleClearAnnotations(excalidrawAPI);
      break;
    case "show_image":
      handleShowImage(excalidrawAPI, params);
      break;
    // Tools that need more work (log but don't crash)
    case "draw_table":
    case "draw_flowchart":
    case "plot_function":
    case "draw_diagram":
      console.warn(`[handleToolCall] Tool "${toolName}" not yet implemented for Excalidraw`);
      break;
    // Lesson control tools (no canvas action needed)
    case "next_concept":
    case "finish_lesson":
      console.log(`[handleToolCall] Lesson control tool: ${toolName}`);
      break;
    default:
      console.warn(`[handleToolCall] Unknown tool: ${toolName}`);
  }
}

// ============================================
// COMPONENT
// ============================================

export function ExcalidrawToolHandler({ excalidrawAPI, room }: ExcalidrawToolHandlerProps) {
  const excalidrawAPIRef = useRef(excalidrawAPI);

  // Keep ref updated
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  // Subscribe to LiveKit data channel
  useEffect(() => {
    if (!room || !excalidrawAPI) return;

    console.log("[ExcalidrawToolHandler] Listening for tool calls on 'tutor_draw' topic");

    const handleData = (
      payload: Uint8Array,
      _participant?: any,
      _kind?: any,
      topic?: string
    ) => {
      // Only process messages on the tutor_draw topic
      if (!topic || topic !== "tutor_draw") return;

      try {
        const str = new TextDecoder().decode(payload);
        const msg = JSON.parse(str);
        console.log("[ExcalidrawToolHandler] Received:", msg);

        // Handle tool call format: { tool: "tool_name", params: {...} }
        if (msg.tool && typeof msg.tool === "string") {
          handleToolCall(excalidrawAPIRef.current, msg.tool, msg.params || {});
        }
        // Legacy format support (from older agent versions)
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

          handleToolCall(excalidrawAPIRef.current, toolName, params);
        }
      } catch (error) {
        console.error("[ExcalidrawToolHandler] Error processing message:", error);
      }
    };

    room.on("dataReceived", handleData);

    return () => {
      room.off("dataReceived", handleData);
    };
  }, [room, excalidrawAPI]);

  // This component doesn't render anything
  return null;
}
