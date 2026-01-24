"use client";

/**
 * Act Tool Test Page
 *
 * Tests Gemini Live's ability to express intent through a single "act" tool.
 * Intents are routed to act_subagent which interprets them into specific tool calls.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { GeminiLiveClient, ConnectionState, ToolCall } from "../lib/GeminiLiveClient";
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

// =============================================================================
// CONFIGURATION
// =============================================================================

const SYSTEM_INSTRUCTION = `You are PAI, an interactive visual tutor. You control a screen and MUST use act() to do things.

# CRITICAL RULES
1. EVERY response must include act()
2. Call act() FIRST, then speak - they run in parallel
3. Do NOT react to act() results - just keep talking, the visual appears automatically
4. act() should COMPLEMENT your speech, not duplicate it
5. Show visuals that ADD information - don't repeat what you're saying

# TOOL: act(intent)
Use for: diagrams, images, animations, graphs, annotations, clearing, remembering

# COMPLEMENTARY EXAMPLES (GOOD)

Input: "Teach me about photosynthesis"
act("show diagram of photosynthesis process")
Response: "See the sunlight hitting the leaf? That's step one."
// Visual shows the diagram, voice explains it - they work together

Input: "What is the pythagorean theorem?"
act("show right triangle with sides labeled a, b, c")
Response: "A squared plus B squared equals C squared. See how C is the longest side?"
// Visual shows triangle, voice explains the formula - complementary

Input: "How does the heart pump blood?"
act("animate blood flowing through heart")
Response: "Watch the red blood go out to your body, and the blue come back."
// Animation shows movement, voice narrates - not duplicated

Input: "Quiz me"
act("show multiple choice question about the cell")
Response: "Alright, take your best guess!"
// Only show question on screen for formal quiz

Input: "Hi, I'm Alex"
act("remember student's name is Alex")
Response: "Nice to meet you Alex! What would you like to learn?"

Input: "Let's move on"
act("clear the board")
Response: "Fresh start! What's next?"

# BAD EXAMPLES (DON'T DO THIS)

Input: "What's 2 + 2?"
act("show text: What is 2 + 2?") // WRONG - just asked verbally
Response: "What's 2 + 2?"

Input: "Tell me about gravity"
act("show text: Gravity is the force that pulls objects together") // WRONG - duplicates speech
Response: "Gravity is the force that pulls objects together"

# KEY PRINCIPLE
Voice = explanation/questions
Screen = visuals/diagrams/animations that support the voice
Never show text that just repeats what you're saying.
`;

const ACT_TOOL: FunctionDeclaration = {
  name: "act",
  description: "Execute any action on the screen. MUST be called every turn. Use for: showing diagrams/images, clearing the board, highlighting/annotating, animating concepts, displaying quizzes, graphing functions, writing text/formulas.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      intent: {
        type: Type.STRING,
        description: "Natural language description of the screen action. Examples: 'show diagram of the water cycle', 'clear the board', 'highlight the mitochondria', 'animate a ball falling', 'show multiple choice question about X', 'graph sin(x)', 'display formula E=mc²'",
      },
    },
    required: ["intent"],
  },
  // NON_BLOCKING: Speak while act() executes in parallel
  behavior: Behavior.NON_BLOCKING,
};

// =============================================================================
// TYPES
// =============================================================================

interface IntentEntry {
  id: string;
  intent: string;
  timestamp: Date;
  inputText?: string;
  toolCalls?: { tool: string; params: Record<string, unknown> }[];
}

interface LogEntry {
  id: string;
  type: "client" | "server" | "tool" | "latency" | "error";
  message: string;
  timestamp: Date;
}

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function ActTestPage() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [intents, setIntents] = useState<IntentEntry[]>([]);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [lastInput, setLastInput] = useState("");
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const excalidrawAPIRef = useRef<any>(null);
  const textSentTimeRef = useRef<number>(0);
  const lastAudioTimeRef = useRef<number>(0);

  // Keep ref in sync
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    setLogs((prev) => [
      ...prev.slice(-100),
      {
        id: `${Date.now()}-${Math.random()}`,
        type,
        message,
        timestamp: new Date(),
      },
    ]);
  }, []);

  const addIntent = useCallback((intent: string, inputText?: string, toolCalls?: { tool: string; params: Record<string, unknown> }[]) => {
    setIntents((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        intent,
        timestamp: new Date(),
        inputText,
        toolCalls,
      },
    ]);
  }, []);

  // Handle act tool call - interpret and execute
  const handleActToolCall = useCallback(
    async (intent: string, toolCallId: string) => {
      // Send tool response IMMEDIATELY to prevent Gemini from waiting/retrying
      clientRef.current?.sendToolResponse(toolCallId, "act", "Done.", FunctionResponseScheduling.SILENT);

      const startTime = performance.now();
      addLog("tool", `act("${intent}")`);
      setPendingIntent(intent);

      try {
        // Call /api/act to interpret the intent
        const apiStart = performance.now();
        const response = await fetch("/api/act", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          addLog("error", `API error: ${errorData.error}`);
          setPendingIntent(null);
          return;
        }

        const data = await response.json();
        const networkLatency = performance.now() - apiStart;

        // Log granular timing from server
        if (data.timing) {
          addLog("latency", `Model: ${data.timing.model_ms?.toFixed(0) || "?"}ms | Server: ${data.timing.server_ms?.toFixed(0) || "?"}ms | Network: ${(networkLatency - (data.timing.server_ms || 0)).toFixed(0)}ms`);
        } else {
          addLog("latency", `API round-trip: ${networkLatency.toFixed(0)}ms`);
        }
        addLog("tool", `Interpreted into ${data.toolCalls?.length || 0} tool calls`);

        // Execute each tool call on Excalidraw
        if (data.toolCalls && Array.isArray(data.toolCalls)) {
          const execStart = performance.now();
          for (const tc of data.toolCalls) {
            addLog("tool", `→ ${tc.tool}(${JSON.stringify(tc.params).slice(0, 50)}...)`);

            if (tc.tool === "clear_board") {
              excalidrawAPIRef.current?.resetScene();
            } else if (excalidrawAPIRef.current) {
              triggerToolCall(excalidrawAPIRef.current, tc.tool, tc.params);
            }

            // Small delay between tool calls
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const execLatency = performance.now() - execStart;
          addLog("latency", `Canvas render: ${execLatency.toFixed(0)}ms`);

          // Log the intent with its tool calls
          addIntent(intent, lastInput, data.toolCalls);
        } else {
          addIntent(intent, lastInput);
        }

        const totalLatency = performance.now() - startTime;
        addLog("latency", `Total act(): ${totalLatency.toFixed(0)}ms`);
      } catch (err) {
        addLog("error", `Act error: ${err}`);
      } finally {
        setPendingIntent(null);
      }
    },
    [addLog, addIntent, lastInput]
  );

  // Handle tool calls from Gemini
  const handleToolCall = useCallback(
    (toolCalls: ToolCall[]) => {
      const now = performance.now();

      // Measure latency from input (text or voice) to tool call
      if (textSentTimeRef.current > 0) {
        const latency = now - textSentTimeRef.current;
        addLog("latency", `Text → Tool: ${latency.toFixed(0)}ms`);
        textSentTimeRef.current = 0;
      } else if (lastAudioTimeRef.current > 0) {
        const latency = now - lastAudioTimeRef.current;
        addLog("latency", `Voice → Tool: ${latency.toFixed(0)}ms (from last audio chunk)`);
        lastAudioTimeRef.current = 0;
      }

      for (const tc of toolCalls) {
        if (tc.name === "act" && tc.args.intent) {
          handleActToolCall(tc.args.intent as string, tc.id);
        } else {
          addLog("tool", `Unknown: ${tc.name}(${JSON.stringify(tc.args)})`);
          clientRef.current?.sendToolResponse(tc.id, tc.name, "Done.", FunctionResponseScheduling.SILENT);
        }
      }
    },
    [addLog, handleActToolCall]
  );

  // Connect to Gemini
  const handleConnect = useCallback(async () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      addLog("error", "NEXT_PUBLIC_GOOGLE_API_KEY not set");
      return;
    }

    audioPlaybackRef.current = new AudioPlayback();
    await audioPlaybackRef.current.resume();

    const client = new GeminiLiveClient({
      apiKey,
      tools: [ACT_TOOL],
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    clientRef.current = client;

    client.on("stateChange", setConnectionState);
    client.on("log", (type, message) => {
      if (!message.includes("Audio chunk")) {
        addLog(type as "client" | "server", message);
      }
    });
    client.on("setupComplete", () => addLog("server", "Session ready"));
    client.on("audio", (buffer) => audioPlaybackRef.current?.addPCM16(buffer));
    client.on("toolCall", handleToolCall);
    client.on("interrupted", () => {
      addLog("server", "Interrupted");
      audioPlaybackRef.current?.stop();
    });
    client.on("turnComplete", () => addLog("server", "Turn complete"));
    client.on("inputTranscription", (text) => {
      setInputTranscript((prev) => prev + text);
    });
    client.on("outputTranscription", (text) => {
      setOutputTranscript((prev) => prev + text);
    });
    client.on("error", (error) => addLog("error", error.message));

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
      addLog("client", "Mic OFF");
    } else {
      try {
        const capture = new AudioCapture();
        audioCaptureRef.current = capture;
        capture.on("data", (base64Audio) => {
          lastAudioTimeRef.current = performance.now();
          clientRef.current?.sendAudio(base64Audio);
        });
        await capture.start();
        setIsMicEnabled(true);
        addLog("client", "Mic ON");
      } catch (err) {
        addLog("error", `Mic error: ${err}`);
      }
    }
  }, [isMicEnabled, addLog]);

  // Send text message
  const sendTestMessage = useCallback((text: string) => {
    textSentTimeRef.current = performance.now();
    setInputTranscript("");
    setOutputTranscript("");
    setLastInput(text);
    addLog("client", `Sending: "${text}"`);
    clientRef.current?.sendText(text);
  }, [addLog]);

  // Copy intents to clipboard
  const handleCopyIntents = useCallback(() => {
    const text = intents.map((i) => {
      let line = `[${i.timestamp.toLocaleTimeString()}] act("${i.intent}")`;
      if (i.toolCalls) {
        line += `\n  → ${i.toolCalls.map(tc => tc.tool).join(", ")}`;
      }
      return line;
    }).join("\n\n");
    navigator.clipboard.writeText(text);
    addLog("client", "Copied to clipboard");
  }, [intents, addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      audioPlaybackRef.current?.stop();
      audioCaptureRef.current?.stop();
    };
  }, []);

  const getStatusColor = () => {
    switch (connectionState) {
      case "connected": return "bg-green-500";
      case "connecting": return "bg-yellow-500";
      case "error": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="flex-none p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Act Tool Test</h1>
            <p className="text-gray-400 text-sm">
              Single act(intent) → interpreted by smarter model → executed on canvas
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Status */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-sm capitalize">{connectionState}</span>
            </div>

            {/* Pending */}
            {pendingIntent && (
              <span className="text-yellow-400 text-sm animate-pulse">
                Processing: {pendingIntent.slice(0, 25)}...
              </span>
            )}

            {/* Controls */}
            <div className="flex gap-2">
              {connectionState === "disconnected" || connectionState === "error" ? (
                <button
                  onClick={handleConnect}
                  className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium text-sm"
                >
                  Connect
                </button>
              ) : connectionState === "connecting" ? (
                <button disabled className="bg-gray-600 px-4 py-2 rounded text-sm cursor-not-allowed">
                  Connecting...
                </button>
              ) : (
                <>
                  <button
                    onClick={handleToggleMic}
                    className={`${isMicEnabled ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} px-4 py-2 rounded font-medium text-sm`}
                  >
                    {isMicEnabled ? "Stop Mic" : "Start Mic"}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded text-sm"
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
        <div className="flex-1 min-w-0 overflow-hidden bg-white">
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

        {/* Sidebar */}
        <div className="w-96 flex-none border-l border-gray-700 flex flex-col overflow-hidden">
          {/* Test Buttons */}
          {connectionState === "connected" && (
            <div className="p-3 border-b border-gray-700">
              <h3 className="text-xs text-gray-400 mb-2">Test Messages</h3>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => sendTestMessage("Teach me about photosynthesis")} className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-xs">Photosynthesis</button>
                <button onClick={() => sendTestMessage("Let's switch topics")} className="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded text-xs">Switch</button>
                <button onClick={() => sendTestMessage("Clear the board")} className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-xs">Clear</button>
                <button onClick={() => sendTestMessage("Graph sin(x)")} className="bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded text-xs">Graph</button>
                <button onClick={() => sendTestMessage("Quiz me")} className="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-xs">Quiz</button>
              </div>
            </div>
          )}

          {/* Intent Panel */}
          <div className="p-3 border-b border-gray-700 max-h-64 overflow-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs text-yellow-400 font-semibold">act() Intents ({intents.length})</h3>
              {intents.length > 0 && (
                <button onClick={handleCopyIntents} className="text-xs text-gray-400 hover:text-white">Copy</button>
              )}
            </div>
            {intents.length === 0 ? (
              <p className="text-xs text-gray-500">No intents yet</p>
            ) : (
              <div className="space-y-2">
                {intents.slice(-5).map((entry) => (
                  <div key={entry.id} className="text-xs border-l-2 border-yellow-500 pl-2">
                    <div className="text-yellow-400 font-mono">act(&quot;{entry.intent.slice(0, 40)}...&quot;)</div>
                    {entry.toolCalls && (
                      <div className="text-gray-400">→ {entry.toolCalls.map(tc => tc.tool).join(", ")}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Transcripts */}
          <div className="p-3 border-b border-gray-700">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <h4 className="text-xs text-gray-400 mb-1">You</h4>
                <div className="bg-black rounded p-2 text-xs text-green-400 min-h-[40px] max-h-[60px] overflow-auto">
                  {inputTranscript || "..."}
                </div>
              </div>
              <div>
                <h4 className="text-xs text-gray-400 mb-1">AI</h4>
                <div className="bg-black rounded p-2 text-xs text-purple-400 min-h-[40px] max-h-[60px] overflow-auto">
                  {outputTranscript || "..."}
                </div>
              </div>
            </div>
          </div>

          {/* Log Panel */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="p-3 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-xs text-gray-400">Event Log</h3>
              <button onClick={() => setLogs([])} className="text-xs text-gray-500 hover:text-white">Clear</button>
            </div>
            <div className="flex-1 overflow-auto p-3 bg-black font-mono text-xs">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`mb-1 ${
                    log.type === "error" ? "text-red-400" :
                    log.type === "tool" ? "text-yellow-400" :
                    log.type === "latency" ? "text-pink-400" :
                    log.type === "server" ? "text-green-400" :
                    "text-gray-400"
                  }`}
                >
                  <span className="opacity-50">[{log.timestamp.toLocaleTimeString()}]</span> {log.message}
                </div>
              ))}
            </div>
          </div>

          {/* Back link */}
          <div className="p-3 border-t border-gray-700 text-center">
            <a href="/experiments/gemini-direct" className="text-blue-400 text-xs hover:underline">
              ← Back to Experiments
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
