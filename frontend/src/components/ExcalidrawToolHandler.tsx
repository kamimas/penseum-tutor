"use client";
import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";
import {
  SimpleDiagramInput,
  DiagramType,
  parseSimpleDiagram,
  computeLayout,
  getNodeShape,
  LayoutNode,
  LayoutEdge,
} from "../utils/diagramLayout";

// ============================================
// TYPES
// ============================================

// Using 'any' for ExcalidrawImperativeAPI to avoid type import issues
// The actual API is provided by @excalidraw/excalidraw at runtime
type ExcalidrawAPI = any;

// Position options for tools
type PositionType =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right"
  | "below-last" | "right-of-last";

interface ToolParams {
  content?: string;
  size?: "small" | "medium" | "large";
  query?: string;
  url?: string;
  x?: number;
  y?: number;
  position?: PositionType | string;
  // Diagram params
  type?: DiagramType;
  nodes?: (string | { label: string; style?: string })[];
  edges?: [number, number] | [number, number, string][];
  direction?: "TB" | "LR" | "BT" | "RL";
}

// Track last element for relative positioning (lookup current bounds when needed)
// For single elements: stores element ID
// For diagrams: stores groupId (prefixed with "group:")
let lastElementId: string | null = null;

interface ExcalidrawToolHandlerProps {
  excalidrawAPI: ExcalidrawAPI;
  room: Room;
}

// ============================================
// UTILITIES
// ============================================

function generateId(): string {
  return crypto.randomUUID();
}

function getFontSize(size: "small" | "medium" | "large"): number {
  const sizeMap = { small: 20, medium: 28, large: 40 };
  return sizeMap[size] || 28;
}

/**
 * Calculate position coordinates based on position string and viewport.
 * Returns { x, y } in scene coordinates.
 */
function calculatePosition(
  excalidrawAPI: ExcalidrawAPI,
  position: PositionType,
  elementWidth: number,
  elementHeight: number
): { x: number; y: number } {
  const appState = excalidrawAPI.getAppState();
  const { scrollX, scrollY, zoom, width: viewportWidth, height: viewportHeight } = appState;
  const zoomValue = zoom?.value || 1;

  // Calculate viewport bounds in scene coordinates
  const viewportLeft = -scrollX;
  const viewportTop = -scrollY;
  const viewportW = (viewportWidth || 1280) / zoomValue;
  const viewportH = (viewportHeight || 720) / zoomValue;

  // Padding from edges
  const padding = 50;

  // Handle relative positions - lookup current bounds from scene
  if (position === "below-last" || position === "right-of-last") {
    let lastBounds: { x: number; y: number; width: number; height: number } | null = null;

    if (lastElementId) {
      const elements = excalidrawAPI.getSceneElements();

      if (lastElementId.startsWith("group:")) {
        // Compute bounding box of all elements in the group
        const groupId = lastElementId.slice(6);
        const groupElements = elements.filter(
          (el: any) => !el.isDeleted && el.groupIds?.includes(groupId)
        );
        if (groupElements.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const el of groupElements) {
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + el.width);
            maxY = Math.max(maxY, el.y + el.height);
          }
          lastBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        }
      } else {
        // Single element lookup
        const lastElement = elements.find((el: any) => el.id === lastElementId && !el.isDeleted);
        if (lastElement) {
          lastBounds = {
            x: lastElement.x,
            y: lastElement.y,
            width: lastElement.width,
            height: lastElement.height,
          };
        }
      }
    }

    if (lastBounds) {
      if (position === "below-last") {
        return {
          x: lastBounds.x,
          y: lastBounds.y + lastBounds.height + 30,
        };
      } else {
        return {
          x: lastBounds.x + lastBounds.width + 30,
          y: lastBounds.y,
        };
      }
    }
    // Fall back to center if no last element found
    position = "center";
  }

  // Calculate grid positions (3x3)
  const colPositions = {
    left: viewportLeft + padding,
    center: viewportLeft + (viewportW - elementWidth) / 2,
    right: viewportLeft + viewportW - elementWidth - padding,
  };

  const rowPositions = {
    top: viewportTop + padding,
    middle: viewportTop + (viewportH - elementHeight) / 2,
    bottom: viewportTop + viewportH - elementHeight - padding,
  };

  // Map position string to coordinates
  switch (position) {
    case "top-left":
      return { x: colPositions.left, y: rowPositions.top };
    case "top-center":
      return { x: colPositions.center, y: rowPositions.top };
    case "top-right":
      return { x: colPositions.right, y: rowPositions.top };
    case "middle-left":
      return { x: colPositions.left, y: rowPositions.middle };
    case "center":
      return { x: colPositions.center, y: rowPositions.middle };
    case "middle-right":
      return { x: colPositions.right, y: rowPositions.middle };
    case "bottom-left":
      return { x: colPositions.left, y: rowPositions.bottom };
    case "bottom-center":
      return { x: colPositions.center, y: rowPositions.bottom };
    case "bottom-right":
      return { x: colPositions.right, y: rowPositions.bottom };
    default:
      // Default to center
      return { x: colPositions.center, y: rowPositions.middle };
  }
}

