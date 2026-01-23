"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  GeminiLiveClient,
  ConnectionState,
  ToolCall,
} from "../lib/GeminiLiveClient";
import { AudioPlayback } from "../lib/AudioPlayback";
import { AudioCapture } from "../lib/AudioCapture";
import {
  FunctionDeclaration,
  Type,
  Behavior,
  FunctionResponseScheduling,
} from "@google/genai";
import { triggerToolCall } from "../../../../components/ExcalidrawToolHandler";

// Dynamic import for Excalidraw (no SSR)
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false, loading: () => <div className="p-10">Loading canvas...</div> }
);

// System prompt matching tutor.py
const SYSTEM_INSTRUCTION = `You are PAI, a tutor created by Penseum. Speak English only.

IMPORTANT: SHOW, DON'T TELL. Always use draw() instead of explaining verbally. Visuals first, brief speech after.

RULES:
1. ONE draw() call per response - don't batch multiple draws
2. Never lie to the student - correct mistakes honestly
3. Keep speech brief between tool calls
4. Include speed hints in draw() based on how long you'll talk:
   - "quick" = you'll say 1-2 sentences (fast diagram/text)
   - No hint = you'll say a few sentences (image or diagram)
   - "show how" / "demonstrate" = core concept worth waiting for (animation)

TOOLS:
- draw(query) - Describe what to show. Add speed hints: "quick X", "show how X works", "photo of X"
- clear_board() - Clear when switching topics

VISION:
You can see the student's screen. Reference what you see when relevant. When content is already on the board, prefer annotating it over adding new content.

GOOD EXAMPLES:

Student: "Teach me about the heart"
draw("the heart")
"This is the heart with its four chambers."

Student: "How does the heart pump blood?"
draw("show how the heart beats")
"Watch it contract - the left side pumps to your body, the right to your lungs."

Student: "What are the steps of photosynthesis?"
draw("quick steps of photosynthesis")
"Sunlight, water, CO2 in - glucose and oxygen out."

Student: "What does a platypus look like?"
draw("photo of a platypus")
"Notice the duck-like bill and beaver tail."

Student: [Board shows a cell diagram] "Where's the mitochondria?"
draw("circle the mitochondria")
"Right here - it's the powerhouse of the cell."

BAD EXAMPLES - Don't do this:

Student: "Explain photosynthesis"
"Photosynthesis is when plants convert sunlight into energy using chlorophyll..."
[Wrong: Too much talking, no visuals]

Student: "Teach me about the heart"
draw("the heart")
draw("circle the left ventricle")
draw("blood flow animation")
[Wrong: Multiple draws in one response - do ONE at a time]`;

// Tool definitions with NON_BLOCKING behavior
const DRAW_TOOL: FunctionDeclaration = {
  name: "draw",
  description:
    "Draw visuals on the whiteboard. USE THIS for any visual content: text, images, diagrams. Also use this to annotate/circle/highlight things on the whiteboard. A specialized sub-agent will decide the best way to visualize your request.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          'Natural language description of what to show (e.g., "show the water cycle", "display the pythagorean theorem", "draw a neuron diagram", "circle the mitochondria", "highlight the equation")',
      },
    },
    required: ["query"],
  },
  behavior: Behavior.NON_BLOCKING,
};

const CLEAR_BOARD_TOOL: FunctionDeclaration = {
  name: "clear_board",
  description:
    "Clear the whiteboard. USE THIS when switching to a new topic or when the board is cluttered.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
  behavior: Behavior.NON_BLOCKING,
};

// Capture canvas to base64 using excalidrawAPI.exportToBlob
async function captureCanvasWithAPI(excalidrawAPI: any): Promise<string | null> {
  if (!excalidrawAPI) {
    console.warn("[captureCanvas] No excalidrawAPI");
    return null;
  }

  try {
    const blob = await excalidrawAPI.exportToBlob({
      mimeType: "image/png",
      quality: 0.9,
      exportPadding: 10,
    });

    // Convert blob to base64
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.replace(/^data:image\/png;base64,/, ""));
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("[captureCanvas] exportToBlob failed:", e);
    // Fallback to DOM canvas
    try {
      const canvas = document.querySelector(".excalidraw__canvas") as HTMLCanvasElement;
      if (canvas) {
        const dataUrl = canvas.toDataURL("image/png");
        return dataUrl.replace(/^data:image\/png;base64,/, "");
      }
    } catch (e2) {
      console.error("[captureCanvas] Fallback also failed:", e2);
    }
    return null;
  }
}

