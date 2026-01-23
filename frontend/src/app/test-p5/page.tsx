"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export default function TestP5Page() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ code: string; error?: string; raw?: string } | null>(null);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const executeP5Code = useCallback((code: string) => {
    if (!iframeRef.current) return;

    const logs: string[] = [];
    logs.push("Building p5.js sketch...");

    // Create the HTML content for the iframe
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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
</head>
<body>
  <script>
    // Error handling
    window.onerror = function(msg, url, lineNo, columnNo, error) {
      document.body.innerHTML = '<div style="color: #ff6b6b; padding: 20px; font-family: monospace;">Error: ' + msg + '</div>';
      return false;
    };

    // The generated p5.js code
    ${code}
  </script>
</body>
</html>
    `;

    logs.push("Injecting into iframe...");

    // Write to iframe
    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();
      logs.push("p5.js sketch running!");
    } else {
      logs.push("Error: Could not access iframe document");
    }

    setExecutionLog(logs);
  }, []);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);
    setExecutionLog([]);

    try {
      const response = await fetch("/api/p5", {
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

      if (data.code) {
        executeP5Code(data.code);
      }
    } catch (err: any) {
      setError(err.message || "Failed to generate animation");
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const replayAnimation = () => {
    if (result?.code) {
      executeP5Code(result.code);
    }
  };

  const examplePrompts = [
    "animate an exothermic reaction",
    "animate an endothermic reaction",
    "show stoichiometry: 2H2 + O2 → 2H2O",
    "visualize entropy increasing",
    "draw a sine wave with moving dot",
    "show two atoms colliding and bonding",
    "animate diffusion of particles",
    "visualize photosynthesis",
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
          p5.js Animation Sub-Agent Test
        </h1>
        <p style={{ color: "#888", fontSize: 14 }}>
          Type what you want to animate → Agent generates p5.js code → Executes in canvas
        </p>
        <p style={{ color: "#4ecdc4", fontSize: 12, marginTop: 4 }}>
          Perfect for physics simulations, particle systems, and educational visualizations
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
            placeholder="Describe the animation you want (e.g., 'animate an exothermic reaction')..."
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
            disabled={loading || !prompt.trim()}
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

      {/* Animation Container (iframe) */}
      <div style={{
        background: "#1a1a2e",
        borderRadius: 12,
        minHeight: 450,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
      }}>
        <iframe
          ref={iframeRef}
          style={{
            width: "100%",
            height: 450,
            border: "none",
            background: "#1a1a2e",
          }}
          title="p5.js Animation"
        />

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
            Restart
          </button>
        )}

        {/* Placeholder text when no animation */}
        {!result && !loading && (
          <div style={{
            position: "absolute",
            color: "#444",
            fontSize: 14,
            pointerEvents: "none",
          }}>
            Enter a prompt and click Generate
          </div>
        )}
      </div>

      {/* Debug Info */}
      {result && (
        <div style={{
          background: "#1a1a2e",
          borderRadius: 12,
          padding: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, color: "#00d9ff", margin: 0 }}>
              Generated p5.js Code
            </h3>
            <button
              onClick={() => {
                navigator.clipboard.writeText(result.code);
              }}
              style={{
                padding: "4px 12px",
                borderRadius: 4,
                border: "1px solid #333",
                background: "transparent",
                color: "#888",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Copy Code
            </button>
          </div>
          <pre style={{
            fontSize: 11,
            color: "#888",
            overflow: "auto",
            maxHeight: 300,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            background: "#0f0f1a",
            padding: 12,
            borderRadius: 8,
          }}>
            {result.code}
          </pre>
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