/**
 * Set the last element ID for relative positioning.
 */
function setLastElementId(id: string): void {
  lastElementId = id;
  console.log(`[Position] Updated lastElementId: ${id}`);
}

// ============================================
// TOOL HANDLERS
// ============================================

function handleClearBoard(excalidrawAPI: ExcalidrawAPI): void {
  excalidrawAPI.resetScene();
  console.log("[clear_board] Canvas reset");
}

// Measure text dimensions using canvas
function measureText(text: string, fontSize: number, fontFamily: number): { width: number; height: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: 100, height: fontSize * 1.5 };

  // Excalidraw font families: 1 = Virgil (hand-drawn), 2 = Helvetica, 3 = Cascadia
  const fontFamilyName = fontFamily === 1 ? "Virgil, Segoe UI Emoji" :
                         fontFamily === 2 ? "Helvetica, Segoe UI Emoji" :
                         "Cascadia, Segoe UI Emoji";

  ctx.font = `${fontSize}px ${fontFamilyName}`;

  const lines = text.split("\n");
  let maxWidth = 0;
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxWidth) maxWidth = metrics.width;
  }

  const lineHeight = fontSize * 1.25;
  const height = lines.length * lineHeight;

  return { width: Math.max(maxWidth, 10), height: Math.max(height, fontSize) };
}

function handleAddText(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): void {
  const { content = "", size = "medium", position = "center" } = params;

  if (!content) {
    console.warn("[add_text] No content provided");
    return;
  }

  const elements = excalidrawAPI.getSceneElements();
  const fontSize = getFontSize(size);
  const fontFamily = 1; // Virgil (hand-drawn style)

  // Measure text dimensions
  const { width, height } = measureText(content, fontSize, fontFamily);

  // Calculate position based on position parameter
  const { x: posX, y: posY } = calculatePosition(
    excalidrawAPI,
    position as PositionType,
    width,
    height
  );

  // Create text element with all required Excalidraw properties
  const elementId = generateId();
  const textElement = {
    id: elementId,
    type: "text" as const,
    x: posX,
    y: posY,
    width: width,
    height: height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0" as const,
    roundness: null,
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text: content,
    fontSize: fontSize,
    fontFamily: fontFamily,
    textAlign: "left" as const,
    verticalAlign: "top" as const,
    containerId: null,
    originalText: content,
    autoResize: true,
    lineHeight: 1.25,
  };

  excalidrawAPI.updateScene({
    elements: [...elements, textElement],
  });

  // Track for relative positioning
  setLastElementId(elementId);

  console.log(`[add_text] Added "${content.substring(0, 50)}..." at position="${position}" (${posX.toFixed(0)}, ${posY.toFixed(0)}), size: ${width.toFixed(0)}x${height.toFixed(0)}`);
}

async function handleShowImage(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): Promise<void> {
  const { query, url, position = "center" } = params;

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
        handleAddText(excalidrawAPI, { content: `[Image: ${query}]`, size: "medium" });
        return;
      }
    } catch (error) {
      console.error(`[show_image] Search failed:`, error);
      handleAddText(excalidrawAPI, { content: `[Image: ${query}]`, size: "medium" });
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

    // Generate IDs
    const fileId = generateId();
    const elementId = generateId();

    // Calculate position based on position parameter
    const elements = excalidrawAPI.getSceneElements();
    const { x: posX, y: posY } = calculatePosition(
      excalidrawAPI,
      position as PositionType,
      width,
      height
    );

    // Create image element
    const imageElement = {
      id: elementId,
      type: "image" as const,
      x: posX,
      y: posY,
      width,
      height,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      strokeWidth: 2,
      strokeStyle: "solid" as const,
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0" as const,
      roundness: null,
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      fileId,
      status: "saved" as const,
      scale: [1, 1] as [number, number],
    };

    excalidrawAPI.updateScene({
      elements: [...elements, imageElement],
    });

    // Add file to Excalidraw
    const mimeType = blob.type || "image/png";
    excalidrawAPI.addFiles([
      {
        id: fileId,
        dataURL: dataUrl,
        mimeType: mimeType as any,
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    ]);

    // Track for relative positioning
    setLastElementId(elementId);

    console.log(`[show_image] Added image at position="${position}" (${posX.toFixed(0)}, ${posY.toFixed(0)}), size: ${width.toFixed(0)}x${height.toFixed(0)}`);
  } catch (error) {
    console.error(`[show_image] Failed to load image:`, error);
    handleAddText(excalidrawAPI, { content: `[Image failed: ${query || url}]`, size: "medium", position });
  }
}

