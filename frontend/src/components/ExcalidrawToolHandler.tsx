"use client";
import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";
import katex from "katex";
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
  // Annotate params
  shape?: "circle" | "rectangle" | "arrow";
  width?: number;
  height?: number;
  target?: string;
  // Animate params
  prompt?: string;
  code?: string;  // p5.js code (resolved by API)
}

// Track last element for relative positioning (lookup current bounds when needed)
// For single elements: stores element ID
// For diagrams: stores groupId (prefixed with "group:")
// For animations: stores animationId (prefixed with "animation:")
let lastElementId: string | null = null;

// Track animation iframes for cleanup and positioning
interface AnimationOverlay {
  id: string;
  iframe: HTMLIFrameElement;
  container: HTMLDivElement;
  x: number;
  y: number;
  width: number;
  height: number;
}
const animationOverlays: Map<string, AnimationOverlay> = new Map();

interface ExcalidrawToolHandlerProps {
  excalidrawAPI: ExcalidrawAPI;
  room: Room;
}

// Exported type for animated annotation requests
export interface AnimatedAnnotateRequest {
  shape: "circle" | "rectangle";
  // Screen pixel coordinates (for SVG overlay)
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  // Scene coordinates (for creating freedraw element after animation)
  sceneX: number;
  sceneY: number;
  sceneWidth: number;
  sceneHeight: number;
}

// Callback type for animated annotations
export type OnAnimatedAnnotate = (request: AnimatedAnnotateRequest) => void;

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
 * Scale dimensions to fit viewport (max 85% of viewport, preserve aspect ratio)
 */
function getResponsiveSize(
  baseWidth: number,
  baseHeight: number,
  excalidrawAPI: ExcalidrawAPI
): { width: number; height: number } {
  const appState = excalidrawAPI.getAppState();
  const vw = appState.width || 1280;
  const vh = appState.height || 720;

  // Max 85% of viewport
  const maxW = vw * 0.85;
  const maxH = vh * 0.85;

  // Scale down if needed, preserve aspect ratio
  let width = baseWidth;
  let height = baseHeight;

  if (width > maxW) {
    const scale = maxW / width;
    width = maxW;
    height = height * scale;
  }
  if (height > maxH) {
    const scale = maxH / height;
    height = maxH;
    width = width * scale;
  }

  return { width: Math.round(width), height: Math.round(height) };
}

// ============================================
// COLLISION DETECTION
// ============================================

/** Bounding box for collision detection */
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Padding between elements to prevent visual crowding */
const COLLISION_PADDING = 20;

/**
 * Get all occupied regions on the canvas.
 * Includes Excalidraw elements and animation overlays.
 */
function getOccupiedRegions(excalidrawAPI: ExcalidrawAPI): BoundingBox[] {
  const regions: BoundingBox[] = [];

  // Get all Excalidraw elements
  const elements = excalidrawAPI.getSceneElements();
  for (const el of elements) {
    if (el.isDeleted) continue;
    regions.push({
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    });
  }

  // Include animation overlays (they're not Excalidraw elements)
  animationOverlays.forEach((overlay) => {
    regions.push({
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height,
    });
  });

  return regions;
}

/**
 * Check if a rectangle collides with any occupied region.
 * Returns true if there's an overlap.
 */
function checkCollision(
  rect: BoundingBox,
  regions: BoundingBox[],
  padding: number = COLLISION_PADDING
): boolean {
  for (const region of regions) {
    // Add padding to the region for breathing room
    const r = {
      x: region.x - padding,
      y: region.y - padding,
      width: region.width + padding * 2,
      height: region.height + padding * 2,
    };

    // AABB collision check
    const overlaps =
      rect.x < r.x + r.width &&
      rect.x + rect.width > r.x &&
      rect.y < r.y + r.height &&
      rect.y + rect.height > r.y;

    if (overlaps) {
      return true;
    }
  }
  return false;
}

/**
 * Find a non-overlapping position for an element.
 * Strategy: Start at proposed position, shift down until no collision.
 */
