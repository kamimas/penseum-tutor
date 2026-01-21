"use client";
import {
  Tldraw,
  useEditor,
  TLComponents,
  createShapeId,
  Editor,
} from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { useRef, useState, useCallback } from "react";
import { PlotShapeUtil } from "../../components/shapes/PlotShapeUtil";
import { TutorImageShapeUtil } from "../../components/shapes/TutorImageShapeUtil";

const LAYOUT = {
  LEFT_MARGIN: 50,
  PADDING: 30,
  PLOT_SIZE: { w: 450, h: 350 },
  IMAGE_SIZE: { w: 400, h: 300 },
};

class LayoutManager {
  private cursorY: number = LAYOUT.PADDING;

  getCurrentY(): number {
    return this.cursorY;
  }

  advanceCursor(height: number): void {
    this.cursorY += height + LAYOUT.PADDING;
  }

  reset(): void {
    this.cursorY = LAYOUT.PADDING;
  }
}

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

const customShapeUtils = [PlotShapeUtil, TutorImageShapeUtil];

function TestPanel({ onTest }: { onTest: (tool: string, params: any) => void }) {
  const [equation, setEquation] = useState("x^2");
  const [imageQuery, setImageQuery] = useState("pythagorean theorem diagram");

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        width: 300,
        background: "white",
        borderRadius: 12,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        padding: 20,
        zIndex: 1000,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Tool Tester</h2>

      {/* add_text */}
      <Section title="add_text">
        <Btn onClick={() => onTest("add_text", { content: "Quadratic Functions", size: "large" })}>
          Title (large)
        </Btn>
        <Btn onClick={() => onTest("add_text", { content: "A quadratic has the form f(x) = ax² + bx + c", size: "medium" })}>
          Explanation (medium)
        </Btn>
        <Btn onClick={() => onTest("add_text", { content: "Note: a determines direction", size: "small" })}>
          Annotation (small)
        </Btn>
      </Section>

      {/* plot_function */}
      <Section title="plot_function">
        <input
          type="text"
          value={equation}
          onChange={(e) => setEquation(e.target.value)}
          style={inputStyle}
          placeholder="e.g., x^2, sin(x)"
        />
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Btn onClick={() => onTest("plot_function", { equation })} primary>
            Plot
          </Btn>
          <Btn onClick={() => setEquation("sin(x)")}>sin</Btn>
          <Btn onClick={() => setEquation("x^3 - x")}>x³-x</Btn>
          <Btn onClick={() => setEquation("sqrt(x)")}>√x</Btn>
          <Btn onClick={() => setEquation("cos(x)")}>cos</Btn>
        </div>
      </Section>

      {/* show_image */}
      <Section title="show_image">
        <input
          type="text"
          value={imageQuery}
          onChange={(e) => setImageQuery(e.target.value)}
          style={inputStyle}
          placeholder="Search query..."
        />
        <Btn onClick={() => onTest("show_image", { query: imageQuery })} primary full>
          Search Image
        </Btn>
      </Section>

      {/* clear_board */}
      <Btn onClick={() => onTest("clear_board", {})} danger full>
        Clear Board
      </Btn>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 8, fontWeight: 500 }}>{title}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  primary,
  danger,
  full,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  full?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        border: "none",
        background: danger ? "#ef4444" : primary ? "#3b82f6" : "#f3f4f6",
        color: danger || primary ? "white" : "#374151",
        cursor: "pointer",
        fontSize: 13,
        width: full ? "100%" : "auto",
        marginTop: full ? 8 : 0,
      }}
    >
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 6,
  border: "1px solid #e5e7eb",
  fontSize: 14,
  boxSizing: "border-box",
};

