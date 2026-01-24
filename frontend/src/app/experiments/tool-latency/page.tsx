"use client";

/**
 * Tool Latency Benchmark Page
 *
 * Tests tool calling latency across OpenAI, xAI, and Gemini models.
 */

import { useState, useCallback, useEffect } from "react";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface BenchmarkResult {
  modelId: string;
  modelLabel: string;
  provider: string;
  prompt: string;
  latencyMs: number;
  toolCalls: ToolCall[];
  error?: string;
}

interface ModelSummary {
  modelId: string;
  modelLabel: string;
  provider: string;
  avgLatencyMs: number;
  successRate: number;
  totalTests: number;
}

interface ModelConfig {
  id: string;
  label: string;
  provider: string;
}

const DEFAULT_PROMPTS = [
  "draw a diagram of photosynthesis",
  "graph sin(x)",
  "show me the solar system",
  "animate a ball bouncing",
  "draw the water cycle",
];

export default function ToolLatencyPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const [customPrompt, setCustomPrompt] = useState("");
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [summary, setSummary] = useState<ModelSummary[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState("");

  // Fetch available models on mount
  const fetchModels = useCallback(async () => {
    const res = await fetch("/api/tool-latency");
    const data = await res.json();
    setModels(data.models);
    setSelectedModels(data.models.map((m: ModelConfig) => m.id));
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const runBenchmark = async () => {
    setIsRunning(true);
    setResults([]);
    setSummary([]);
    setCurrentTest("Starting benchmark...");

    try {
      const res = await fetch("/api/tool-latency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: selectedModels,
          prompts,
        }),
      });

      const data = await res.json();
      setResults(data.results);
      setSummary(data.summary);
      setCurrentTest("");
    } catch (error) {
      console.error("Benchmark error:", error);
      setCurrentTest("Error running benchmark");
    } finally {
      setIsRunning(false);
    }
  };

  const addCustomPrompt = () => {
    if (customPrompt.trim() && !prompts.includes(customPrompt.trim())) {
      setPrompts([...prompts, customPrompt.trim()]);
      setCustomPrompt("");
    }
  };

  const removePrompt = (prompt: string) => {
    setPrompts(prompts.filter((p) => p !== prompt));
  };

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
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>
          Tool Calling Latency Benchmark
        </h1>
        <p style={{ color: "#888", marginBottom: 32 }}>
          Compare tool calling speed across OpenAI, xAI, and Gemini models
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

        {/* Prompts */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, color: "#888", marginBottom: 12 }}>Test Prompts</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {prompts.map((prompt) => (
              <div
                key={prompt}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {prompt}
                <button
                  onClick={() => removePrompt(prompt)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#666",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 16,
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomPrompt()}
              placeholder="Add custom prompt..."
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "#1a1a1a",
                color: "#fff",
                fontSize: 13,
              }}
            />
            <button
              onClick={addCustomPrompt}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "#1a1a1a",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Run Button */}
        <button
          onClick={runBenchmark}
          disabled={isRunning || selectedModels.length === 0 || prompts.length === 0}
          style={{
            padding: "12px 32px",
            borderRadius: 8,
            border: "none",
            background: isRunning ? "#333" : "#4285f4",
            color: "#fff",
            cursor: isRunning ? "not-allowed" : "pointer",
            fontSize: 15,
            fontWeight: 500,
            marginBottom: 32,
          }}
        >
          {isRunning ? currentTest || "Running..." : "Run Benchmark"}
        </button>

        {/* Summary */}
        {summary.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontSize: 16, marginBottom: 16 }}>Results Summary (sorted by latency)</h3>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 16,
            }}>
              {summary.map((s, i) => (
                <div
                  key={s.modelId}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    background: "#1a1a1a",
                    border: `1px solid ${i === 0 ? "#4caf50" : "#333"}`,
                  }}
                >
                  {i === 0 && (
                    <div style={{
                      fontSize: 11,
                      color: "#4caf50",
                      marginBottom: 8,
                      fontWeight: 600,
                    }}>
                      FASTEST
                    </div>
                  )}
                  <div style={{
                    fontSize: 14,
                    fontWeight: 500,
                    marginBottom: 4,
                    color: getProviderColor(s.provider),
                  }}>
                    {s.modelLabel}
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 600, marginBottom: 4 }}>
                    {s.avgLatencyMs}ms
                  </div>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {s.successRate}% success ({s.totalTests} tests)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Results */}
        {results.length > 0 && (
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 16 }}>Detailed Results</h3>
            <div style={{
              background: "#1a1a1a",
              borderRadius: 12,
              overflow: "hidden",
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#222" }}>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #333" }}>Model</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #333" }}>Prompt</th>
                    <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #333" }}>Latency</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #333" }}>Tool Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #222" }}>
                      <td style={{
                        padding: 12,
                        color: getProviderColor(r.provider),
                        fontWeight: 500,
                      }}>
                        {r.modelLabel}
                      </td>
                      <td style={{ padding: 12, color: "#ccc", maxWidth: 250 }}>
                        {r.prompt}
                      </td>
                      <td style={{
                        padding: 12,
                        textAlign: "right",
                        fontFamily: "monospace",
                        color: r.error ? "#f44" : r.latencyMs < 500 ? "#4caf50" : r.latencyMs < 1000 ? "#ff9800" : "#f44",
                      }}>
                        {r.error ? "ERROR" : `${Math.round(r.latencyMs)}ms`}
                      </td>
                      <td style={{ padding: 12, fontFamily: "monospace", fontSize: 11, color: "#888" }}>
                        {r.error ? (
                          <span style={{ color: "#f44" }}>{r.error}</span>
                        ) : (
                          r.toolCalls.map((tc) => tc.name).join(", ") || "none"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Back Link */}
        <div style={{ marginTop: 32, textAlign: "center" }}>
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
