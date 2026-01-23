"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export default function TestAnimatePage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ html: string; code: string; error?: string; raw?: string } | null>(null);
  const [animeModule, setAnimeModule] = useState<any>(null);
  const [executionLog, setExecutionLog] = useState<string[]>([]);

  // Use a wrapper ref that we never let React touch the children of
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Keep track of our animation container (created outside React)
  const animContainerRef = useRef<HTMLDivElement | null>(null);

  // Create animation container outside React's control
  useEffect(() => {
    if (wrapperRef.current && !animContainerRef.current) {
      const container = document.createElement("div");
      container.style.cssText = "display: flex; justify-content: center; align-items: center; min-height: 200px; width: 100%; padding: 40px;";
      container.innerHTML = '<p style="color: #444;">Enter a prompt and click Generate</p>';
      wrapperRef.current.appendChild(container);
      animContainerRef.current = container;
    }

    return () => {
      // Cleanup on unmount
      if (animContainerRef.current && wrapperRef.current) {
        try {
          wrapperRef.current.removeChild(animContainerRef.current);
        } catch (e) {
          // Ignore if already removed
        }
        animContainerRef.current = null;
      }
    };
  }, []);

  // Load Anime.js
  useEffect(() => {
    import("animejs").then((mod) => {
      setAnimeModule(mod);
      console.log("Anime.js loaded:", Object.keys(mod));
    }).catch((err) => {
      console.error("Failed to load Anime.js:", err);
    });
  }, []);

  const executeAnimation = useCallback((html: string, code: string) => {
    if (!animContainerRef.current || !animeModule) return;

    const logs: string[] = [];
    logs.push("Injecting HTML...");

    // Inject HTML into our non-React container
    animContainerRef.current.innerHTML = html;
    logs.push("HTML injected");

    // Execute the animation code
    try {
      logs.push("Executing animation code...");

      // Create a function with anime.js functions in scope
      const { animate, stagger, svg, splitText, createTimeline } = animeModule;

      // Use Function constructor to execute code with anime.js in scope
      const execFn = new Function(
        "animate",
        "stagger",
        "svg",
        "splitText",
        "createTimeline",
        "setTimeout",
        code
      );

      execFn(animate, stagger, svg, splitText, createTimeline, setTimeout);

      logs.push("Animation started!");
    } catch (err: any) {
      logs.push(`Error: ${err.message}`);
      console.error("Animation execution error:", err);
    }

    setExecutionLog(logs);
  }, [animeModule]);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);
    setExecutionLog([]);

    try {
      const response = await fetch("/api/animate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate animation");
      }

      const data = await response.json();
      setResult(data);

      // Execute the animation
      if (data.html && data.code && animeModule) {
        executeAnimation(data.html, data.code);
      }
    } catch (err: any) {
      setError(err.message || "Failed to generate animation");
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const replayAnimation = () => {
    if (result?.html && result?.code && animeModule) {
      executeAnimation(result.html, result.code);
    }
  };

  const examplePrompts = [
    "animate the word Hello",
    "animate E = mc²",
    "animate 2H2 + O2 → 2H2O",
    "show a flowchart: Input → Process → Output",
    "draw a sine wave",
    "animate the Pythagorean theorem: a² + b² = c²",
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0f1a",
      color: "white",
      fontFamily: "system-ui, sans-serif",
      padding: 20
    }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>
          Animation Sub-Agent Test
        </h1>
        <p style={{ color: "#888", fontSize: 14 }}>
          Type what you want to animate → Agent generates Anime.js code → Executes on screen
        </p>
      </div>

      {/* Input */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleSubmit();
            }}
            placeholder="Describe the animation you want..."
            disabled={loading}
            style={{
              flex: 1,
              padding: "14px 18px",
              borderRadius: 10,
              border: "1px solid #333",
              background: "#1a1a2e",
              color: "white",
              fontSize: 16,
              outline: "none",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !prompt.trim() || !animeModule}
            style={{
              padding: "14px 28px",
              borderRadius: 10,
              border: "none",
              background: loading || !prompt.trim() ? "#333" : "#4ecdc4",
              color: loading || !prompt.trim() ? "#666" : "#000",
              fontSize: 16,
              fontWeight: 600,
              cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Generating..." : "Generate"}
          </button>
        </div>

        {/* Example prompts */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "#666", fontSize: 12 }}>Try:</span>
          {examplePrompts.map((ex, i) => (
            <button
              key={i}
              onClick={() => setPrompt(ex)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid #333",
                background: "transparent",
                color: "#888",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: "12px 16px",
          borderRadius: 8,
          background: "#3a1a1a",
          color: "#ff6b6b",
          marginBottom: 20,
          fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Animation Container */}
      <div style={{
        background: "#1a1a2e",
        borderRadius: 12,
        minHeight: 300,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* This wrapper's children are managed outside React */}
        <div ref={wrapperRef} style={{ width: "100%" }} />

        {/* Replay button */}
        {result && (
          <button
            onClick={replayAnimation}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #333",
              background: "#0f0f1a",
              color: "#888",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Replay
          </button>
        )}
      </div>

      {/* Debug Info */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Generated HTML */}
          <div style={{
            background: "#1a1a2e",
            borderRadius: 12,
            padding: 16,
          }}>
            <h3 style={{ fontSize: 14, marginBottom: 12, color: "#4ecdc4" }}>
              Generated HTML
            </h3>
            <pre style={{
              fontSize: 11,
              color: "#888",
              overflow: "auto",
              maxHeight: 200,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {result.html}
            </pre>
          </div>

          {/* Generated Code */}
          <div style={{
            background: "#1a1a2e",
            borderRadius: 12,
            padding: 16,
          }}>
            <h3 style={{ fontSize: 14, marginBottom: 12, color: "#00d9ff" }}>
              Generated Anime.js Code
            </h3>
            <pre style={{
              fontSize: 11,
              color: "#888",
              overflow: "auto",
              maxHeight: 200,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {result.code}
            </pre>
          </div>
        </div>
      )}

      {/* Execution Log */}
      {executionLog.length > 0 && (
        <div style={{
          marginTop: 20,
          background: "#1a1a2e",
          borderRadius: 12,
          padding: 16,
        }}>
          <h3 style={{ fontSize: 14, marginBottom: 12, color: "#ffd93d" }}>
            Execution Log
          </h3>
          {executionLog.map((log, i) => (
            <div key={i} style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
              → {log}
            </div>
          ))}
        </div>
      )}

      {/* Raw response if error */}
      {result?.error && (
        <div style={{
          marginTop: 20,
          background: "#3a1a1a",
          borderRadius: 12,
          padding: 16,
        }}>
          <h3 style={{ fontSize: 14, marginBottom: 12, color: "#ff6b6b" }}>
            Parse Error
          </h3>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{result.error}</p>
          <pre style={{
            fontSize: 11,
            color: "#666",
            overflow: "auto",
            maxHeight: 200,
          }}>
            {result.raw}
          </pre>
        </div>
      )}
    </div>
  );
}