function findNonOverlappingPosition(
  excalidrawAPI: ExcalidrawAPI,
  proposedX: number,
  proposedY: number,
  width: number,
  height: number
): { x: number; y: number } {
  const regions = getOccupiedRegions(excalidrawAPI);

  let x = proposedX;
  let y = proposedY;

  const rect: BoundingBox = { x, y, width, height };

  // Maximum iterations to prevent infinite loop
  const maxIterations = 50;
  let iterations = 0;

  while (checkCollision(rect, regions) && iterations < maxIterations) {
    // Shift down by the collision padding + small step
    y += COLLISION_PADDING + 10;
    rect.y = y;
    iterations++;
  }

  return { x, y };
}

/**
 * Scroll the viewport to ensure a position is visible.
 * Called after placing an element to keep it in view.
 */
function scrollToShowPosition(
  excalidrawAPI: ExcalidrawAPI,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const appState = excalidrawAPI.getAppState();
  const { scrollX, scrollY, zoom, width: viewportWidth, height: viewportHeight } = appState;
  const zoomValue = zoom?.value || 1;

  // Calculate viewport bounds in scene coordinates
  const viewportLeft = -scrollX;
  const viewportTop = -scrollY;
  const viewportW = (viewportWidth || 1280) / zoomValue;
  const viewportH = (viewportHeight || 720) / zoomValue;
  const viewportBottom = viewportTop + viewportH;

  // Check if element bottom is below viewport
  const elementBottom = y + height;
  const padding = 50; // Keep some padding from edge

  if (elementBottom > viewportBottom - padding) {
    // Need to scroll down
    const newScrollY = -(y - padding);
    excalidrawAPI.updateScene({
      appState: {
        ...appState,
        scrollY: newScrollY,
      },
    });
  }
}

/**
 * Calculate position coordinates based on position string and viewport.
 * Returns { x, y } in scene coordinates.
 * Now includes collision detection to prevent overlap.
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

  let proposedX: number;
  let proposedY: number;

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
      } else if (lastElementId.startsWith("animation:")) {
        // Look up animation overlay bounds
        const animId = lastElementId.slice(10);
        const overlay = animationOverlays.get(animId);
        if (overlay) {
          lastBounds = {
            x: overlay.x,
            y: overlay.y,
            width: overlay.width,
            height: overlay.height,
          };
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
        proposedX = lastBounds.x;
        proposedY = lastBounds.y + lastBounds.height + 30;
      } else {
        proposedX = lastBounds.x + lastBounds.width + 30;
        proposedY = lastBounds.y;
      }
    } else {
      // Fall back to center if no last element found
      proposedX = viewportLeft + (viewportW - elementWidth) / 2;
      proposedY = viewportTop + (viewportH - elementHeight) / 2;
    }
  } else {
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
        proposedX = colPositions.left;
        proposedY = rowPositions.top;
        break;
      case "top-center":
        proposedX = colPositions.center;
        proposedY = rowPositions.top;
        break;
      case "top-right":
        proposedX = colPositions.right;
        proposedY = rowPositions.top;
        break;
      case "middle-left":
        proposedX = colPositions.left;
        proposedY = rowPositions.middle;
        break;
      case "center":
        proposedX = colPositions.center;
        proposedY = rowPositions.middle;
        break;
      case "middle-right":
        proposedX = colPositions.right;
        proposedY = rowPositions.middle;
        break;
      case "bottom-left":
        proposedX = colPositions.left;
        proposedY = rowPositions.bottom;
        break;
      case "bottom-center":
        proposedX = colPositions.center;
        proposedY = rowPositions.bottom;
        break;
      case "bottom-right":
        proposedX = colPositions.right;
        proposedY = rowPositions.bottom;
        break;
      default:
        // Default to center
        proposedX = colPositions.center;
        proposedY = rowPositions.middle;
    }
  }

  // Apply collision detection - find non-overlapping position
  const finalPosition = findNonOverlappingPosition(
    excalidrawAPI,
    proposedX,
    proposedY,
    elementWidth,
    elementHeight
  );

  // Auto-scroll to show the element if it's below the viewport
  scrollToShowPosition(
    excalidrawAPI,
    finalPosition.x,
    finalPosition.y,
    elementWidth,
    elementHeight
  );

  return finalPosition;
}

/**
 * Set the last element ID for relative positioning.
 */
function setLastElementId(id: string): void {
  lastElementId = id;
}

// ============================================
// LATEX HELPERS
// ============================================

/**
 * Detect if content contains LaTeX patterns
 */
