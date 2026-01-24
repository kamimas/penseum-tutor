"use client";

/**
 * Tool Render Benchmark Page
 *
 * Tests tool calling across models AND renders the actual outputs.
 * Includes p5.js animation iframes for visual comparison.
 */

import { useState, useCallback, useEffect, useRef } from "react";

interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  rendered?: {
    type: "text" | "diagram" | "function" | "p5js";
    content: string;
  };
}

interface BenchmarkResult {
  modelId: string;
  modelLabel: string;
  provider: string;
  prompt: string;
  toolCallLatencyMs: number;
  renderLatencyMs: number;
  totalLatencyMs: number;
  toolCalls: ToolCallResult[];
  error?: string;
}

interface ModelConfig {
  id: string;
  label: string;
  provider: string;
}

// =============================================================================
// P5.js IFRAME COMPONENT
// =============================================================================

function P5Iframe({ code, label }: { code: string; label: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current || !code) return;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
  <style>
    body { margin: 0; overflow: hidden; background: #1a1a2e; }
    canvas { display: block; }
  </style>
</head>
<body>
<script>
${code}
</script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    iframeRef.current.src = url;

    return () => URL.revokeObjectURL(url);
  }, [code]);

  if (!code) {
    return (
      <div style={{
        width: "100%",
        height: 400,
        background: "#1a1a1a",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#666",
      }}>
        No p5.js code generated
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{
        position: "absolute",
        top: 8,
        left: 8,
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "4px 8px",
        borderRadius: 4,
        fontSize: 11,
        zIndex: 10,
      }}>
        {label}
      </div>
      <iframe
        ref={iframeRef}
        style={{
          width: "100%",
          height: 400,
          border: "none",
          borderRadius: 8,
          background: "#1a1a2e",
        }}
        sandbox="allow-scripts"
        title={`p5.js animation - ${label}`}
      />
    </div>
  );
}

// =============================================================================
// DIAGRAM RENDERER
// =============================================================================

function DiagramRenderer({ data }: { data: string }) {
  try {
    const parsed = JSON.parse(data);
    const nodes = parsed.nodes || [];
    const type = parsed.type || "flowchart";

    return (
      <div style={{
        padding: 16,
        background: "#1a1a2e",
        borderRadius: 8,
        minHeight: 200,
      }}>
        <div style={{ color: "#888", fontSize: 12, marginBottom: 12 }}>
          {type.toUpperCase()}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {nodes.map((node: string, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div style={{
                padding: "8px 16px",
                background: "#2d2d4a",
                borderRadius: 8,
                border: "1px solid #4a4a6a",
                color: "#fff",
                fontSize: 13,
              }}>
                {node}
              </div>
              {i < nodes.length - 1 && (
                <div style={{ color: "#666", margin: "0 8px" }}>
                  {type === "cycle" && i === nodes.length - 2 ? "..." : "->"}
                </div>
              )}
            </div>
          ))}
          {type === "cycle" && nodes.length > 0 && (
            <div style={{ color: "#666" }}>-> (repeat)</div>
          )}
        </div>
      </div>
    );
  } catch {
    return <div style={{ color: "#f44" }}>Failed to parse diagram</div>;
  }
}

// =============================================================================
// FUNCTION GRAPH RENDERER (simple text display)
// =============================================================================

