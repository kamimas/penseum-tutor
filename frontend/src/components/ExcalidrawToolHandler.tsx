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
import type { AnimatedMathGraphResult } from "./AnimatedMathGraph";

// Lazy load Excalidraw to avoid SSR issues (navigator is not defined)
let convertToExcalidrawElements: any = null;
async function getConvertToExcalidrawElements() {
  if (!convertToExcalidrawElements) {
    const module = await import("@excalidraw/excalidraw");
    convertToExcalidrawElements = module.convertToExcalidrawElements;
  }
  return convertToExcalidrawElements;
}

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

// Color mapping for accent bars and underlines
type AccentColor = "none" | "purple" | "green" | "blue" | "red" | "orange";
const COLOR_MAP: Record<AccentColor, string> = {
  none: "transparent",
  purple: "#9D7CD8",
  green: "#7EC699",
  blue: "#1971c2",
  red: "#e03131",
  orange: "#E5A853",
};

interface ToolParams {
  content?: string;
  size?: "small" | "medium" | "large";
  query?: string;
  url?: string;
  x?: number;
  y?: number;
  position?: PositionType | string;
  // Text styling params
  emoji?: string;
  accent?: AccentColor;
  underline?: string[];
  underline_color?: AccentColor;
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
  // Math graph params
  expression?: string;  // e.g., "sin(x)", "x^2"
  xMin?: number;
  xMax?: number;
  // Question params
  question_type?: "mcq" | "fill_blank" | "long_answer";
  question?: string;
  options?: string[];
  correct_answer?: string;
  hint?: string;
}

// ============================================
// POSITIONING - Simple scene-based layout
// ============================================
//
// Logic: Query scene for lowest element, place new content below it.
// First element centers in viewport. Subsequent elements stack vertically.
// Async tools (images, animations) place placeholders immediately.

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

// Exported type for animated math graph requests
export interface AnimatedMathGraphRequest {
  expression: string;
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
  // Optional range
  xMin?: number;
  xMax?: number;
}

// Callback type for animated math graphs
export type OnAnimatedMathGraph = (request: AnimatedMathGraphRequest) => void;

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

/**
 * Get the lowest Y coordinate of all elements in the scene.
 * Returns 0 if scene is empty.
 */
function getLowestY(excalidrawAPI: ExcalidrawAPI): number {
  const elements = excalidrawAPI.getSceneElements();
  let lowestY = 0;

  for (const el of elements) {
    if (!el.isDeleted) {
      const bottom = el.y + el.height;
      if (bottom > lowestY) {
        lowestY = bottom;
      }
    }
  }

  return lowestY;
}

/**
 * Get the X coordinate to center an element in the viewport.
 */
function getViewportCenterX(excalidrawAPI: ExcalidrawAPI, elementWidth: number): number {
  const appState = excalidrawAPI.getAppState();
  const { scrollX, zoom, width: viewportWidth } = appState;
  const zoomValue = zoom?.value || 1;
  const viewportW = (viewportWidth || 1280) / zoomValue;
  const viewportLeft = -scrollX;

  return viewportLeft + (viewportW - elementWidth) / 2;
}

/**
 * Get the Y coordinate to center an element in the viewport.
 */
function getViewportCenterY(excalidrawAPI: ExcalidrawAPI, elementHeight: number): number {
  const appState = excalidrawAPI.getAppState();
  const { scrollY, zoom, height: viewportHeight } = appState;
  const zoomValue = zoom?.value || 1;
  const viewportH = (viewportHeight || 720) / zoomValue;
  const viewportTop = -scrollY;

  return viewportTop + (viewportH - elementHeight) / 2;
}

/**
 * Scroll the viewport to ensure a position is visible.
 */
function scrollToShowPosition(
  excalidrawAPI: ExcalidrawAPI,
  y: number,
  height: number
): void {
  const appState = excalidrawAPI.getAppState();
  const { scrollY, zoom, height: viewportHeight } = appState;
  const zoomValue = zoom?.value || 1;
  const viewportH = (viewportHeight || 720) / zoomValue;
  const viewportTop = -scrollY;
  const viewportBottom = viewportTop + viewportH;

  const elementBottom = y + height;
  const padding = 50;

  if (elementBottom > viewportBottom - padding) {
    const scrollAmount = elementBottom - viewportBottom + padding + 50;
    excalidrawAPI.updateScene({
      appState: { scrollY: scrollY - scrollAmount },
    });
  }
}

// Gap between stacked elements
const STACK_GAP = 40;

/**
 * Calculate position for a new element.
 *
 * Simple logic:
 * - If scene is empty: center in viewport
 * - Otherwise: stack below the lowest element, centered horizontally
 */
