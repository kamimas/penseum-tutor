"use client";
import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import { triggerToolCall, AnimatedAnnotateRequest, AnimatedMathGraphRequest, createMathGraphElements } from "../../components/ExcalidrawToolHandler";
import { AnimatedAnnotation, AnimatedAnnotationResult } from "../../components/AnimatedAnnotation";
import { AnimatedMathGraph, AnimatedMathGraphResult } from "../../components/AnimatedMathGraph";

// Dynamic import - Excalidraw doesn't support SSR
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <div style={{ padding: 40 }}>Loading canvas...</div> }
);

export default function TestDrawPage() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<any>(null);
  // State for animated annotation overlay
  const [animatedAnnotation, setAnimatedAnnotation] = useState<{
    shape: "circle" | "rectangle";
    // Screen coords for SVG overlay
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    // Scene coords for freedraw element (pre-calculated by handler)
    sceneX: number;
    sceneY: number;
    sceneWidth: number;
    sceneHeight: number;
  } | null>(null);

  // State for animated math graph overlay
  const [animatedMathGraph, setAnimatedMathGraph] = useState<{
    expression: string;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    sceneX: number;
    sceneY: number;
    sceneWidth: number;
    sceneHeight: number;
    xMin?: number;
    xMax?: number;
  } | null>(null);

  // Callback for animated annotations - triggered by triggerToolCall
  const handleAnimatedAnnotate = useCallback((request: AnimatedAnnotateRequest) => {
    setAnimatedAnnotation({
      shape: request.shape,
      screenX: request.screenX,
      screenY: request.screenY,
      screenWidth: request.screenWidth,
      screenHeight: request.screenHeight,
      sceneX: request.sceneX,
      sceneY: request.sceneY,
      sceneWidth: request.sceneWidth,
      sceneHeight: request.sceneHeight,
    });
  }, []);

  // Callback for animated math graphs - triggered by triggerToolCall
  const handleAnimatedMathGraph = useCallback((request: AnimatedMathGraphRequest) => {
    setAnimatedMathGraph({
      expression: request.expression,
      screenX: request.screenX,
      screenY: request.screenY,
      screenWidth: request.screenWidth,
      screenHeight: request.screenHeight,
      sceneX: request.sceneX,
      sceneY: request.sceneY,
      sceneWidth: request.sceneWidth,
      sceneHeight: request.sceneHeight,
      xMin: request.xMin,
      xMax: request.xMax,
    });
  }, []);

  // Create freedraw element from animation result
  const createFreedrawElement = useCallback((result: AnimatedAnnotationResult) => {
    if (!excalidrawAPI || !animatedAnnotation) return;

    // Use pre-calculated scene coordinates from the annotation request
    const freedrawStrokeWidth = 0.5;

    const freedrawElement = {
      id: `freedraw-${Date.now()}`,
      type: "freedraw" as const,
      x: animatedAnnotation.sceneX,
      y: animatedAnnotation.sceneY,
      width: animatedAnnotation.sceneWidth,
      height: animatedAnnotation.sceneHeight,
      angle: 0,
      strokeColor: result.strokeColor,
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      strokeWidth: freedrawStrokeWidth,
      strokeStyle: "solid" as const,
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: "a0",
      roundness: null,
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      // Freedraw-specific
      points: result.points,
      pressures: result.pressures,
      simulatePressure: false,
      lastCommittedPoint: null,
    };

    // Add to scene
    const elements = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({
      elements: [...elements, freedrawElement],
    });

    // Clear the animated overlay
    setAnimatedAnnotation(null);
  }, [excalidrawAPI, animatedAnnotation]);

  // Create freedraw elements from math graph animation result
  const handleMathGraphComplete = useCallback((result: AnimatedMathGraphResult) => {
    if (!excalidrawAPI || !animatedMathGraph) return;

    createMathGraphElements(
      excalidrawAPI,
      result,
      animatedMathGraph.sceneX,
      animatedMathGraph.sceneY,
      animatedMathGraph.sceneWidth,
      animatedMathGraph.sceneHeight
    );

    // Clear the animated overlay
    setAnimatedMathGraph(null);
  }, [excalidrawAPI, animatedMathGraph]);

  // Capture canvas to base64
  const captureCanvas = (): string | null => {
    try {
      const canvas = document.querySelector(".excalidraw__canvas") as HTMLCanvasElement;
      if (!canvas) {
        console.warn("Could not find Excalidraw canvas");
        return null;
      }
      // Get data URL and strip the prefix to get pure base64
      const dataUrl = canvas.toDataURL("image/png");
      return dataUrl.replace(/^data:image\/png;base64,/, "");
    } catch (e) {
      console.error("Failed to capture canvas:", e);
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!query.trim() || !excalidrawAPI) return;

    setLoading(true);
    setError("");
    setLastResult(null);

    try {
      // Always capture screenshot
      const screenshot = captureCanvas();

      const response = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, screenshot }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to process query");
      }

      const data = await response.json();
      setLastResult(data);

      // Execute each tool call
      if (data.toolCalls && Array.isArray(data.toolCalls)) {
        for (const toolCall of data.toolCalls) {
          triggerToolCall(excalidrawAPI, toolCall.tool, toolCall.params, handleAnimatedAnnotate, handleAnimatedMathGraph);
          // Small delay between tool calls
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to process query");
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {/* Animated Annotation Overlay */}
      {animatedAnnotation && (
        <AnimatedAnnotation
          shape={animatedAnnotation.shape}
          x={animatedAnnotation.screenX}
          y={animatedAnnotation.screenY}
          width={animatedAnnotation.screenWidth}
          height={animatedAnnotation.screenHeight}
          onComplete={createFreedrawElement}
        />
      )}

      {/* Animated Math Graph Overlay */}
      {animatedMathGraph && (
        <AnimatedMathGraph
          expression={animatedMathGraph.expression}
          x={animatedMathGraph.screenX}
          y={animatedMathGraph.screenY}
          width={animatedMathGraph.screenWidth}
          height={animatedMathGraph.screenHeight}
          xMin={animatedMathGraph.xMin}
          xMax={animatedMathGraph.xMax}
          onComplete={handleMathGraphComplete}
        />
      )}

      {/* Title */}
      <div
        style={{
          position: "fixed",
          top: 20,
          left: 20,
          zIndex: 100,
          background: "white",
          padding: "12px 20px",
          borderRadius: 12,
          boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          Draw Sub-Agent Test
        </h1>
        <p style={{ fontSize: 12, color: "#666", margin: "4px 0 0 0" }}>
          No LiveKit - Direct API testing
        </p>
      </div>

      {/* Excalidraw Canvas */}
      <Excalidraw
        excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveAsImage: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
        }}
      />

      {/* Input Panel */}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          width: "90%",
          maxWidth: 600,
          background: "white",
          borderRadius: 16,
          padding: "20px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          zIndex: 100,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) {
                handleSubmit();
              }
            }}
            placeholder="Type your drawing request... (e.g., 'draw a red car on a hill')"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={handleSubmit}
            disabled={loading || !query.trim()}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: loading || !query.trim() ? "#ccc" : "#6F47EB",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {loading ? "Processing..." : "Draw"}
          </button>

          <button
            onClick={() => {
              if (excalidrawAPI) {
                triggerToolCall(excalidrawAPI, "clear_board", {});
              }
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "white",
              color: "#666",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Clear
          </button>

          <button
            onClick={() => {
              if (excalidrawAPI) {
                // Test annotate with animated circle in center
                triggerToolCall(excalidrawAPI, "annotate", {
                  shape: "circle",
                  x: 0.5,
                  y: 0.5,
                  width: 0.15,
                  height: 0.15,
                  target: "test"
                }, handleAnimatedAnnotate);
              }
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #6F47EB",
              background: "white",
              color: "#6F47EB",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test Annotate
          </button>

          <button
            onClick={() => {
              if (!excalidrawAPI) return;
              // Animated rectangle via annotate tool
              triggerToolCall(excalidrawAPI, "annotate", {
                shape: "rectangle",
                x: 0.5,
                y: 0.5,
                width: 0.2,
                height: 0.12,
                target: "test rect"
              }, handleAnimatedAnnotate);
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #e03131",
              background: "white",
              color: "#e03131",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test Rect
          </button>

          <button
            onClick={() => {
              if (!excalidrawAPI) return;
              // Simple bouncing ball animation - hardcoded p5.js code
              const bouncingBallCode = `
let x, y, vx, vy;
function setup() {
  createCanvas(400, 300);
  x = width / 2;
  y = height / 2;
  vx = 3;
  vy = 2;
}
function draw() {
  background(26, 26, 46);
  x += vx;
  y += vy;
  if (x > width - 20 || x < 20) vx *= -1;
  if (y > height - 20 || y < 20) vy *= -1;
  fill(157, 124, 216);
  noStroke();
  ellipse(x, y, 40, 40);
}
              `;
              triggerToolCall(excalidrawAPI, "animate", {
                code: bouncingBallCode,
                position: "center"
              });
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #9D7CD8",
              background: "#9D7CD8",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test Animation
          </button>

          <button
            onClick={() => {
              if (!excalidrawAPI) return;
              // Test animation with prompt - shows text placeholder on canvas
              triggerToolCall(excalidrawAPI, "animate", {
                prompt: "bouncing ball with gravity - ball falls and bounces with decreasing height",
                position: "center"
              });
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #7EC699",
              background: "#7EC699",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test Prompt Anim
          </button>

          <button
            onClick={() => {
              if (!excalidrawAPI) return;
              // Test math graph with sin(x)
              triggerToolCall(excalidrawAPI, "draw_function", {
                expression: "sin(x)",
                position: "center"
              }, handleAnimatedAnnotate, handleAnimatedMathGraph);
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #1971c2",
              background: "#1971c2",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test sin(x)
          </button>

          <button
            onClick={() => {
              if (!excalidrawAPI) return;
              // Test math graph with x^2
              triggerToolCall(excalidrawAPI, "draw_function", {
                expression: "x^2",
                xMin: -3,
                xMax: 3,
                position: "center"
              }, handleAnimatedAnnotate, handleAnimatedMathGraph);
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #e03131",
              background: "white",
              color: "#e03131",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test x²
          </button>

          <button
            onClick={() => {
              if (!excalidrawAPI) return;
              // Test MCQ question
              triggerToolCall(excalidrawAPI, "show_question", {
                question_type: "mcq",
                question: "What organelle is known as the powerhouse of the cell?",
                options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi apparatus"],
                correct_answer: "B",
                hint: "It produces ATP through cellular respiration"
              });
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #9D7CD8",
              background: "white",
              color: "#9D7CD8",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test MCQ
          </button>

          <button
            onClick={() => {
              if (!excalidrawAPI) return;
              // Test fill in the blank
              triggerToolCall(excalidrawAPI, "show_question", {
                question_type: "fill_blank",
                question: "The process by which plants convert sunlight into energy is called ___.",
                correct_answer: "photosynthesis",
                hint: "It happens in the chloroplasts"
              });
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #7EC699",
              background: "white",
              color: "#7EC699",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Test Fill Blank
          </button>

          {lastResult && (
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
              {lastResult.toolCalls?.length || 0} tool call(s)
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 8,
              background: "#fee",
              color: "#c33",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {lastResult && (
          <details style={{ marginTop: 12, fontSize: 12 }}>
            <summary style={{ cursor: "pointer", color: "#666" }}>
              View tool calls
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                background: "#f9fafb",
                borderRadius: 8,
                overflow: "auto",
                maxHeight: 200,
              }}
            >
              {JSON.stringify(lastResult.toolCalls, null, 2)}
            </pre>
          </details>
        )}

        <div style={{ marginTop: 12, fontSize: 11, color: "#999" }}>
          <strong>Examples:</strong> "draw a red car on a hill" • "show how photosynthesis works" • "explain the water cycle"
        </div>
      </div>
    </div>
  );
}
