"use client";

/**
 * Gemini Tool Latency Test Page
 *
 * Measures tool call latency for comparison with xAI.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { GeminiLiveClient, ConnectionState, ToolCall } from "../lib/GeminiLiveClient";
import { AudioPlayback } from "../lib/AudioPlayback";
import { AudioCapture } from "../lib/AudioCapture";
import {
  FunctionDeclaration,
  Type,
  Behavior,
  FunctionResponseScheduling,
} from "@google/genai";

// =============================================================================
// CONFIGURATION - Tutor prompt matching /gemini page
// =============================================================================

const SYSTEM_INSTRUCTION = `You are PAI, a tutor created by Penseum. Be concise and energetic.

# STARTUP
Ask: "What would you like to learn today?"

# TEACHING FLOW
1. Student gives a topic
2. Briefly introduce the concept (1-2 sentences)
3. Call draw() to visualize
4. Explain what appeared
5. Ask a topic-relevant question to check understanding
6. Based on their answer, continue teaching or clarify

# TOOLS
- draw(query) - Natural language. Renders text, images, diagrams, animations, or math graphs.
- clear_board() - Clear whiteboard when switching topics.

# DRAW QUERY TIPS
- For images: "show me [thing]" (e.g., "show me a labeled heart diagram")
- For processes: "flowchart/cycle/timeline of [steps]" (e.g., "cycle of evaporation, condensation, precipitation")
- For motion/physics: "animate [thing]" (e.g., "animate a ball falling with gravity")
- For math: "graph [function]" (e.g., "graph sin(x)")
- For equations: just write it (e.g., "E = mc²")

# GOOD EXAMPLES

Student: "Teach me about photosynthesis"
You: "Photosynthesis is how plants convert sunlight into food!"
[call draw("show me a photosynthesis diagram with sunlight, water, and CO2 going into a leaf")]
You: "See how the leaf takes in three ingredients - sunlight, water, and carbon dioxide? What do you think comes out as a result?"

Student: "How does gravity work?"
You: "Gravity pulls objects toward each other - the bigger the object, the stronger the pull!"
[call draw("animate a ball falling and accelerating downward")]
You: "Notice how the ball speeds up as it falls? That acceleration is about 9.8 meters per second squared on Earth. If I dropped this same ball on the Moon, would it fall faster or slower?"

Student: "What's a sine wave?"
You: "A sine wave is a smooth, repeating oscillation - it's everywhere in nature!"
[call draw("graph sin(x)")]
You: "See how it smoothly goes up to 1, back to 0, down to -1, and repeats? Where do you think we might see this pattern in the real world?"

Student: "Explain the water cycle"
You: "Water constantly moves between the earth and atmosphere in a loop!"
[call draw("cycle of evaporation, condensation, precipitation, collection")]
You: "The sun heats water, it rises as vapor, forms clouds, then falls as rain. What do you think powers this whole cycle?"

# BAD EXAMPLES

DON'T: "What else would you like to learn?" - Not checking understanding
DON'T: "Does that make sense?" - Yes/no doesn't reveal comprehension
DON'T: "Any questions?" - Puts burden on student
DON'T: Drawing without explaining what appeared
DON'T: Asking a question before showing a visual
`;

const DRAW_TOOL: FunctionDeclaration = {
  name: "draw",
  description: "Draw on whiteboard: text, images, diagrams, annotations.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "What to draw",
      },
    },
    required: ["query"],
  },
  behavior: Behavior.NON_BLOCKING,
};

const CLEAR_BOARD_TOOL: FunctionDeclaration = {
  name: "clear_board",
  description: "Clear whiteboard. Use when switching topics or board is cluttered.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
  behavior: Behavior.NON_BLOCKING,
};

// =============================================================================
// LOG ENTRY COMPONENT
// =============================================================================

interface LogEntry {
  id: string;
  type: "client" | "server" | "tool" | "latency";
  message: string;
  timestamp: Date;
}

// Latency tracking
interface LatencyMetric {
  label: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

function LogPanel({ logs }: { logs: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflow: "auto",
        fontFamily: "monospace",
        fontSize: 12,
        padding: 16,
        background: "#1a1a1a",
        color: "#e0e0e0",
        borderRadius: 8,
      }}
    >
      {logs.map((log) => (
        <div
          key={log.id}
          style={{
            marginBottom: 4,
            color:
              log.type === "client"
                ? "#7ec699"
                : log.type === "server"
                ? "#9d7cd8"
                : log.type === "latency"
                ? "#ff6b6b"
                : "#e5a853",
          }}
        >
          <span style={{ opacity: 0.5 }}>
            [{log.timestamp.toLocaleTimeString()}]
          </span>{" "}
          <span style={{ fontWeight: 600 }}>[{log.type.toUpperCase()}]</span>{" "}
          {log.message}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function GeminiToolLatencyPage() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [latencyMetrics, setLatencyMetrics] = useState<LatencyMetric[]>([]);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);

  // Timing refs for latency measurement
  const textSentTimeRef = useRef<number>(0);
  const toolCallReceivedTimeRef = useRef<number>(0);
  const firstAudioTimeRef = useRef<number>(0);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    setLogs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        type,
        message,
        timestamp: new Date(),
      },
    ]);
  }, []);

  // Handle tool calls with latency measurement
  const handleToolCall = useCallback(
    (toolCalls: ToolCall[]) => {
      const now = performance.now();
      toolCallReceivedTimeRef.current = now;

      // Measure time from text sent to tool call received
      if (textSentTimeRef.current > 0) {
        const latency = now - textSentTimeRef.current;
        addLog("latency", `Text -> Tool Call: ${latency.toFixed(0)}ms`);
        setLatencyMetrics((prev) => [
          ...prev,
          {
            label: "Text -> Tool Call",
            startTime: textSentTimeRef.current,
            endTime: now,
            duration: latency,
          },
        ]);
      }

      for (const tc of toolCalls) {
        addLog("tool", `${tc.name}(${JSON.stringify(tc.args)})`);

        // Handle draw and clear_board tools - use SILENT so Gemini doesn't react
        const responseStart = performance.now();
        const result = "Done.";
        clientRef.current?.sendToolResponse(tc.id, tc.name, result, FunctionResponseScheduling.SILENT);

        // Log tool response time
        const responseTime = performance.now() - responseStart;
        addLog("latency", `Tool Response Sent: ${responseTime.toFixed(1)}ms`);
      }
    },
    [addLog]
  );

  // Connect to Gemini
  const handleConnect = useCallback(async () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      addLog("client", "ERROR: NEXT_PUBLIC_GOOGLE_API_KEY not set");
      return;
    }

    // Initialize audio playback
    audioPlaybackRef.current = new AudioPlayback();
    await audioPlaybackRef.current.resume();

    // Create Gemini client
    const client = new GeminiLiveClient({
      apiKey,
      tools: [DRAW_TOOL, CLEAR_BOARD_TOOL],
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    clientRef.current = client;

    // Set up event handlers
    client.on("stateChange", setConnectionState);
    client.on("log", (type, message) => addLog(type as "client" | "server", message));

    client.on("setupComplete", () => {
      addLog("server", "Session ready");
    });

    client.on("audio", (buffer) => {
      // Track first audio chunk time
      if (firstAudioTimeRef.current === 0 && toolCallReceivedTimeRef.current > 0) {
        firstAudioTimeRef.current = performance.now();
        const latency = firstAudioTimeRef.current - toolCallReceivedTimeRef.current;
        addLog("latency", `Tool Call -> First Audio: ${latency.toFixed(0)}ms`);
      }
      audioPlaybackRef.current?.addPCM16(buffer);
    });

    client.on("toolCall", handleToolCall);

    client.on("interrupted", () => {
      addLog("server", "Interrupted");
      audioPlaybackRef.current?.stop();
      // Reset timing for next measurement
      firstAudioTimeRef.current = 0;
    });

    client.on("turnComplete", () => {
      addLog("server", "Turn complete");
    });

    client.on("inputTranscription", (text) => {
      setInputTranscript((prev) => prev + text);
      addLog("server", `User: ${text}`);
    });

    client.on("outputTranscription", (text) => {
      setOutputTranscript((prev) => prev + text);
    });

    client.on("error", (error) => {
      addLog("client", `ERROR: ${error.message}`);
    });

    // Connect
    await client.connect();
  }, [addLog, handleToolCall]);

  // Disconnect
  const handleDisconnect = useCallback(() => {
    clientRef.current?.disconnect();
    audioPlaybackRef.current?.stop();
    audioCaptureRef.current?.stop();
    setIsMicEnabled(false);
  }, []);

  // Toggle microphone
  const handleToggleMic = useCallback(async () => {
    if (isMicEnabled) {
      audioCaptureRef.current?.stop();
      audioCaptureRef.current = null;
      setIsMicEnabled(false);
      addLog("client", "Microphone disabled");
    } else {
      try {
        const capture = new AudioCapture();
        audioCaptureRef.current = capture;
        capture.on("data", (base64Audio) => {
          clientRef.current?.sendAudio(base64Audio);
        });
        await capture.start();
        setIsMicEnabled(true);
        addLog("client", "Microphone enabled (16kHz)");
      } catch (err) {
        addLog("client", `Mic error: ${err}`);
      }
    }
  }, [isMicEnabled, addLog]);

  // Send test message (triggers draw tool)
  const handleTestDraw = useCallback(() => {
    // Reset timing refs
    textSentTimeRef.current = performance.now();
    toolCallReceivedTimeRef.current = 0;
    firstAudioTimeRef.current = 0;

    // Reset transcripts
    setInputTranscript("");
    setOutputTranscript("");

    addLog("client", "Sending: Teach me about photosynthesis");
    clientRef.current?.sendText("Teach me about photosynthesis");
  }, [addLog]);

  // Send test message (triggers clear_board then draw)
  const handleTestClear = useCallback(() => {
    // Reset timing refs
    textSentTimeRef.current = performance.now();
    toolCallReceivedTimeRef.current = 0;
    firstAudioTimeRef.current = 0;

    // Reset transcripts
    setInputTranscript("");
    setOutputTranscript("");

    addLog("client", "Sending: Actually, let's switch to learning about gravity");
    clientRef.current?.sendText("Actually, let's switch to learning about gravity");
  }, [addLog]);

  // Clear metrics
  const handleClearMetrics = useCallback(() => {
    setLatencyMetrics([]);
    setLogs([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      audioPlaybackRef.current?.stop();
      audioCaptureRef.current?.stop();
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#fff",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Gemini Tool Latency Test
        </h1>
        <p style={{ color: "#888", marginBottom: 24 }}>
          WebSocket connection to Gemini Live API (16kHz audio)
        </p>

        {/* Status & Controls */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 24,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              background:
                connectionState === "connected"
                  ? "#1a3d1a"
                  : connectionState === "connecting"
                  ? "#3d3d1a"
                  : "#1a1a1a",
              border: `1px solid ${
                connectionState === "connected"
                  ? "#2d5a2d"
                  : connectionState === "connecting"
                  ? "#5a5a2d"
                  : "#333"
              }`,
            }}
          >
            {connectionState}
          </div>

          {connectionState === "disconnected" ? (
            <button
              onClick={handleConnect}
              style={{
                padding: "8px 24px",
                borderRadius: 8,
                border: "none",
                background: "#4285f4",
                color: "white",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Connect
            </button>
          ) : (
            <>
              <button
                onClick={handleDisconnect}
                style={{
                  padding: "8px 24px",
                  borderRadius: 8,
                  border: "1px solid #444",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Disconnect
              </button>

              <button
                onClick={handleToggleMic}
                disabled={connectionState !== "connected"}
                style={{
                  padding: "8px 24px",
                  borderRadius: 8,
                  border: "none",
                  background: isMicEnabled ? "#2d5a2d" : "#333",
                  color: "white",
                  cursor: connectionState === "connected" ? "pointer" : "not-allowed",
                  opacity: connectionState === "connected" ? 1 : 0.5,
                }}
              >
                {isMicEnabled ? "Mic ON" : "Mic OFF"}
              </button>

              <button
                onClick={handleTestDraw}
                disabled={connectionState !== "connected"}
                style={{
                  padding: "8px 24px",
                  borderRadius: 8,
                  border: "none",
                  background: "#4285f4",
                  color: "#fff",
                  cursor: connectionState === "connected" ? "pointer" : "not-allowed",
                  opacity: connectionState === "connected" ? 1 : 0.5,
                  fontWeight: 500,
                }}
              >
                Photosynthesis
              </button>

              <button
                onClick={handleTestClear}
                disabled={connectionState !== "connected"}
                style={{
                  padding: "8px 24px",
                  borderRadius: 8,
                  border: "none",
                  background: "#e5a853",
                  color: "#000",
                  cursor: connectionState === "connected" ? "pointer" : "not-allowed",
                  opacity: connectionState === "connected" ? 1 : 0.5,
                  fontWeight: 500,
                }}
              >
                Switch Topic
              </button>

              <button
                onClick={handleClearMetrics}
                style={{
                  padding: "8px 24px",
                  borderRadius: 8,
                  border: "1px solid #444",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>

        {/* Transcripts */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, color: "#888", marginBottom: 8 }}>
              Input (You)
            </h3>
            <div
              style={{
                padding: 16,
                background: "#1a1a1a",
                borderRadius: 8,
                minHeight: 60,
                color: "#7ec699",
              }}
            >
              {inputTranscript || "..."}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, color: "#888", marginBottom: 8 }}>
              Output (AI)
            </h3>
            <div
              style={{
                padding: 16,
                background: "#1a1a1a",
                borderRadius: 8,
                minHeight: 60,
                color: "#9d7cd8",
              }}
            >
              {outputTranscript || "..."}
            </div>
          </div>
        </div>

        {/* Latency Metrics */}
        {latencyMetrics.length > 0 && (
          <div style={{ marginBottom: 24, padding: 16, background: "#1a1a1a", borderRadius: 8 }}>
            <h3 style={{ fontSize: 14, color: "#ff6b6b", marginBottom: 12 }}>
              Latency Metrics
            </h3>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {latencyMetrics.slice(-5).map((metric, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 600, color: "#ff6b6b" }}>
                    {metric.duration?.toFixed(0)}ms
                  </div>
                  <div style={{ fontSize: 11, color: "#888" }}>{metric.label}</div>
                </div>
              ))}
              {latencyMetrics.length > 0 && (
                <div style={{ textAlign: "center", borderLeft: "1px solid #333", paddingLeft: 24 }}>
                  <div style={{ fontSize: 24, fontWeight: 600, color: "#7ec699" }}>
                    {(latencyMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / latencyMetrics.length).toFixed(0)}ms
                  </div>
                  <div style={{ fontSize: 11, color: "#888" }}>Average</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Log Panel */}
        <h3 style={{ fontSize: 14, color: "#888", marginBottom: 8 }}>
          Event Log
        </h3>
        <div style={{ height: 400, display: "flex", flexDirection: "column" }}>
          <LogPanel logs={logs} />
        </div>

        {/* Info */}
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: "#1a1a1a",
            borderRadius: 8,
            fontSize: 13,
            color: "#888",
          }}
        >
          <strong>Multi-Tool Test (Gemini):</strong>
          <ul style={{ marginTop: 8, paddingLeft: 20 }}>
            <li><strong>Photosynthesis</strong> - Should trigger draw() tool</li>
            <li><strong>Switch Topic</strong> - Should trigger clear_board() then draw()</li>
            <li>Tools: draw(query), clear_board()</li>
            <li>Model: gemini-2.5-flash-native-audio | Audio: 16kHz → 24kHz</li>
          </ul>
        </div>

        {/* Compare Link */}
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <a
            href="/experiments/xai-realtime"
            style={{ color: "#e5a853", textDecoration: "underline" }}
          >
            Compare with xAI Realtime →
          </a>
        </div>
      </div>
    </div>
  );
}