function getNextPosition(
  excalidrawAPI: ExcalidrawAPI,
  elementWidth: number,
  elementHeight: number
): { x: number; y: number } {
  const lowestY = getLowestY(excalidrawAPI);
  const centerX = getViewportCenterX(excalidrawAPI, elementWidth);

  let x: number;
  let y: number;

  if (lowestY === 0) {
    // Empty scene: center in viewport
    x = centerX;
    y = getViewportCenterY(excalidrawAPI, elementHeight);
  } else {
    // Stack below existing content, centered
    x = centerX;
    y = lowestY + STACK_GAP;
  }

  // Auto-scroll to show the new element
  scrollToShowPosition(excalidrawAPI, y, elementHeight);

  return { x, y };
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

/**
 * Measure the width of a substring within text (for underline positioning)
 */
function measureSubstringPosition(
  fullText: string,
  targetWord: string,
  fontSize: number,
  fontFamily: number
): { startX: number; width: number } | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const fontFamilyName = fontFamily === 1 ? "Virgil, Segoe UI Emoji" :
                         fontFamily === 2 ? "Helvetica, Segoe UI Emoji" :
                         "Cascadia, Segoe UI Emoji";
  ctx.font = `${fontSize}px ${fontFamilyName}`;

  // Find the word in the text (case-insensitive)
  const lowerText = fullText.toLowerCase();
  const lowerTarget = targetWord.toLowerCase();
  const wordIndex = lowerText.indexOf(lowerTarget);

  if (wordIndex === -1) return null;

  // Measure text up to the word start
  const textBefore = fullText.slice(0, wordIndex);
  const startX = ctx.measureText(textBefore).width * 1.2; // 1.2 for Virgil padding

  // Measure the word itself
  const actualWord = fullText.slice(wordIndex, wordIndex + targetWord.length);
  const width = ctx.measureText(actualWord).width * 1.2;

  return { startX, width };
}

function handleAddText(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): void {
  const {
    content = "",
    size = "medium",
    emoji,
    accent,
    underline,
    underline_color = "purple"
  } = params;

  if (!content) {
    return;
  }

  // Prepend emoji if provided
  const displayContent = emoji ? `${emoji} ${content}` : content;
  const fontSize = getFontSize(size);

  // Check if content contains LaTeX - render as image if so
  if (containsLatex(content)) {
    handleAddLatex(excalidrawAPI, displayContent, fontSize);
    return;
  }

  const fontFamily = 1; // Virgil (hand-drawn style)
  const groupId = generateId();

  // Measure full text dimensions
  const { width: fullWidth, height } = measureText(displayContent, fontSize, fontFamily);

  // Calculate accent bar width if needed
  const accentBarWidth = accent && accent !== "none" ? 6 : 0;
  const accentGap = accent && accent !== "none" ? 12 : 0;
  const totalWidth = fullWidth + accentBarWidth + accentGap;

  // Calculate total height including underlines
  const underlineHeight = underline && underline.length > 0 ? 5 : 0;
  const totalHeight = height + underlineHeight;

  // Get position (stacks below existing content)
  const { x: posX, y: posY } = getNextPosition(excalidrawAPI, totalWidth, totalHeight);

  // Build all elements to add at once
  const newElements: any[] = [];

  // Text position (offset by accent bar if present)
  const textX = posX + accentBarWidth + accentGap;
  const textY = posY;

  // 1. Create accent bar if specified
  if (accent && accent !== "none") {
    newElements.push({
      id: generateId(),
      type: "rectangle" as const,
      x: posX,
      y: posY,
      width: accentBarWidth,
      height: height,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: COLOR_MAP[accent] || COLOR_MAP.purple,
      fillStyle: "solid" as const,
      strokeWidth: 0,
      strokeStyle: "solid" as const,
      roughness: 0,
      opacity: 100,
      groupIds: [groupId],
      frameId: null,
      index: "a0" as const,
      roundness: { type: 3 },
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
    });
  }

  // 2. Create text element (full text, no animation)
  newElements.push({
    id: generateId(),
    type: "text" as const,
    x: textX,
    y: textY,
    width: fullWidth,
    height: height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    groupIds: [groupId],
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
    text: displayContent,
    fontSize: fontSize,
    fontFamily: fontFamily,
    textAlign: "left" as const,
    verticalAlign: "top" as const,
    containerId: null,
    originalText: displayContent,
    autoResize: true,
    lineHeight: 1.25,
  });

  // 3. Create underlines if specified
  if (underline && underline.length > 0) {
    const underlineY = textY + height + 2;
    const underlineH = 3;

    for (const word of underline) {
      const pos = measureSubstringPosition(displayContent, word, fontSize, fontFamily);
      if (pos) {
        newElements.push({
          id: generateId(),
          type: "rectangle" as const,
          x: textX + pos.startX,
          y: underlineY,
          width: pos.width,
          height: underlineH,
          angle: 0,
          strokeColor: "transparent",
          backgroundColor: COLOR_MAP[underline_color] || COLOR_MAP.purple,
          fillStyle: "solid" as const,
          strokeWidth: 0,
          strokeStyle: "solid" as const,
          roughness: 0,
          opacity: 100,
          groupIds: [groupId],
          frameId: null,
          index: "a0" as const,
          roundness: { type: 3 },
          seed: Math.floor(Math.random() * 100000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 100000),
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
        });
      }
    }
  }

  // Add all elements at once (no animation, no race condition)
  const existingElements = excalidrawAPI.getSceneElements();
  excalidrawAPI.updateScene({
    elements: [...existingElements, ...newElements],
  });
}