function FunctionRenderer({ expression }: { expression: string }) {
  return (
    <div style={{
      padding: 16,
      background: "#1a1a2e",
      borderRadius: 8,
      minHeight: 100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{
        fontFamily: "monospace",
        fontSize: 24,
        color: "#4285f4",
      }}>
        y = {expression}
      </div>
    </div>
  );
}

// =============================================================================
// TEXT RENDERER
// =============================================================================

function TextRenderer({ content }: { content: string }) {
  return (
    <div style={{
      padding: 16,
      background: "#1a1a2e",
      borderRadius: 8,
      minHeight: 60,
    }}>
      <div style={{ color: "#fff", fontSize: 16 }}>{content}</div>
    </div>
  );
}

// =============================================================================
// RESULT CARD
// =============================================================================

function ResultCard({ result }: { result: BenchmarkResult }) {
  const getProviderColor = (provider: string) => {
    switch (provider) {
      case "openai": return "#10a37f";
      case "xai": return "#1da1f2";
      case "gemini": return "#4285f4";
      default: return "#888";
    }
  };

  return (
    <div style={{
      background: "#1a1a1a",
      borderRadius: 12,
      overflow: "hidden",
      border: result.error ? "1px solid #f44" : "1px solid #333",
    }}>
      {/* Header */}
      <div style={{
        padding: 16,
        borderBottom: "1px solid #333",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div>
          <div style={{
            color: getProviderColor(result.provider),
            fontWeight: 600,
            fontSize: 16,
          }}>
            {result.modelLabel}
          </div>
          <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
            {result.provider.toUpperCase()}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: 24,
            fontWeight: 600,
            color: result.totalLatencyMs < 2000 ? "#4caf50" : result.totalLatencyMs < 4000 ? "#ff9800" : "#f44",
          }}>
            {Math.round(result.totalLatencyMs)}ms
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>
            Tool: {Math.round(result.toolCallLatencyMs)}ms
            {result.renderLatencyMs > 0 && ` | Render: ${Math.round(result.renderLatencyMs)}ms`}
          </div>
        </div>
      </div>

      {/* Error */}
      {result.error && (
        <div style={{ padding: 16, color: "#f44", fontSize: 13 }}>
          Error: {result.error}
        </div>
      )}

      {/* Only show p5.js animations */}
      {!result.error && (() => {
        const p5Call = result.toolCalls.find(tc => tc.rendered?.type === "p5js");
        if (p5Call?.rendered) {
          return (
            <div style={{ padding: 16 }}>
              <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>
                animate({JSON.stringify(p5Call.args.prompt).slice(0, 50)}...)
              </div>
              <P5Iframe code={p5Call.rendered.content} label={result.modelLabel} />
            </div>
          );
        }
        return (
          <div style={{ padding: 16, color: "#888", fontSize: 13 }}>
            No animation generated (tools: {result.toolCalls.map(tc => tc.name).join(", ") || "none"})
          </div>
        );
      })()}
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

const EXAMPLE_PROMPTS = [
  "animate a ball bouncing",
  "animate particles spreading like diffusion",
  "draw the water cycle",
  "graph sin(x)",
  "explain photosynthesis with a diagram",
];

export default function ToolRenderPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("animate a ball bouncing");
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");

  // Fetch available models on mount
  useEffect(() => {
    fetch("/api/tool-render")
      .then((res) => res.json())
      .then((data) => {
        setModels(data.models);
        setSelectedModels(data.models.map((m: ModelConfig) => m.id));
      })
      .catch((err) => setError(err.message));
  }, []);

  const runBenchmark = useCallback(async () => {
    setIsRunning(true);
    setResults([]);
    setError("");

    try {
      const res = await fetch("/api/tool-render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: selectedModels,
          prompt,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsRunning(false);
    }
  }, [selectedModels, prompt]);

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId]
    );
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case "openai": return "#10a37f";
      case "xai": return "#1da1f2";
      case "gemini": return "#4285f4";
      default: return "#888";
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#fff",
      padding: 24,
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>
          Tool Render Benchmark
        </h1>
        <p style={{ color: "#888", marginBottom: 32 }}>
          Compare tool calling speed AND output quality across models. Includes p5.js animation rendering.
        </p>

        {/* Model Selection */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, color: "#888", marginBottom: 12 }}>Models</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {models.map((model) => (
              <button
                key={model.id}
                onClick={() => toggleModel(model.id)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: `1px solid ${selectedModels.includes(model.id) ? getProviderColor(model.provider) : "#333"}`,
                  background: selectedModels.includes(model.id) ? `${getProviderColor(model.provider)}22` : "transparent",
                  color: selectedModels.includes(model.id) ? getProviderColor(model.provider) : "#888",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {model.label}
              </button>
            ))}
          </div>
        </div>

        {/* Prompt Input */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, color: "#888", marginBottom: 12 }}>Prompt</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runBenchmark()}
              placeholder="Enter a drawing prompt..."
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "#1a1a1a",
                color: "#fff",
                fontSize: 14,
              }}
            />
            <button
              onClick={runBenchmark}
              disabled={isRunning || selectedModels.length === 0 || !prompt}
              style={{
                padding: "12px 32px",
                borderRadius: 8,
                border: "none",
                background: isRunning ? "#333" : "#4285f4",
                color: "#fff",
                cursor: isRunning ? "not-allowed" : "pointer",
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              {isRunning ? "Running..." : "Run Benchmark"}
            </button>
          </div>

          {/* Quick prompts */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #333",
                  background: prompt === p ? "#333" : "transparent",
                  color: "#888",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: 16,
            background: "#3d1a1a",
            border: "1px solid #5a2d2d",
            borderRadius: 8,
            color: "#f88",
            marginBottom: 24,
          }}>
            {error}
          </div>
        )}

        {/* Results Grid */}
        {results.length > 0 && (
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 16 }}>
              Results (sorted by latency)
            </h3>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(500px, 1fr))",
              gap: 24,
            }}>
              {results.map((result) => (
                <ResultCard key={result.modelId} result={result} />
              ))}
            </div>
          </div>
        )}

        {/* Back Link */}
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <a
            href="/experiments/tool-latency"
            style={{ color: "#4285f4", textDecoration: "underline", marginRight: 16 }}
          >
            Simple Latency Test
          </a>
          <a
            href="/experiments/gemini-direct"
            style={{ color: "#4285f4", textDecoration: "underline" }}
          >
            Back to Experiments
          </a>
        </div>
      </div>
    </div>
  );
}