export default function Phase4Page() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [logs, setLogs] = useState<string[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [pendingToolCall, setPendingToolCall] = useState<string | null>(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const excalidrawAPIRef = useRef<any>(null);

  // Keep ref in sync
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  const addLog = useCallback((type: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev.slice(-100),
      `[${timestamp}] [${type}] ${message}`,
    ]);
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      audioPlaybackRef.current?.stop();
      audioCaptureRef.current?.stop();
    };
  }, []);

  // Handle draw tool call
  const handleDrawToolCall = useCallback(
    async (query: string, toolCallId: string) => {
      addLog("tool", `draw("${query}")`);
      setPendingToolCall(query);

      // Capture screenshot using excalidrawAPI
      const screenshot = await captureCanvasWithAPI(excalidrawAPIRef.current);
      if (screenshot) {
        addLog("tool", `Screenshot captured: ${screenshot.length} bytes`);
      } else {
        addLog("tool", "No screenshot (canvas empty or API unavailable)");
      }

      try {
        const response = await fetch("/api/draw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, screenshot }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          addLog("error", `API error: ${errorData.error}`);
          clientRef.current?.sendToolResponse(
            toolCallId,
            "draw",
            "Error: Failed to draw",
            FunctionResponseScheduling.SILENT
          );
          setPendingToolCall(null);
          return;
        }

        const data = await response.json();
        addLog("tool", `Got ${data.toolCalls?.length || 0} tool calls`);

        // Execute each tool call on Excalidraw
        if (data.toolCalls && Array.isArray(data.toolCalls)) {
          for (const toolCall of data.toolCalls) {
            addLog("tool", `Executing: ${toolCall.tool}`);
            if (excalidrawAPIRef.current) {
              triggerToolCall(
                excalidrawAPIRef.current,
                toolCall.tool,
                toolCall.params
              );
            }
            // Small delay between tool calls
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Send success response with SILENT scheduling
        clientRef.current?.sendToolResponse(
          toolCallId,
          "draw",
          "Done.",
          FunctionResponseScheduling.SILENT
        );
        addLog("tool", "Tool response sent (SILENT)");
      } catch (err) {
        addLog("error", `Draw error: ${err}`);
        clientRef.current?.sendToolResponse(
          toolCallId,
          "draw",
          "Error: Failed to draw",
          FunctionResponseScheduling.SILENT
        );
      } finally {
        setPendingToolCall(null);
      }
    },
    [addLog]
  );

  // Handle clear_board tool call
  const handleClearBoardToolCall = useCallback(
    (toolCallId: string) => {
      addLog("tool", "clear_board()");

      if (excalidrawAPIRef.current) {
        excalidrawAPIRef.current.resetScene();
        addLog("tool", "Board cleared");
      }

      clientRef.current?.sendToolResponse(
        toolCallId,
        "clear_board",
        "Done.",
        FunctionResponseScheduling.SILENT
      );
    },
    [addLog]
  );

  const handleConnect = async () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      addLog("error", "NEXT_PUBLIC_GOOGLE_API_KEY not set");
      return;
    }

    addLog("client", "Creating GeminiLiveClient with draw/clear_board tools...");

    audioPlaybackRef.current = new AudioPlayback();
    await audioPlaybackRef.current.resume();
    addLog("audio", "Audio playback initialized");

    const client = new GeminiLiveClient({
      apiKey,
      tools: [DRAW_TOOL, CLEAR_BOARD_TOOL],
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    clientRef.current = client;

    client.on("stateChange", (state) => {
      addLog("state", state);
      setConnectionState(state);
    });

    client.on("setupComplete", () => {
      addLog("server", "Setup complete - ready for conversation!");
    });

    client.on("audio", (buffer) => {
      audioPlaybackRef.current?.addPCM16(buffer);
    });

    client.on("content", (parts) => {
      addLog("content", JSON.stringify(parts));
    });

    client.on("toolCall", (toolCalls: ToolCall[]) => {
      addLog("server", `Received ${toolCalls.length} tool call(s)`);

      for (const tc of toolCalls) {
        if (tc.name === "draw" && tc.args.query) {
          handleDrawToolCall(tc.args.query as string, tc.id);
        } else if (tc.name === "clear_board") {
          handleClearBoardToolCall(tc.id);
        } else {
          addLog("error", `Unknown tool: ${tc.name}`);
        }
      }
    });

    client.on("turnComplete", () => {
      addLog("server", "Turn complete");
    });

    client.on("interrupted", () => {
      addLog("server", "Interrupted");
      audioPlaybackRef.current?.stop();
    });

    client.on("error", (error) => {
      addLog("error", error.message);
    });

    client.on("log", (type, message) => {
      // Only log important messages to avoid spam
      if (!message.includes("Audio chunk")) {
        addLog(type, message);
      }
    });

    try {
      const success = await client.connect();
      if (success) {
        addLog("client", "Connected! Start speaking to teach.");
      }
    } catch (err) {
      addLog("error", `Connection failed: ${err}`);
    }
  };

  const handleDisconnect = () => {
    clientRef.current?.disconnect();
    audioPlaybackRef.current?.stop();
    audioCaptureRef.current?.stop();
    setMicEnabled(false);
    addLog("client", "Disconnected");
  };

  const handleToggleMic = async () => {
    if (micEnabled) {
      audioCaptureRef.current?.stop();
      audioCaptureRef.current = null;
      setMicEnabled(false);
      addLog("mic", "Microphone stopped");
    } else {
      try {
        const capture = new AudioCapture();
        audioCaptureRef.current = capture;
        capture.on("data", (base64Audio) => {
          clientRef.current?.sendAudio(base64Audio);
        });
        await capture.start();
        setMicEnabled(true);
        addLog("mic", "Microphone started - speak now!");
      } catch (err) {
        addLog("error", `Microphone error: ${err}`);
      }
    }
  };

  const getStatusColor = () => {
    switch (connectionState) {
      case "connected":
        return "bg-green-500";
      case "connecting":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="flex-none p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Phase 4: Full Integration</h1>
            <p className="text-gray-400 text-sm">
              Voice + Canvas + draw()/clear_board() tools
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Status */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-sm capitalize">{connectionState}</span>
            </div>

            {/* Pending tool */}
            {pendingToolCall && (
              <span className="text-yellow-400 text-sm animate-pulse">
                Drawing: {pendingToolCall.slice(0, 30)}...
              </span>
            )}

            {/* Controls */}
            <div className="flex gap-2">
              {connectionState === "disconnected" ||
              connectionState === "error" ? (
                <button
                  onClick={handleConnect}
                  className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium text-sm"
                >
                  Connect
                </button>
              ) : connectionState === "connecting" ? (
                <button
                  disabled
                  className="bg-gray-600 px-4 py-2 rounded font-medium text-sm cursor-not-allowed"
                >
                  Connecting...
                </button>
              ) : (
                <>
                  <button
                    onClick={handleToggleMic}
                    className={`${
                      micEnabled
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-green-600 hover:bg-green-700"
                    } px-4 py-2 rounded font-medium text-sm`}
                  >
                    {micEnabled ? "Stop Mic" : "Start Mic"}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded font-medium text-sm"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Excalidraw Canvas */}
        <div className="flex-1 bg-white">
          <Excalidraw
            excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                export: false,
                saveAsImage: false,
                saveToActiveFile: false,
                toggleTheme: false,
                clearCanvas: false,
              },
            }}
          />
        </div>

        {/* Sidebar - Logs */}
        <div className="w-80 flex-none border-l border-gray-700 flex flex-col">
          <div className="p-3 border-b border-gray-700 flex justify-between items-center">
            <h2 className="font-semibold text-sm">Debug Logs</h2>
            <button
              onClick={() => setLogs([])}
              className="text-gray-400 hover:text-white text-xs"
            >
              Clear
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs bg-black">
            {logs.length === 0 ? (
              <span className="text-gray-500">No logs yet...</span>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={`mb-1 ${
                    log.includes("[error]")
                      ? "text-red-400"
                      : log.includes("[server]")
                      ? "text-green-400"
                      : log.includes("[state]")
                      ? "text-yellow-400"
                      : log.includes("[tool]")
                      ? "text-cyan-400"
                      : log.includes("[mic]") || log.includes("[audio]")
                      ? "text-blue-400"
                      : "text-gray-300"
                  }`}
                >
                  {log}
                </div>
              ))
            )}
          </div>

          {/* Instructions */}
          <div className="p-3 border-t border-gray-700 text-xs text-gray-400">
            <p className="font-semibold text-white mb-1">Try saying:</p>
            <ul className="space-y-1">
              <li>&quot;Teach me about photosynthesis&quot;</li>
              <li>&quot;Draw the solar system&quot;</li>
              <li>&quot;Show me how the heart works&quot;</li>
              <li>&quot;Clear the board&quot;</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