/**
 * Handle LaTeX content by rendering to SVG and adding as image
 */
async function handleAddLatex(
  excalidrawAPI: ExcalidrawAPI,
  content: string,
  fontSize: number
): Promise<void> {
  const convert = await getConvertToExcalidrawElements();

  try {
    const { svg: dataUrl, width, height } = renderLatexToSvg(content, fontSize);
    const elements = excalidrawAPI.getSceneElements();

    // Get position (stacks below existing content)
    const { x: posX, y: posY } = getNextPosition(excalidrawAPI, width, height);

    const fileId = generateId() as any;

    const [imageElement] = convert([
      {
        type: "image",
        x: posX,
        y: posY,
        width,
        height,
        fileId,
      },
    ]);

    excalidrawAPI.updateScene({
      elements: [...elements, imageElement],
    });

    excalidrawAPI.addFiles([
      {
        id: fileId,
        dataURL: dataUrl,
        mimeType: "image/svg+xml",
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    ]);
  } catch (error) {
    console.error("[handleAddLatex] Failed to render LaTeX:", error);
    // Fallback to plain text if LaTeX rendering fails
    const elements = excalidrawAPI.getSceneElements();
    const fontFamily = 1;
    const { width, height } = measureText(content, fontSize, fontFamily);
    const { x: posX, y: posY } = getNextPosition(excalidrawAPI, width, height);

    const [textElement] = convert([
      {
        type: "text",
        x: posX,
        y: posY,
        text: content,
        fontSize,
        fontFamily,
      },
    ]);

    excalidrawAPI.updateScene({
      elements: [...elements, textElement],
    });
  }
}

// Default size for image placeholder (before we know actual dimensions)
const IMAGE_PLACEHOLDER_SIZE = { width: 400, height: 300 };

async function handleShowImage(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): Promise<void> {
  const { query, url } = params;

  // Reserve space immediately with a placeholder
  // This prevents race conditions with subsequent tool calls
  const placeholderSize = getResponsiveSize(
    IMAGE_PLACEHOLDER_SIZE.width,
    IMAGE_PLACEHOLDER_SIZE.height,
    excalidrawAPI
  );
  const { x: posX, y: posY } = getNextPosition(
    excalidrawAPI,
    placeholderSize.width,
    placeholderSize.height
  );

  // Create placeholder element
  const placeholderId = generateId();
  const placeholderElement = {
    id: placeholderId,
    type: "rectangle" as const,
    x: posX,
    y: posY,
    width: placeholderSize.width,
    height: placeholderSize.height,
    angle: 0,
    strokeColor: "#adb5bd",
    backgroundColor: "#f8f9fa",
    fillStyle: "solid" as const,
    strokeWidth: 1,
    strokeStyle: "dashed" as const,
    roughness: 0,
    opacity: 50,
    groupIds: [],
    frameId: null,
    index: "a0" as const,
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

  // Add placeholder to scene immediately
  let elements = excalidrawAPI.getSceneElements();
  excalidrawAPI.updateScene({
    elements: [...elements, placeholderElement],
  });

  let dataUrl = "";

  // Fetch the image
  if (query && !url) {
    try {
      const response = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data.dataUrl) {
        dataUrl = data.dataUrl;
      }
    } catch {
      // Failed to fetch
    }
  } else if (url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      // Failed to fetch
    }
  }

  // Remove placeholder
  elements = excalidrawAPI.getSceneElements();
  elements = elements.filter((el: any) => el.id !== placeholderId);

  if (!dataUrl) {
    // Show error text at placeholder position
    const errorElement = {
      id: generateId(),
      type: "text" as const,
      x: posX,
      y: posY,
      width: 200,
      height: 28,
      angle: 0,
      strokeColor: "#868e96",
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
      text: `[Image: ${query || url}]`,
      fontSize: 20,
      fontFamily: 1,
      textAlign: "left" as const,
      verticalAlign: "top" as const,
      containerId: null,
      originalText: `[Image: ${query || url}]`,
      autoResize: true,
      lineHeight: 1.25,
    };
    excalidrawAPI.updateScene({ elements: [...elements, errorElement] });
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

    // Scale image to fit viewport
    const { width: maxWidth } = getResponsiveSize(500, 500, excalidrawAPI);
    const scale = Math.min(1, maxWidth / img.width);
    const width = img.width * scale;
    const height = img.height * scale;

    const fileId = generateId() as any;

    const convert = await getConvertToExcalidrawElements();
    const [imageElement] = convert([
      {
        type: "image",
        x: posX,
        y: posY,
        width,
        height,
        fileId,
      },
    ]);

    excalidrawAPI.updateScene({
      elements: [...elements, imageElement],
    });

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
  } catch {
    // Show error
    const errorElement = {
      id: generateId(),
      type: "text" as const,
      x: posX,
      y: posY,
      width: 200,
      height: 28,
      angle: 0,
      strokeColor: "#868e96",
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
      text: `[Image failed: ${query || url}]`,
      fontSize: 20,
      fontFamily: 1,
      textAlign: "left" as const,
      verticalAlign: "top" as const,
      containerId: null,
      originalText: `[Image failed: ${query || url}]`,
      autoResize: true,
      lineHeight: 1.25,
    };
    excalidrawAPI.updateScene({ elements: [...elements, errorElement] });
  }
}