function containsLatex(text: string): boolean {
  // Common LaTeX patterns
  const patterns = [
    /\$[^$]+\$/,           // Inline math: $...$
    /\$\$[^$]+\$\$/,       // Display math: $$...$$
    /\\frac\{/,            // \frac{}{}
    /\\sqrt\{/,            // \sqrt{}
    /\\sum/,               // \sum
    /\\int/,               // \int
    /\\[a-zA-Z]+\{/,       // Any \command{
    /\^{[^}]+}/,           // Superscript: ^{...}
    /_{[^}]+}/,            // Subscript: _{...}
    /\\alpha|\\beta|\\gamma|\\delta|\\theta|\\pi|\\sigma|\\omega/i, // Greek letters
    /\\rightarrow|\\leftarrow|\\Rightarrow|\\Leftarrow/,  // Arrows
    /\\times|\\div|\\pm|\\neq|\\leq|\\geq|\\approx/,      // Math operators
  ];

  return patterns.some(pattern => pattern.test(text));
}

/**
 * Render LaTeX content to SVG data URL
 */
function renderLatexToSvg(content: string, fontSize: number): { svg: string; width: number; height: number } {
  // Strip outer $ delimiters if present
  let latex = content.trim();
  if (latex.startsWith("$$") && latex.endsWith("$$")) {
    latex = latex.slice(2, -2);
  } else if (latex.startsWith("$") && latex.endsWith("$")) {
    latex = latex.slice(1, -1);
  }

  // Render with KaTeX using MathML output (self-contained, no external fonts needed)
  const mathml = katex.renderToString(latex, {
    throwOnError: false,
    displayMode: latex.includes("\\frac") || latex.includes("\\sum") || latex.includes("\\int"),
    output: "mathml",
  });

  // Create a temporary element to measure
  const container = document.createElement("div");
  container.innerHTML = mathml;
  container.style.position = "absolute";
  container.style.visibility = "hidden";
  container.style.fontSize = `${fontSize}px`;
  document.body.appendChild(container);

  const rect = container.getBoundingClientRect();
  const width = Math.ceil(rect.width) + 20; // Add padding
  const height = Math.ceil(rect.height) + 10;

  document.body.removeChild(container);

  // Create SVG with MathML content (no foreignObject needed, MathML is native SVG)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${fontSize}px; color: #1e1e1e;">
          ${mathml}
        </div>
      </foreignObject>
    </svg>
  `;

  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  return { svg: dataUrl, width, height };
}

// ============================================
// TOOL HANDLERS
// ============================================

function handleClearBoard(excalidrawAPI: ExcalidrawAPI): void {
  excalidrawAPI.resetScene();
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

  // Add 20% padding for Virgil font which tends to be wider than measured
  const paddedWidth = maxWidth * 1.2;
  return { width: Math.max(paddedWidth, 10), height: Math.max(height, fontSize) };
}

function handleAddText(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): void {
  const { content = "", size = "medium", position = "center" } = params;

  if (!content) {
    return;
  }

  const fontSize = getFontSize(size);

  // Check if content contains LaTeX - render as image if so
  if (containsLatex(content)) {
    handleAddLatex(excalidrawAPI, content, fontSize, position as PositionType);
    return;
  }

  // Regular text rendering
  const elements = excalidrawAPI.getSceneElements();
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
}

/**
 * Handle LaTeX content by rendering to SVG and adding as image
 */
function handleAddLatex(
  excalidrawAPI: ExcalidrawAPI,
  content: string,
  fontSize: number,
  position: PositionType
): void {
  try {
    const { svg: dataUrl, width, height } = renderLatexToSvg(content, fontSize);
    const elements = excalidrawAPI.getSceneElements();

    // Calculate position
    const { x: posX, y: posY } = calculatePosition(
      excalidrawAPI,
      position,
      width,
      height
    );

    const elementId = generateId();
    const fileId = generateId();

    const imageElement = {
      id: elementId,
      type: "image" as const,
      x: posX,
      y: posY,
      width: width,
      height: height,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      strokeWidth: 0,
      strokeStyle: "solid" as const,
      roughness: 0,
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

    // Add SVG file to Excalidraw
    excalidrawAPI.addFiles([
      {
        id: fileId,
        dataURL: dataUrl,
        mimeType: "image/svg+xml",
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    ]);

    setLastElementId(elementId);
  } catch (error) {
    console.error("[handleAddLatex] Failed to render LaTeX:", error);
    // Fallback to plain text if LaTeX rendering fails
    const elements = excalidrawAPI.getSceneElements();
    const fontFamily = 1;
    const { width, height } = measureText(content, fontSize, fontFamily);
    const { x: posX, y: posY } = calculatePosition(excalidrawAPI, position, width, height);

    const elementId = generateId();
    const textElement = {
      id: elementId,
      type: "text" as const,
      x: posX,
      y: posY,
      width,
      height,
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
      fontSize,
      fontFamily,
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
    setLastElementId(elementId);
  }
}

async function handleShowImage(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): Promise<void> {
  const { query, url, position = "center" } = params;

  let dataUrl = "";

  // If query is provided, search for the image (API returns base64 dataUrl)
  if (query && !url) {
    try {
      const response = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data.dataUrl) {
        dataUrl = data.dataUrl;
      } else if (data.error) {
        handleAddText(excalidrawAPI, { content: `[Image: ${query}]`, size: "medium", position });
        return;
      } else {
        handleAddText(excalidrawAPI, { content: `[Image: ${query}]`, size: "medium", position });
        return;
      }
    } catch {
      handleAddText(excalidrawAPI, { content: `[Image: ${query}]`, size: "medium", position });
      return;
    }
  } else if (url) {
    // If URL is provided directly, try to fetch it (may fail due to CORS)
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      handleAddText(excalidrawAPI, { content: `[Image failed to load]`, size: "medium", position });
      return;
    }
  }

  if (!dataUrl) {
    return;
  }

  try {

    // Get image dimensions
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = dataUrl;
    });

    // Scale image to fit viewport (max 500px base, responsive)
    const { width: maxWidth } = getResponsiveSize(500, 500, excalidrawAPI);
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

    // Add file to Excalidraw - extract mimeType from dataUrl (format: data:image/jpeg;base64,...)
    const mimeMatch = dataUrl.match(/^data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
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
  } catch {
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

  // Scale diagram to fit viewport if needed
  const { width: maxW, height: maxH } = getResponsiveSize(diagramWidth, diagramHeight, excalidrawAPI);
  const diagramScale = Math.min(1, maxW / diagramWidth, maxH / diagramHeight);
  diagramWidth *= diagramScale;
  diagramHeight *= diagramScale;

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
    // Apply scale to node position and size
    const nodeX = offsetX + node.x * diagramScale;
    const nodeY = offsetY + node.y * diagramScale;
    const nodeW = node.width * diagramScale;
    const nodeH = node.height * diagramScale;
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
        width: nodeW,
        height: nodeH,
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
        width: nodeW,
        height: nodeH,
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
        width: nodeW,
        height: nodeH,
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

    // Create label text element (scale font size too)
    const labelFontSize = Math.max(10, Math.round(16 * diagramScale));
    const labelWidth = measureText(node.label, labelFontSize, 1).width;
    const labelHeight = measureText(node.label, labelFontSize, 1).height;

    const textElement = {
      id: generateId(),
      type: "text",
      x: nodeX + (nodeW - labelWidth) / 2,
      y: nodeY + (nodeH - labelHeight) / 2,
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

    // Apply scale to edge points
    const startX = offsetX + edge.points[0].x * diagramScale;
    const startY = offsetY + edge.points[0].y * diagramScale;
    const endX = offsetX + edge.points[edge.points.length - 1].x * diagramScale;
    const endY = offsetY + edge.points[edge.points.length - 1].y * diagramScale;

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
      const midY = (startY + endY) / 2 - 15 * diagramScale;
      const labelFontSize = Math.max(10, Math.round(14 * diagramScale));
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
}

// ============================================
// ANNOTATION HANDLER
// ============================================

function handleAnnotate(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams,
  onAnimatedAnnotate?: OnAnimatedAnnotate
): void {
  const { shape = "circle", x = 0.5, y = 0.5, width = 0.1, height = 0.1, target = "" } = params;

  // Get viewport info to convert normalized coords
  const appState = excalidrawAPI.getAppState();
  const { scrollX, scrollY, zoom, width: viewportWidth, height: viewportHeight } = appState;
  const zoomValue = zoom?.value || 1;
  const vpW = viewportWidth || 1280;
  const vpH = viewportHeight || 720;

  // Calculate screen pixel coordinates (for SVG overlay)
  // Normalized (0-1) → screen pixels
  const screenWidth = width * vpW;
  const screenHeight = height * vpH;
  const screenX = (x * vpW) - (screenWidth / 2);
  const screenY = (y * vpH) - (screenHeight / 2);

  // Calculate scene coordinates (for Excalidraw element)
  const viewportLeft = -scrollX;
  const viewportTop = -scrollY;
  const viewportW = vpW / zoomValue;
  const viewportH = vpH / zoomValue;
  const sceneWidth = width * viewportW;
  const sceneHeight = height * viewportH;
  const sceneX = viewportLeft + (x * viewportW) - (sceneWidth / 2);
  const sceneY = viewportTop + (y * viewportH) - (sceneHeight / 2);

  // If callback provided and shape is circle/rectangle, use animated version
  if (onAnimatedAnnotate && (shape === "circle" || shape === "rectangle")) {
    console.log(`[Annotate] Triggering animated ${shape} around "${target}" at (${x.toFixed(2)}, ${y.toFixed(2)})`);
    onAnimatedAnnotate({
      shape,
      screenX,
      screenY,
      screenWidth,
      screenHeight,
      sceneX,
      sceneY,
      sceneWidth,
      sceneHeight,
    });
    return;
  }

  // Fallback: create instant element (for arrows or when no callback)
  const elements = excalidrawAPI.getSceneElements();
  const elementId = generateId();

  let element: any;

  if (shape === "circle") {
    element = {
      id: elementId,
      type: "ellipse",
      x: sceneX,
      y: sceneY,
      width: sceneWidth,
      height: sceneHeight,
      angle: 0,
      strokeColor: "#e03131",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 3,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: { type: 2 },
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
    };
  } else if (shape === "rectangle") {
    element = {
      id: elementId,
      type: "rectangle",
      x: sceneX,
      y: sceneY,
      width: sceneWidth,
      height: sceneHeight,
      angle: 0,
      strokeColor: "#e03131",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 3,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: { type: 3 },
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
    };
  } else if (shape === "arrow") {
    const arrowLength = Math.max(sceneWidth, sceneHeight);
    element = {
      id: elementId,
      type: "arrow",
      x: sceneX - arrowLength,
      y: sceneY - arrowLength / 2,
      width: arrowLength,
      height: arrowLength / 2,
      angle: 0,
      strokeColor: "#e03131",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 3,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: { type: 2 },
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      points: [[0, 0], [arrowLength, arrowLength / 2]],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
    };
  } else {
    element = {
      id: elementId,
      type: "ellipse",
      x: sceneX,
      y: sceneY,
      width: sceneWidth,
      height: sceneHeight,
      angle: 0,
      strokeColor: "#e03131",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 3,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: { type: 2 },
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

  excalidrawAPI.updateScene({
    elements: [...elements, element],
  });

  setLastElementId(elementId);
  console.log(`[Annotate] Drew ${shape} around "${target}" at (${x.toFixed(2)}, ${y.toFixed(2)})`);
}

// ============================================
// ANIMATION HANDLER - P5.JS IFRAME OVERLAY
// ============================================

/**
 * Create a p5.js animation iframe overlaid on the Excalidraw canvas.
 * The iframe is positioned in scene coordinates and updates when the canvas scrolls/zooms.
 */
function handleAnimate(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): void {
  const { code, position = "center" } = params;

  if (!code) {
    console.error("[handleAnimate] No code provided");
    return;
  }

  // Animation dimensions - responsive to viewport
  const { width: animWidth, height: animHeight } = getResponsiveSize(600, 400, excalidrawAPI);

  // Calculate position based on position parameter
  const { x: posX, y: posY } = calculatePosition(
    excalidrawAPI,
    position as PositionType,
    animWidth,
    animHeight
  );

  // Generate unique ID for this animation
  const animationId = generateId();

  // Find the Excalidraw container to attach the overlay
  const excalidrawContainer = document.querySelector(".excalidraw");
  if (!excalidrawContainer) {
    console.error("[handleAnimate] Could not find Excalidraw container");
    return;
  }

  // Create container div for the iframe
  const container = document.createElement("div");
  container.id = `animation-${animationId}`;
  container.style.cssText = `
    position: absolute;
    pointer-events: auto;
    z-index: 10;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    border: 2px solid #333;
  `;

  // Create iframe
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `
    width: ${animWidth}px;
    height: ${animHeight}px;
    border: none;
    display: block;
  `;

  // Build the HTML content for the iframe
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #1a1a2e;
      overflow: hidden;
    }
    canvas {
      display: block;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"><\/script>
</head>
<body>
  <script>
    window.onerror = function(msg, url, lineNo, columnNo, error) {
      document.body.innerHTML = '<div style="color: #ff6b6b; padding: 20px; font-family: monospace;">Error: ' + msg + '</div>';
      return false;
    };
    ${code}
  <\/script>
</body>
</html>
  `;

  container.appendChild(iframe);
  excalidrawContainer.appendChild(container);

  // Write content to iframe
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(htmlContent);
    doc.close();
  }

  // Store for tracking
  const overlay: AnimationOverlay = {
    id: animationId,
    iframe,
    container,
    x: posX,
    y: posY,
    width: animWidth,
    height: animHeight,
  };
  animationOverlays.set(animationId, overlay);

  // Function to update position based on current scroll/zoom
  const updatePosition = () => {
    const appState = excalidrawAPI.getAppState();
    const { scrollX, scrollY, zoom } = appState;
    const zoomValue = zoom?.value || 1;

    // Convert scene coordinates to screen coordinates
    const screenX = (posX + scrollX) * zoomValue;
    const screenY = (posY + scrollY) * zoomValue;
    const screenWidth = animWidth * zoomValue;
    const screenHeight = animHeight * zoomValue;

    container.style.left = `${screenX}px`;
    container.style.top = `${screenY}px`;
    container.style.width = `${screenWidth}px`;
    container.style.height = `${screenHeight}px`;
    iframe.style.width = `${screenWidth}px`;
    iframe.style.height = `${screenHeight}px`;
    iframe.style.transform = `scale(${zoomValue})`;
    iframe.style.transformOrigin = "top left";
  };

  // Initial position update
  updatePosition();

  // Listen for scroll/zoom changes
  const observer = new MutationObserver(() => {
    updatePosition();
  });

  // Observe the Excalidraw canvas for changes
  const canvas = document.querySelector(".excalidraw__canvas");
  if (canvas) {
    observer.observe(canvas, { attributes: true });
  }

  // Also update on pointer events (pan/zoom)
  excalidrawContainer.addEventListener("pointermove", updatePosition);
  excalidrawContainer.addEventListener("wheel", updatePosition);

  // Track for relative positioning
  setLastElementId(`animation:${animationId}`);

  console.log(`[handleAnimate] Created animation ${animationId} at (${posX}, ${posY})`);
}