function CanvasWithControls() {
  const editorRef = useRef<Editor | null>(null);
  const layoutRef = useRef<LayoutManager>(new LayoutManager());
  const [status, setStatus] = useState<string>("");

  const handleTest = useCallback(async (tool: string, params: any) => {
    const editor = editorRef.current;
    const layout = layoutRef.current;

    if (!editor) {
      setStatus("Editor not ready");
      return;
    }

    setStatus(`${tool}...`);

    try {
      switch (tool) {
        case "add_text": {
          const { content = "", size = "medium" } = params;
          const shapeId = createShapeId();
          const y = layout.getCurrentY();
          const sizeMap: Record<string, string> = { small: "s", medium: "l", large: "xl" };
          const heights: Record<string, number> = { small: 30, medium: 50, large: 70 };

          editor.createShapes([
            {
              id: shapeId,
              type: "text",
              x: LAYOUT.LEFT_MARGIN,
              y: y,
              props: {
                text: content,
                size: sizeMap[size] || "l",
                color: "black",
                font: "sans",
                autoSize: true,
              },
            },
          ]);
          layout.advanceCursor(heights[size] || 50);
          setStatus(`Text added at y=${y}`);
          break;
        }

        case "plot_function": {
          const { equation = "x^2" } = params;
          const shapeId = createShapeId();
          const y = layout.getCurrentY();

          editor.createShapes([
            {
              id: shapeId,
              type: "plot",
              x: LAYOUT.LEFT_MARGIN,
              y: y,
              props: {
                w: LAYOUT.PLOT_SIZE.w,
                h: LAYOUT.PLOT_SIZE.h,
                equation: equation,
                xDomain: [-10, 10],
                yDomain: [-10, 10],
                color: "#3b82f6",
              },
            },
          ]);

          layout.advanceCursor(LAYOUT.PLOT_SIZE.h);
          setStatus(`Plotted: ${equation}`);
          break;
        }

        case "show_image": {
          const { query } = params;
          const shapeId = createShapeId();
          const y = layout.getCurrentY();

          setStatus(`Searching: "${query}"...`);

          const response = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`);
          const data = await response.json();

          if (data.url) {
            editor.createShapes([
              {
                id: shapeId,
                type: "tutor-image",
                x: LAYOUT.LEFT_MARGIN,
                y: y,
                props: {
                  w: LAYOUT.IMAGE_SIZE.w,
                  h: LAYOUT.IMAGE_SIZE.h,
                  url: data.url,
                  alt: query,
                },
              },
            ]);
            layout.advanceCursor(LAYOUT.IMAGE_SIZE.h);
            setStatus(`Image loaded`);
          } else {
            setStatus(`No image found for "${query}"`);
          }
          break;
        }

        case "clear_board": {
          const allShapeIds = editor.getCurrentPageShapeIds();
          if (allShapeIds.size > 0) {
            editor.deleteShapes(Array.from(allShapeIds));
          }
          layout.reset();
          editor.setCamera({ x: 0, y: 0, z: 1 });
          setStatus("Board cleared");
          break;
        }
      }

      // Auto-scroll
      const currentY = layout.getCurrentY();
      if (currentY > 400) {
        editor.setCamera({ x: 0, y: -(currentY - 400), z: 1 });
      }
    } catch (error) {
      setStatus(`Error: ${error}`);
    }
  }, []);

  return (
    <>
      <TestPanel onTest={handleTest} />

      <div
        style={{
          position: "fixed",
          bottom: 20,
          left: 20,
          right: 340,
          padding: "10px 16px",
          background: "rgba(0,0,0,0.8)",
          color: "white",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 13,
          zIndex: 1000,
        }}
      >
        {status || "Ready"}
      </div>

      <div style={{ position: "fixed", inset: 0 }}>
        <Tldraw
          shapeUtils={customShapeUtils}
          components={components}
          hideUi={true}
          onMount={(editor) => {
            editorRef.current = editor;
            editor.setCamera({ x: 0, y: 0, z: 1 });
          }}
        />
      </div>
    </>
  );
}

export default function TestPage() {
  return <CanvasWithControls />;
}