// ============================================
// DIAGRAM HANDLER - NATIVE EXCALIDRAW ELEMENTS
// ============================================

// Animation timing constants
const SHAPE_DELAY = 150;    // ms between shape appearing
const TEXT_DELAY = 100;     // ms after shape for text to appear
const ARROW_DELAY = 80;     // ms between arrows

function handleDrawDiagram(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): void {
  const { type = "flowchart", nodes = [], edges, direction = "TB", position = "center" } = params;

  if (!nodes || nodes.length === 0) {
    console.warn("[draw_diagram] No nodes provided");
    return;
  }

  // Parse the simplified input
  const input: SimpleDiagramInput = {
    type: type as DiagramType,
    nodes: nodes as any,
    edges: edges as any,
    direction,
  };

  const { nodes: parsedNodes, edges: parsedEdges } = parseSimpleDiagram(input);
  const layout = computeLayout(type as DiagramType, parsedNodes, parsedEdges, direction);

  // Get current scene elements
  const existingElements = excalidrawAPI.getSceneElements();

  // Calculate diagram bounding box from layout
  let diagramWidth = 0;
  let diagramHeight = 0;
  for (const node of layout.nodes) {
    const right = node.x + node.width;
    const bottom = node.y + node.height;
    if (right > diagramWidth) diagramWidth = right;
    if (bottom > diagramHeight) diagramHeight = bottom;
  }

  // Calculate position based on position parameter
  const { x: offsetX, y: offsetY } = calculatePosition(
    excalidrawAPI,
    position as PositionType,
    diagramWidth,
    diagramHeight
  );

  const groupId = generateId();

  // Build animation queue: each item is { element, delay }
  type AnimationItem = { element: any; delay: number };
  const animationQueue: AnimationItem[] = [];
  let currentDelay = 0;

  // Create node elements with staggered timing
  layout.nodes.forEach((node: LayoutNode) => {
    const nodeX = offsetX + node.x;
    const nodeY = offsetY + node.y;
    const shape = getNodeShape(node.style);
    const seed = Math.floor(Math.random() * 100000);

    // Create the shape element
    let shapeElement: any;

    if (shape === "diamond") {
      shapeElement = {
        id: generateId(),
        type: "diamond",
        x: nodeX,
        y: nodeY,
        width: node.width,
        height: node.height,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: node.style === "decision" ? "#fff9db" : "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [groupId],
        frameId: null,
        roundness: { type: 2 },
        seed,
        version: 1,
        versionNonce: Math.floor(Math.random() * 100000),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
      };
    } else if (shape === "ellipse") {
      const bgColor = node.style === "start" ? "#d3f9d8" :
                      node.style === "end" ? "#ffe3e3" : "transparent";
      shapeElement = {
        id: generateId(),
        type: "ellipse",
        x: nodeX,
        y: nodeY,
        width: node.width,
        height: node.height,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: bgColor,
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [groupId],
        frameId: null,
        roundness: { type: 2 },
        seed,
        version: 1,
        versionNonce: Math.floor(Math.random() * 100000),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
      };
    } else {
      const bgColor = node.style === "highlight" ? "#e7f5ff" : "transparent";
      shapeElement = {
        id: generateId(),
        type: "rectangle",
        x: nodeX,
        y: nodeY,
        width: node.width,
        height: node.height,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: bgColor,
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [groupId],
        frameId: null,
        roundness: { type: 3 },
        seed,
        version: 1,
        versionNonce: Math.floor(Math.random() * 100000),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
      };
    }

    // Add shape to queue
    animationQueue.push({ element: shapeElement, delay: currentDelay });
    currentDelay += SHAPE_DELAY;

    // Create label text element
    const labelFontSize = 16;
    const labelWidth = measureText(node.label, labelFontSize, 1).width;
    const labelHeight = measureText(node.label, labelFontSize, 1).height;

    const textElement = {
      id: generateId(),
      type: "text",
      x: nodeX + (node.width - labelWidth) / 2,
      y: nodeY + (node.height - labelHeight) / 2,
      width: labelWidth,
      height: labelHeight,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [groupId],
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
      text: node.label,
      fontSize: labelFontSize,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: null,
      originalText: node.label,
      autoResize: true,
      lineHeight: 1.25,
    };

    // Add text shortly after shape
    animationQueue.push({ element: textElement, delay: currentDelay });
    currentDelay += TEXT_DELAY;
  });

  // Create arrow elements for edges
  layout.edges.forEach((edge: LayoutEdge) => {
    if (edge.points.length < 2) return;

    const startX = offsetX + edge.points[0].x;
    const startY = offsetY + edge.points[0].y;
    const endX = offsetX + edge.points[edge.points.length - 1].x;
    const endY = offsetY + edge.points[edge.points.length - 1].y;

    const arrowPoints: [number, number][] = [
      [0, 0],
      [endX - startX, endY - startY],
    ];

    const arrowElement = {
      id: generateId(),
      type: "arrow",
      x: startX,
      y: startY,
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: edge.style === "dashed" ? "dashed" : "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [groupId],
      frameId: null,
      roundness: { type: 2 },
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      points: arrowPoints,
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
    };

    animationQueue.push({ element: arrowElement, delay: currentDelay });
    currentDelay += ARROW_DELAY;

    // Add edge label if present
    if (edge.label) {
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2 - 15;
      const labelFontSize = 14;
      const labelWidth = measureText(edge.label, labelFontSize, 1).width;
      const labelHeight = measureText(edge.label, labelFontSize, 1).height;

      const labelElement = {
        id: generateId(),
        type: "text",
        x: midX - labelWidth / 2,
        y: midY - labelHeight / 2,
        width: labelWidth,
        height: labelHeight,
        angle: 0,
        strokeColor: "#868e96",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [groupId],
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
        text: edge.label,
        fontSize: labelFontSize,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: null,
        originalText: edge.label,
        autoResize: true,
        lineHeight: 1.25,
      };

      animationQueue.push({ element: labelElement, delay: currentDelay });
      currentDelay += TEXT_DELAY;
    }
  });

  // Animate: add elements sequentially
  let addedElements: any[] = [...existingElements];

  animationQueue.forEach(({ element, delay }) => {
    setTimeout(() => {
      addedElements = [...addedElements, element];
      excalidrawAPI.updateScene({
        elements: addedElements,
      });
    }, delay);
  });

  // Track for relative positioning (use group ID so we can compute bounds from all group elements)
  setLastElementId(`group:${groupId}`);

  console.log(`[draw_diagram] Animating ${type} diagram at position="${position}": ${animationQueue.length} elements over ${currentDelay}ms`);
}