/**
 * Clear all animation overlays
 */
function clearAnimationOverlays(): void {
  animationOverlays.forEach((overlay) => {
    overlay.container.remove();
  });
  animationOverlays.clear();
}

// ============================================
// MAIN TOOL DISPATCHER
// ============================================

function handleToolCall(
  excalidrawAPI: any,
  toolName: string,
  params: ToolParams,
  onAnimatedAnnotate?: OnAnimatedAnnotate
): void {
  switch (toolName) {
    case "clear_board":
      handleClearBoard(excalidrawAPI);
      clearAnimationOverlays();
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
    case "annotate":
      handleAnnotate(excalidrawAPI, params, onAnimatedAnnotate);
      break;
    case "animate":
      handleAnimate(excalidrawAPI, params);
      break;
    // Tools not implemented for Excalidraw yet
    case "draw_table":
    case "plot_function":
      break;
    // Lesson control tools (no canvas action needed)
    case "next_concept":
    case "finish_lesson":
      break;
    default:
      break;
  }
}

// Export for direct testing from debug panel
export function triggerToolCall(
  excalidrawAPI: any,
  toolName: string,
  params: ToolParams,
  onAnimatedAnnotate?: OnAnimatedAnnotate
): void {
  handleToolCall(excalidrawAPI, toolName, params, onAnimatedAnnotate);
}

