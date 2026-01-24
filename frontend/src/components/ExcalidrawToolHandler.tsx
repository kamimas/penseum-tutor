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
}

// Track last element for relative positioning (lookup current bounds when needed)
// For single elements: stores element ID
// For diagrams: stores groupId (prefixed with "group:")
// For animations: stores animationId (prefixed with "animation:")
let lastElementId: string | null = null;

// Track animations as native Excalidraw elements
// We render p5.js to a hidden canvas, capture frames, and update an image element
interface AnimationElement {
  id: string;
  elementId: string;  // Excalidraw element ID
  fileId: string;     // Excalidraw file ID for the image
  canvas: HTMLCanvasElement;
  p5Instance: any;    // p5.js instance
  intervalId: number; // For frame updates
  width: number;
  height: number;
}
const animationElements: Map<string, AnimationElement> = new Map();

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
 * Scroll the viewport to ensure a position is visible.
 * Called after placing an element to keep it in view.
 * Uses Excalidraw's native scrollToContent with smooth animation.
 */
function scrollToShowPosition(
  excalidrawAPI: ExcalidrawAPI,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const appState = excalidrawAPI.getAppState();
  const { scrollY, zoom, height: viewportHeight } = appState;
  const zoomValue = zoom?.value || 1;

  // Calculate viewport bounds in scene coordinates
  const viewportTop = -scrollY;
  const viewportH = (viewportHeight || 720) / zoomValue;
  const viewportBottom = viewportTop + viewportH;

  // Check if element bottom is below viewport
  const elementBottom = y + height;
  const padding = 50; // Keep some padding from edge

  if (elementBottom > viewportBottom - padding) {
    // Calculate how much we need to scroll down
    const scrollAmount = elementBottom - viewportBottom + padding + 50;

    // Update scroll position directly - more reliable than scrollToContent
    // scrollY is negative (scroll down = more negative)
    const newScrollY = scrollY - scrollAmount;

    excalidrawAPI.updateScene({
      appState: {
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

  // If there's existing content and position is "center", place below last instead
  // This prevents new batches from overlapping previous content
  const effectivePosition = (position === "center" && lastElementId) ? "below-last" : position;

  // Handle relative positions - lookup current bounds from scene
  if (effectivePosition === "below-last" || effectivePosition === "right-of-last") {
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
        // Animation elements are now native Excalidraw elements, look them up directly
        const animId = lastElementId.slice(10);
        const anim = animationElements.get(animId);
        if (anim) {
          const animElement = elements.find((el: any) => el.id === anim.elementId && !el.isDeleted);
          if (animElement) {
            lastBounds = {
              x: animElement.x,
              y: animElement.y,
              width: animElement.width,
              height: animElement.height,
            };
          }
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

  // Auto-scroll to show the element if it's below the viewport
  scrollToShowPosition(
    excalidrawAPI,
    proposedX,
    proposedY,
    elementWidth,
    elementHeight
  );

  return { x: proposedX, y: proposedY };
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

// Animation timing for text
const TEXT_WORD_DELAY = 150; // ms between words appearing

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
    position = "center",
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
    handleAddLatex(excalidrawAPI, displayContent, fontSize, position as PositionType);
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

  // Calculate position based on position parameter
  const { x: posX, y: posY } = calculatePosition(
    excalidrawAPI,
    position as PositionType,
    totalWidth,
    height
  );

  // Get current elements
  const existingElements = excalidrawAPI.getSceneElements();

  // Build animation queue
  type AnimationItem = { element: any; delay: number };
  const animationQueue: AnimationItem[] = [];
  let currentDelay = 0;

  // Text position (offset by accent bar if present)
  const textX = posX + accentBarWidth + accentGap;
  const textY = posY;

  // 1. Create accent bar if specified
  if (accent && accent !== "none") {
    const accentElement = {
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
    };
    animationQueue.push({ element: accentElement, delay: currentDelay });
    currentDelay += 50; // Small delay before text starts
  }

  // 2. Create text elements word by word for typing animation
  const words = displayContent.split(" ");
  let currentText = "";

  for (let i = 0; i < words.length; i++) {
    currentText = words.slice(0, i + 1).join(" ");
    const { width: currentWidth } = measureText(currentText, fontSize, fontFamily);

    const textElement = {
      id: generateId(),
      type: "text" as const,
      x: textX,
      y: textY,
      width: currentWidth,
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
      text: currentText,
      fontSize: fontSize,
      fontFamily: fontFamily,
      textAlign: "left" as const,
      verticalAlign: "top" as const,
      containerId: null,
      originalText: currentText,
      autoResize: true,
      lineHeight: 1.25,
    };

    // Mark intermediate text elements for removal (except the last one)
    animationQueue.push({
      element: { ...textElement, _isIntermediate: i < words.length - 1 },
      delay: currentDelay
    });
    currentDelay += TEXT_WORD_DELAY;
  }

  // 3. Create underlines if specified
  if (underline && underline.length > 0) {
    const underlineY = textY + height + 2; // Just below the text
    const underlineHeight = 3;

    for (const word of underline) {
      const position = measureSubstringPosition(displayContent, word, fontSize, fontFamily);
      if (position) {
        const underlineElement = {
          id: generateId(),
          type: "rectangle" as const,
          x: textX + position.startX,
          y: underlineY,
          width: position.width,
          height: underlineHeight,
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
        };
        animationQueue.push({ element: underlineElement, delay: currentDelay });
        currentDelay += 50; // Small delay between underlines
      }
    }
  }

  // Animate: add elements sequentially, removing intermediate text elements
  // Use object to avoid closure issues with setTimeout
  const state = {
    elements: [...existingElements],
    lastTextElementId: null as string | null,
  };

  animationQueue.forEach(({ element, delay }) => {
    setTimeout(() => {
      // If this is a text element and there's a previous intermediate one, remove it
      if (element.type === "text" && state.lastTextElementId) {
        state.elements = state.elements.filter(el => el.id !== state.lastTextElementId);
      }

      // Add the new element (without the _isIntermediate flag)
      const { _isIntermediate, ...cleanElement } = element;
      state.elements = [...state.elements, cleanElement];

      // Track intermediate text elements for removal
      if (element.type === "text" && _isIntermediate) {
        state.lastTextElementId = cleanElement.id;
      } else if (element.type === "text") {
        state.lastTextElementId = null; // Final text element, don't remove
      }

      excalidrawAPI.updateScene({
        elements: state.elements,
      });
    }, delay);
  });

  // Track for relative positioning (use group ID)
  setLastElementId(`group:${groupId}`);
}

/**
 * Handle LaTeX content by rendering to SVG and adding as image
 */
async function handleAddLatex(
  excalidrawAPI: ExcalidrawAPI,
  content: string,
  fontSize: number,
  position: PositionType
): Promise<void> {
  const convert = await getConvertToExcalidrawElements();

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

    const fileId = generateId() as any; // FileId branded type

    // Use convertToExcalidrawElements for cleaner element creation
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

    setLastElementId(imageElement.id);
  } catch (error) {
    console.error("[handleAddLatex] Failed to render LaTeX:", error);
    // Fallback to plain text if LaTeX rendering fails
    const elements = excalidrawAPI.getSceneElements();
    const fontFamily = 1;
    const { width, height } = measureText(content, fontSize, fontFamily);
    const { x: posX, y: posY } = calculatePosition(excalidrawAPI, position, width, height);

    // Use convertToExcalidrawElements for cleaner element creation
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
    setLastElementId(textElement.id);
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

    // Generate file ID
    const fileId = generateId() as any; // FileId branded type

    // Calculate position based on position parameter
    const elements = excalidrawAPI.getSceneElements();
    const { x: posX, y: posY } = calculatePosition(
      excalidrawAPI,
      position as PositionType,
      width,
      height
    );

    // Use convertToExcalidrawElements for cleaner element creation
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
    setLastElementId(imageElement.id);
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

  setLastElementId(element.id);
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
  const { expression, position = "center", xMin = -Math.PI, xMax = Math.PI } = params;

  if (!expression) {
    console.error("[handleDrawFunction] No expression provided");
    return;
  }

  // Get viewport info to convert normalized coords
  const appState = excalidrawAPI.getAppState();
  const { scrollX, scrollY, zoom } = appState;
  const zoomValue = zoom?.value || 1;

  // Calculate position based on position parameter
  const { x: posX, y: posY } = calculatePosition(
    excalidrawAPI,
    position as PositionType,
    MATH_GRAPH_WIDTH,
    MATH_GRAPH_HEIGHT
  );

  // Calculate screen pixel coordinates (for SVG overlay)
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

  setLastElementId(elementId);
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
 * Shows a text placeholder immediately, then replaces with iframe when code is ready
 */
async function handleAnimate(
  excalidrawAPI: ExcalidrawAPI,
  params: ToolParams
): Promise<void> {
  const { code, prompt, position = "center" } = params;

  // Calculate position IMMEDIATELY before any async work
  const { x: posX, y: posY } = calculatePosition(
    excalidrawAPI,
    position as PositionType,
    ANIM_WIDTH,
    ANIM_HEIGHT
  );

  const elementId = generateId();

  // If code is provided directly, create the animation immediately
  if (code) {
    const html = buildAnimationHTML(code);
    const iframeElement = createIframeElement(elementId, posX, posY, html, "done");

    const elements = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({
      elements: [...elements, iframeElement],
    });

    setLastElementId(elementId);
    return;
  }

  // If prompt is provided, show text placeholder then fetch code
  if (prompt) {
    const placeholderId = `placeholder-${elementId}`;

    // Create a text placeholder element (native Excalidraw - moves with canvas)
    const placeholderText = "⏳ Loading animation...";
    const fontSize = 20;
    const { width: textWidth, height: textHeight } = measureText(placeholderText, fontSize, 1);

    // Center the text within where the animation will be
    const textX = posX + (ANIM_WIDTH - textWidth) / 2;
    const textY = posY + (ANIM_HEIGHT - textHeight) / 2;

    const placeholderElement = {
      id: placeholderId,
      type: "text" as const,
      x: textX,
      y: textY,
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
      text: placeholderText,
      fontSize,
      fontFamily: 1,
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
      containerId: null,
      originalText: placeholderText,
      autoResize: true,
      lineHeight: 1.25,
    };

    // Add placeholder to scene
    let elements = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({
      elements: [...elements, placeholderElement],
    });

    // Set lastElementId now so subsequent tools position relative to where this will be
    setLastElementId(elementId);

    try {
      const response = await fetch("/api/p5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        // Update placeholder to show error
        elements = excalidrawAPI.getSceneElements();
        excalidrawAPI.updateScene({
          elements: elements.map((el: any) =>
            el.id === placeholderId
              ? { ...el, text: "❌ Animation failed", originalText: "❌ Animation failed", strokeColor: "#e03131" }
              : el
          ),
        });
        return;
      }

      const data = await response.json();

      if (data.error || !data.code) {
        // Update placeholder to show error
        elements = excalidrawAPI.getSceneElements();
        excalidrawAPI.updateScene({
          elements: elements.map((el: any) =>
            el.id === placeholderId
              ? { ...el, text: "❌ Animation failed", originalText: "❌ Animation failed", strokeColor: "#e03131" }
              : el
          ),
        });
        return;
      }

      // Remove placeholder and add the real animation element
      const html = buildAnimationHTML(data.code);
      const iframeElement = createIframeElement(elementId, posX, posY, html, "done");

      elements = excalidrawAPI.getSceneElements();
      excalidrawAPI.updateScene({
        elements: [
          ...elements.filter((el: any) => el.id !== placeholderId),
          iframeElement,
        ],
      });

    } catch {
      // Update placeholder to show error
      elements = excalidrawAPI.getSceneElements();
      excalidrawAPI.updateScene({
        elements: elements.map((el: any) =>
          el.id === placeholderId
            ? { ...el, text: "❌ Animation failed", originalText: "❌ Animation failed", strokeColor: "#e03131" }
            : el
        ),
      });
    }
    return;
  }
}

/**
 * Clear all animations - native elements are cleared with clear_board
 */
function clearAnimations(): void {
  animationElements.clear();
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
      clearAnimations();
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