// ============================================
// MAIN TOOL DISPATCHER
// ============================================

function handleToolCall(
  excalidrawAPI: any,
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
    case "show_image":
      handleShowImage(excalidrawAPI, params);
      break;
    case "draw_diagram":
    case "draw_flowchart":
      handleDrawDiagram(excalidrawAPI, params);
      break;
    // Tools not implemented for Excalidraw yet
    case "draw_table":
    case "plot_function":
      console.warn(`[handleToolCall] Tool "${toolName}" not implemented for Excalidraw yet`);
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

// Export for direct testing from debug panel
export function triggerToolCall(
  excalidrawAPI: any,
  toolName: string,
  params: ToolParams
): void {
  handleToolCall(excalidrawAPI, toolName, params);
}

// ============================================
// COMPONENT
// ============================================

export function ExcalidrawToolHandler({ excalidrawAPI, room }: ExcalidrawToolHandlerProps) {
  const excalidrawAPIRef = useRef(excalidrawAPI);

  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!room || !excalidrawAPI) return;

    console.log("[ExcalidrawToolHandler] Listening for tool calls on 'tutor_draw' topic");
    console.log("[ExcalidrawToolHandler] Room state:", room.state);
    console.log("[ExcalidrawToolHandler] Room name:", room.name);

    const handleData = (
      payload: Uint8Array,
      participant?: any,
      _kind?: any,
      topic?: string
    ) => {
      console.log(`[ExcalidrawToolHandler] Data received! Topic: "${topic}", From: ${participant?.identity || 'unknown'}`);

      if (!topic || topic !== "tutor_draw") {
        console.log(`[ExcalidrawToolHandler] Ignoring non-tutor_draw topic: "${topic}"`);
        return;
      }

      try {
        const str = new TextDecoder().decode(payload);
        console.log("[ExcalidrawToolHandler] Raw payload:", str);
        const msg = JSON.parse(str);
        console.log("[ExcalidrawToolHandler] Parsed message:", msg);

        if (msg.tool && typeof msg.tool === "string") {
          console.log(`[ExcalidrawToolHandler] Executing tool: ${msg.tool}`);
          handleToolCall(excalidrawAPIRef.current, msg.tool, msg.params || {});
        }
      } catch (error) {
        console.error("[ExcalidrawToolHandler] Error processing message:", error);
      }
    };

    room.on("dataReceived", handleData);
    console.log("[ExcalidrawToolHandler] Event listener attached");

    return () => {
      room.off("dataReceived", handleData);
      console.log("[ExcalidrawToolHandler] Event listener removed");
    };
  }, [room, excalidrawAPI]);

  return null;
}