// ============================================
// DIAGRAM HANDLER - NATIVE EXCALIDRAW ELEMENTS
// ============================================

function handleDrawDiagram(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): void {
  const { type = "flowchart", nodes = [], edges, direction = "TB" } = params;

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

  // Get position (stacks below existing content)
  const { x: offsetX, y: offsetY } = getNextPosition(excalidrawAPI, diagramWidth, diagramHeight);

  const groupId = generateId();
  const newElements: any[] = [];

  // Create node elements
  layout.nodes.forEach((node: LayoutNode) => {
    const nodeX = offsetX + node.x * diagramScale;
    const nodeY = offsetY + node.y * diagramScale;
    const nodeW = node.width * diagramScale;
    const nodeH = node.height * diagramScale;
    const shape = getNodeShape(node.style);
    const seed = Math.floor(Math.random() * 100000);

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

    newElements.push(shapeElement);

    // Create label text element
    const labelFontSize = Math.max(10, Math.round(16 * diagramScale));
    const labelWidth = measureText(node.label, labelFontSize, 1).width;
    const labelHeight = measureText(node.label, labelFontSize, 1).height;

    newElements.push({
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
    });
  });

  // Create arrow elements for edges
  layout.edges.forEach((edge: LayoutEdge) => {
    if (edge.points.length < 2) return;

    const startX = offsetX + edge.points[0].x * diagramScale;
    const startY = offsetY + edge.points[0].y * diagramScale;
    const endX = offsetX + edge.points[edge.points.length - 1].x * diagramScale;
    const endY = offsetY + edge.points[edge.points.length - 1].y * diagramScale;

    const arrowPoints: [number, number][] = [
      [0, 0],
      [endX - startX, endY - startY],
    ];

    newElements.push({
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
    });

    // Add edge label if present
    if (edge.label) {
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2 - 15 * diagramScale;
      const labelFontSize = Math.max(10, Math.round(14 * diagramScale));
      const labelWidth = measureText(edge.label, labelFontSize, 1).width;
      const labelHeight = measureText(edge.label, labelFontSize, 1).height;

      newElements.push({
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
      });
    }
  });

  // Add all elements at once (no animation)
  const existingElements = excalidrawAPI.getSceneElements();
  excalidrawAPI.updateScene({
    elements: [...existingElements, ...newElements],
  });
}

// ============================================
// ANNOTATION HANDLER
// ============================================

async function handleAnnotate(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams,
  onAnimatedAnnotate?: OnAnimatedAnnotate
): Promise<void> {
  const { shape = "circle", x = 0.5, y = 0.5, width = 0.1, height = 0.1 } = params;

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

  // Build skeleton based on shape type
  let skeleton: any;
  const baseStyle = {
    strokeColor: "#e03131",
    strokeWidth: 3,
  };

  if (shape === "circle") {
    skeleton = {
      type: "ellipse",
      x: sceneX,
      y: sceneY,
      width: sceneWidth,
      height: sceneHeight,
      ...baseStyle,
    };
  } else if (shape === "rectangle") {
    skeleton = {
      type: "rectangle",
      x: sceneX,
      y: sceneY,
      width: sceneWidth,
      height: sceneHeight,
      ...baseStyle,
    };
  } else if (shape === "arrow") {
    const arrowLength = Math.max(sceneWidth, sceneHeight);
    skeleton = {
      type: "arrow",
      x: sceneX - arrowLength,
      y: sceneY - arrowLength / 2,
      points: [[0, 0], [arrowLength, arrowLength / 2]] as [number, number][],
      ...baseStyle,
    };
  } else {
    // Default to ellipse
    skeleton = {
      type: "ellipse",
      x: sceneX,
      y: sceneY,
      width: sceneWidth,
      height: sceneHeight,
      ...baseStyle,
    };
  }

  // Use convertToExcalidrawElements for cleaner element creation
  const convert = await getConvertToExcalidrawElements();
  const [element] = convert([skeleton]);

  excalidrawAPI.updateScene({
    elements: [...elements, element],
  });
}