// ============================================
// COMPONENT
// ============================================

// Capture canvas to base64 (same as test-draw page)
function captureCanvas(): string | null {
  try {
    const canvas = document.querySelector(".excalidraw__canvas") as HTMLCanvasElement;
    if (!canvas) {
      console.warn("[captureCanvas] Could not find Excalidraw canvas");
      return null;
    }
    // Get data URL and strip the prefix to get pure base64
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } catch (e) {
    console.error("[captureCanvas] Failed to capture canvas:", e);
    return null;
  }
}

export function ExcalidrawToolHandler({ excalidrawAPI, room }: ExcalidrawToolHandlerProps) {
  const excalidrawAPIRef = useRef(excalidrawAPI);

  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!room || !excalidrawAPI) return;

    const handleData = async (
      payload: Uint8Array,
      _participant?: any,
      _kind?: any,
      topic?: string
    ) => {
      // Handle tool calls from tutor_draw topic
      if (topic === "tutor_draw") {
        try {
          const str = new TextDecoder().decode(payload);
          const msg = JSON.parse(str);

          if (msg.tool && typeof msg.tool === "string") {
            // Special handling for draw_query - call /api/draw like R&D does
            if (msg.tool === "draw_query" && msg.params?.query) {
              console.log("[ExcalidrawToolHandler] Received draw_query:", msg.params.query);

              // Capture screenshot immediately
              const screenshot = captureCanvas();

              // DEBUG: Log screenshot info
              if (screenshot) {
                console.log("[ExcalidrawToolHandler] Screenshot captured:", screenshot.length, "bytes");
                // Save screenshot for debugging - creates a downloadable link
                const debugLink = document.createElement("a");
                debugLink.href = `data:image/png;base64,${screenshot}`;
                debugLink.download = `debug-screenshot-${Date.now()}.png`;
                console.log("[ExcalidrawToolHandler] Debug: Click to download screenshot:", debugLink.href.slice(0, 100) + "...");
                // Uncomment next line to auto-download: debugLink.click();
              } else {
                console.warn("[ExcalidrawToolHandler] Screenshot is NULL!");
              }

              try {
                const response = await fetch("/api/draw", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ query: msg.params.query, screenshot }),
                });

                if (!response.ok) {
                  const errorData = await response.json();
                  console.error("[ExcalidrawToolHandler] API error:", errorData.error);
                  return;
                }

                const data = await response.json();
                console.log("[ExcalidrawToolHandler] Got tool calls:", data.toolCalls?.length);

                // DEBUG: Log full tool calls with coordinates
                if (data.toolCalls && Array.isArray(data.toolCalls)) {
                  for (const toolCall of data.toolCalls) {
                    console.log("[ExcalidrawToolHandler] Tool call:", JSON.stringify(toolCall, null, 2));

                    // Special debug for annotate - show coordinates
                    if (toolCall.tool === "annotate") {
                      console.log("[ExcalidrawToolHandler] ANNOTATE coordinates:", {
                        x: toolCall.params.x,
                        y: toolCall.params.y,
                        width: toolCall.params.width,
                        height: toolCall.params.height,
                        target: toolCall.params.target,
                      });
                    }
                  }
                }

                // Execute each tool call (same as test-draw page)
                if (data.toolCalls && Array.isArray(data.toolCalls)) {
                  for (const toolCall of data.toolCalls) {
                    handleToolCall(excalidrawAPIRef.current, toolCall.tool, toolCall.params);
                    // Small delay between tool calls
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                }
              } catch (err) {
                console.error("[ExcalidrawToolHandler] Failed to call /api/draw:", err);
              }
            } else {
              // Regular tool call
              handleToolCall(excalidrawAPIRef.current, msg.tool, msg.params || {});
            }
          }
        } catch {
          // Ignore parse errors
        }
        return;
      }

      // Handle control messages from tutor_control topic
      if (topic === "tutor_control") {
        try {
          const str = new TextDecoder().decode(payload);
          const msg = JSON.parse(str);

          if (msg.type === "request_screenshot") {
            console.log("[ExcalidrawToolHandler] Screenshot requested by agent");
            const screenshot = captureCanvas();

            // Send screenshot back to agent
            const response = JSON.stringify({
              type: "screenshot_response",
              requestId: msg.requestId,
              data: screenshot,
            });

            await room.localParticipant.publishData(
              new TextEncoder().encode(response),
              { reliable: true, topic: "canvas_screenshot" }
            );
            console.log("[ExcalidrawToolHandler] Screenshot sent to agent");
          }
        } catch (e) {
          console.error("[ExcalidrawToolHandler] Error handling control message:", e);
        }
        return;
      }
    };

    room.on("dataReceived", handleData);

    return () => {
      room.off("dataReceived", handleData);
    };
  }, [room, excalidrawAPI]);

  return null;
}
