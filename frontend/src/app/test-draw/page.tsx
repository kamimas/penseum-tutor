"use client";
import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useState } from "react";
import { triggerToolCall } from "../../components/ExcalidrawToolHandler";

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

  const handleSubmit = async () => {
    if (!query.trim() || !excalidrawAPI) return;

    setLoading(true);
    setError("");
    setLastResult(null);

    try {
      const response = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
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
          triggerToolCall(excalidrawAPI, toolCall.tool, toolCall.params);
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