// ============================================
// MATH GRAPH HANDLER
// ============================================

// Default dimensions for math graphs
const MATH_GRAPH_WIDTH = 300;
const MATH_GRAPH_HEIGHT = 200;

async function handleDrawFunction(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams,
  onAnimatedMathGraph?: OnAnimatedMathGraph
): Promise<void> {
  const { expression, xMin = -Math.PI, xMax = Math.PI } = params;

  if (!expression) {
    console.error("[handleDrawFunction] No expression provided");
    return;
  }

  // Get position (stacks below existing content)
  const { x: posX, y: posY } = getNextPosition(excalidrawAPI, MATH_GRAPH_WIDTH, MATH_GRAPH_HEIGHT);

  // Get viewport info to convert to screen coords
  const appState = excalidrawAPI.getAppState();
  const { scrollX, scrollY, zoom } = appState;
  const zoomValue = zoom?.value || 1;
  const viewportLeft = -scrollX;
  const viewportTop = -scrollY;
  const screenX = (posX - viewportLeft) * zoomValue;
  const screenY = (posY - viewportTop) * zoomValue;
  const screenWidth = MATH_GRAPH_WIDTH * zoomValue;
  const screenHeight = MATH_GRAPH_HEIGHT * zoomValue;

  // If callback provided, use animated version
  if (onAnimatedMathGraph) {
    onAnimatedMathGraph({
      expression,
      screenX,
      screenY,
      screenWidth,
      screenHeight,
      sceneX: posX,
      sceneY: posY,
      sceneWidth: MATH_GRAPH_WIDTH,
      sceneHeight: MATH_GRAPH_HEIGHT,
      xMin,
      xMax,
    });
    return;
  }

  // Fallback: render static graph without animation
  // This is used when no animation callback is provided (e.g., debug tests)
  try {
    const canvas = document.createElement("canvas");
    canvas.width = MATH_GRAPH_WIDTH * 2; // 2x for retina
    canvas.height = MATH_GRAPH_HEIGHT * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(2, 2);
    const w = MATH_GRAPH_WIDTH;
    const h = MATH_GRAPH_HEIGHT;
    const padding = 30;

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Draw axes
    ctx.strokeStyle = "#adb5bd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, h / 2);
    ctx.lineTo(w - padding, h / 2);
    ctx.moveTo(w / 2, padding);
    ctx.lineTo(w / 2, h - padding);
    ctx.stroke();

    // Parse and evaluate expression
    const plotWidth = w - 2 * padding;
    const plotHeight = h - 2 * padding;
    const steps = 100;
    const xRange = xMax - xMin;

    // Simple expression evaluator
    const evalExpr = (x: number): number => {
      try {
        // Replace common math functions and operators
        let expr = expression
          .replace(/\^/g, "**")
          .replace(/sin/g, "Math.sin")
          .replace(/cos/g, "Math.cos")
          .replace(/tan/g, "Math.tan")
          .replace(/sqrt/g, "Math.sqrt")
          .replace(/abs/g, "Math.abs")
          .replace(/log/g, "Math.log")
          .replace(/exp/g, "Math.exp")
          .replace(/pi/gi, "Math.PI")
          .replace(/e(?![xp])/g, "Math.E");
        // eslint-disable-next-line no-new-func
        return new Function("x", `return ${expr}`)(x);
      } catch {
        return NaN;
      }
    };

    // Calculate y range
    let yMin = Infinity, yMax = -Infinity;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * xRange;
      const y = evalExpr(x);
      if (isFinite(y)) {
        points.push({ x, y });
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }

    // Add padding to y range
    const yPadding = (yMax - yMin) * 0.1 || 1;
    yMin -= yPadding;
    yMax += yPadding;
    const yRange = yMax - yMin;

    // Draw the curve
    ctx.strokeStyle = "#6F47EB";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const pt of points) {
      const px = padding + ((pt.x - xMin) / xRange) * plotWidth;
      const py = padding + ((yMax - pt.y) / yRange) * plotHeight;
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // Add expression label
    ctx.fillStyle = "#1e1e1e";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(`y = ${expression}`, padding, padding - 10);

    // Convert to data URL and add as image
    const dataUrl = canvas.toDataURL("image/png");
    const fileId = generateId() as any;
    const elementId = generateId();

    const imageElement = {
      id: elementId,
      type: "image" as const,
      x: posX,
      y: posY,
      width: MATH_GRAPH_WIDTH,
      height: MATH_GRAPH_HEIGHT,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      strokeWidth: 1,
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

    const elements = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({
      elements: [...elements, imageElement],
    });

    excalidrawAPI.addFiles([
      {
        id: fileId,
        dataURL: dataUrl,
        mimeType: "image/png",
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    ]);
  } catch (error) {
    console.error("[handleDrawFunction] Failed to render static graph:", error);
  }
}

/**
 * Create image element from AnimatedMathGraphResult
 * Called after the animation completes
 */
export function createMathGraphElements(
  excalidrawAPI: ExcalidrawAPI,
  result: AnimatedMathGraphResult,
  sceneX: number,
  sceneY: number,
  sceneWidth: number,
  sceneHeight: number
): void {
  const elements = excalidrawAPI.getSceneElements();
  const fileId = generateId() as any; // FileId branded type
  const elementId = generateId();

  const imageElement = {
    id: elementId,
    type: "image" as const,
    x: sceneX,
    y: sceneY,
    width: sceneWidth,
    height: sceneHeight,
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
    index: "a0" as any,
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
      dataURL: result.svgDataUrl,
      mimeType: "image/svg+xml",
      created: Date.now(),
      lastRetrieved: Date.now(),
    },
  ]);
}

// ============================================
// ANIMATION HANDLER - NATIVE EXCALIDRAW IFRAME ELEMENT
// ============================================

/**
 * Build p5.js animation HTML for srcdoc
 */
function buildAnimationHTML(code: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<style>
body { margin: 0; padding: 0; overflow: hidden; background: #1a1a2e; }
canvas { display: block; }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"><\/script>
</head>
<body>
<script>
window.onerror = function(msg) {
  document.body.innerHTML = '<div style="color:red;padding:20px;">Error: ' + msg + '</div>';
  return false;
};
${code}
<\/script>
</body>
</html>`;
}

// Animation element dimensions - must match p5.js createCanvas(600, 400) in p5_subagent.py
const ANIM_WIDTH = 600;
const ANIM_HEIGHT = 400;

/**
 * Create an iframe element for animation
 */
function createIframeElement(
  id: string,
  x: number,
  y: number,
  html: string,
  status: "pending" | "done"
): any {
  return {
    id,
    type: "iframe" as const,
    x,
    y,
    width: ANIM_WIDTH,
    height: ANIM_HEIGHT,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "#1a1a2e",
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0" as any,
    roundness: { type: 3 },
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: {
      generationData: {
        status,
        html,
      },
    },
  };
}

/**
 * Create animation as native Excalidraw iframe element
 * Uses placeholder pattern to reserve space immediately
 */
async function handleAnimate(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): Promise<void> {
  const { code, prompt } = params;

  // Get position (stacks below existing content)
  const { x: posX, y: posY } = getNextPosition(excalidrawAPI, ANIM_WIDTH, ANIM_HEIGHT);

  const elementId = generateId();

  // If code is provided directly, create the animation immediately
  if (code) {
    const html = buildAnimationHTML(code);
    const iframeElement = createIframeElement(elementId, posX, posY, html, "done");

    const elements = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({
      elements: [...elements, iframeElement],
    });
    return;
  }

  // If prompt is provided, show placeholder rectangle then fetch code
  if (prompt) {
    const placeholderId = generateId();
    const loadingTextId = generateId();
    const groupId = generateId();

    // Create placeholder rectangle (reserves the exact space)
    const placeholderElement = {
      id: placeholderId,
      type: "rectangle" as const,
      x: posX,
      y: posY,
      width: ANIM_WIDTH,
      height: ANIM_HEIGHT,
      angle: 0,
      strokeColor: "#adb5bd",
      backgroundColor: "#1a1a2e",
      fillStyle: "solid" as const,
      strokeWidth: 1,
      strokeStyle: "dashed" as const,
      roughness: 0,
      opacity: 50,
      groupIds: [groupId],
      frameId: null,
      index: "a0" as const,
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

    // Create loading text centered in placeholder
    const loadingText = "\u23F3 Loading...";
    const loadingFontSize = 20;
    const { width: textWidth, height: textHeight } = measureText(loadingText, loadingFontSize, 1);
    const loadingTextElement = {
      id: loadingTextId,
      type: "text" as const,
      x: posX + (ANIM_WIDTH - textWidth) / 2,
      y: posY + (ANIM_HEIGHT - textHeight) / 2,
      width: textWidth,
      height: textHeight,
      angle: 0,
      strokeColor: "#868e96",
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      strokeWidth: 2,
      strokeStyle: "solid" as const,
      roughness: 1,
      opacity: 100,
      groupIds: [groupId],
      frameId: null,
      index: "a1" as const,
      roundness: null,
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      text: loadingText,
      fontSize: loadingFontSize,
      fontFamily: 1,
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
      containerId: null,
      originalText: loadingText,
      autoResize: true,
      lineHeight: 1.25,
    };

    // Add placeholder and loading text to scene immediately
    let elements = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({
      elements: [...elements, placeholderElement, loadingTextElement],
    });

    try {
      const response = await fetch("/api/p5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      // Remove placeholder and loading text
      elements = excalidrawAPI.getSceneElements();
      elements = elements.filter((el: any) => el.id !== placeholderId && el.id !== loadingTextId);

      if (!response.ok) {
        excalidrawAPI.updateScene({ elements });
        return;
      }

      const data = await response.json();

      if (data.error || !data.code) {
        excalidrawAPI.updateScene({ elements });
        return;
      }

      // Add the real animation element
      const html = buildAnimationHTML(data.code);
      const iframeElement = createIframeElement(elementId, posX, posY, html, "done");

      excalidrawAPI.updateScene({
        elements: [...elements, iframeElement],
      });

    } catch {
      // Remove placeholder and loading text on error
      elements = excalidrawAPI.getSceneElements();
      excalidrawAPI.updateScene({
        elements: elements.filter((el: any) => el.id !== placeholderId && el.id !== loadingTextId),
      });
    }
  }
}

// ============================================
// QUESTION HANDLER
// ============================================

function handleShowQuestion(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): void {
  const {
    question_type = "mcq",
    question = "",
    options = [],
    hint,
  } = params;

  if (!question) return;

  const groupId = generateId();
  const newElements: any[] = [];

  // Format the question content based on type
  let formattedContent = "";
  const fontSize = 24;
  const optionFontSize = 20;
  const hintFontSize = 16;
  const fontFamily = 1; // Virgil

  // Question type emoji and label
  const typeLabels: Record<string, { emoji: string; label: string }> = {
    mcq: { emoji: "🔘", label: "Multiple Choice" },
    fill_blank: { emoji: "✏️", label: "Fill in the Blank" },
    long_answer: { emoji: "📝", label: "Long Answer" },
  };

  const { emoji, label } = typeLabels[question_type] || typeLabels.mcq;

  // Build question header
  formattedContent = `${emoji} ${label}`;
  const headerDims = measureText(formattedContent, fontSize, fontFamily);

  // Calculate position for the question box
  const padding = 20;
  const lineHeight = 1.4;

  // Measure question text
  const questionDims = measureText(question, fontSize, fontFamily);

  // Measure options (for MCQ)
  let optionsHeight = 0;
  const optionLabels = ["A", "B", "C", "D"];
  const formattedOptions: string[] = [];
  if (question_type === "mcq" && options.length > 0) {
    for (let i = 0; i < options.length && i < 4; i++) {
      formattedOptions.push(`${optionLabels[i]}) ${options[i]}`);
    }
    optionsHeight = formattedOptions.length * (optionFontSize * lineHeight + 8);
  }

  // Measure hint
  let hintHeight = 0;
  let hintText = "";
  if (hint) {
    hintText = `💡 Hint: ${hint}`;
    hintHeight = measureText(hintText, hintFontSize, fontFamily).height + 16;
  }

  // Calculate total box dimensions
  const contentWidth = Math.max(
    headerDims.width,
    questionDims.width,
    ...formattedOptions.map(opt => measureText(opt, optionFontSize, fontFamily).width),
    hint ? measureText(hintText, hintFontSize, fontFamily).width : 0
  ) + padding * 2;

  const contentHeight =
    headerDims.height +
    16 + // gap after header
    questionDims.height +
    (optionsHeight > 0 ? 20 + optionsHeight : 0) + // gap + options
    (hintHeight > 0 ? hintHeight : 0) +
    padding * 2;

  // Get position
  const { x: posX, y: posY } = getNextPosition(excalidrawAPI, contentWidth, contentHeight);

  // 1. Create background box with purple accent
  newElements.push({
    id: generateId(),
    type: "rectangle" as const,
    x: posX,
    y: posY,
    width: contentWidth,
    height: contentHeight,
    angle: 0,
    strokeColor: "#9D7CD8",
    backgroundColor: "#f8f5ff",
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    groupIds: [groupId],
    frameId: null,
    index: "a0" as const,
    roundness: { type: 3 },
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  });

  // 2. Create header text
  let currentY = posY + padding;
  newElements.push({
    id: generateId(),
    type: "text" as const,
    x: posX + padding,
    y: currentY,
    width: headerDims.width,
    height: headerDims.height,
    angle: 0,
    strokeColor: "#6F47EB",
    backgroundColor: "transparent",
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    groupIds: [groupId],
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
    text: formattedContent,
    fontSize: fontSize,
    fontFamily: fontFamily,
    textAlign: "left" as const,
    verticalAlign: "top" as const,
    containerId: null,
    originalText: formattedContent,
    autoResize: true,
    lineHeight: 1.25,
  });

  currentY += headerDims.height + 16;

  // 3. Create question text
  newElements.push({
    id: generateId(),
    type: "text" as const,
    x: posX + padding,
    y: currentY,
    width: questionDims.width,
    height: questionDims.height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    groupIds: [groupId],
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
    text: question,
    fontSize: fontSize,
    fontFamily: fontFamily,
    textAlign: "left" as const,
    verticalAlign: "top" as const,
    containerId: null,
    originalText: question,
    autoResize: true,
    lineHeight: 1.25,
  });

  currentY += questionDims.height + 20;

  // 4. Create options (for MCQ)
  if (question_type === "mcq" && formattedOptions.length > 0) {
    for (const opt of formattedOptions) {
      const optDims = measureText(opt, optionFontSize, fontFamily);
      newElements.push({
        id: generateId(),
        type: "text" as const,
        x: posX + padding + 16, // indent options
        y: currentY,
        width: optDims.width,
        height: optDims.height,
        angle: 0,
        strokeColor: "#495057",
        backgroundColor: "transparent",
        fillStyle: "solid" as const,
        strokeWidth: 2,
        strokeStyle: "solid" as const,
        roughness: 1,
        opacity: 100,
        groupIds: [groupId],
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
        text: opt,
        fontSize: optionFontSize,
        fontFamily: fontFamily,
        textAlign: "left" as const,
        verticalAlign: "top" as const,
        containerId: null,
        originalText: opt,
        autoResize: true,
        lineHeight: 1.25,
      });
      currentY += optDims.height + 8;
    }
  }

  // 5. Create hint (if provided)
  if (hint) {
    currentY += 8; // extra gap before hint
    const hintDims = measureText(hintText, hintFontSize, fontFamily);
    newElements.push({
      id: generateId(),
      type: "text" as const,
      x: posX + padding,
      y: currentY,
      width: hintDims.width,
      height: hintDims.height,
      angle: 0,
      strokeColor: "#868e96",
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      strokeWidth: 2,
      strokeStyle: "solid" as const,
      roughness: 1,
      opacity: 100,
      groupIds: [groupId],
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
      text: hintText,
      fontSize: hintFontSize,
      fontFamily: fontFamily,
      textAlign: "left" as const,
      verticalAlign: "top" as const,
      containerId: null,
      originalText: hintText,
      autoResize: true,
      lineHeight: 1.25,
    });
  }

  // Add all elements
  const existingElements = excalidrawAPI.getSceneElements();
  excalidrawAPI.updateScene({
    elements: [...existingElements, ...newElements],
  });
}

// ============================================
// MAIN TOOL DISPATCHER
// ============================================

function handleToolCall(
  excalidrawAPI: any,
  toolName: string,
  params: ToolParams,
  onAnimatedAnnotate?: OnAnimatedAnnotate,
  onAnimatedMathGraph?: OnAnimatedMathGraph
): void {
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
    case "annotate":
      handleAnnotate(excalidrawAPI, params, onAnimatedAnnotate);
      break;
    case "animate":
      handleAnimate(excalidrawAPI, params);
      break;
    case "draw_function":
      handleDrawFunction(excalidrawAPI, params, onAnimatedMathGraph);
      break;
    case "show_question":
      handleShowQuestion(excalidrawAPI, params);
      break;
    case "draw_table":
      break;
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
  onAnimatedAnnotate?: OnAnimatedAnnotate,
  onAnimatedMathGraph?: OnAnimatedMathGraph
): void {
  handleToolCall(excalidrawAPI, toolName, params, onAnimatedAnnotate, onAnimatedMathGraph);
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
  } catch {
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
              try {
                const response = await fetch("/api/draw", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ query: msg.params.query }),
                });

                if (!response.ok) {
                  return;
                }

                const data = await response.json();

                // Execute each tool call (same as test-draw page)
                if (data.toolCalls && Array.isArray(data.toolCalls)) {
                  for (const toolCall of data.toolCalls) {
                    handleToolCall(excalidrawAPIRef.current, toolCall.tool, toolCall.params);
                    // Small delay between tool calls
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                }
              } catch {
                // Silent fail
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
          }
        } catch {
          // Silent fail
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
