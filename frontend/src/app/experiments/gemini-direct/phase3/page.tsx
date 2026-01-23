"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  GeminiLiveClient,
  ConnectionState,
  ToolCall,
} from "../lib/GeminiLiveClient";
import { AudioPlayback } from "../lib/AudioPlayback";
import { AudioCapture } from "../lib/AudioCapture";
import { FunctionDeclaration, Type } from "@google/genai";

// Define the image_search tool
const IMAGE_SEARCH_TOOL: FunctionDeclaration = {
  name: "image_search",
  description:
    "Search for an image on the web using Google Images. Use this when the user asks to see a picture, photo, or image of something.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "The search query for finding the image (e.g., 'cute puppy', 'eiffel tower at night', 'mitochondria diagram')",
      },
    },
    required: ["query"],
  },
};

const SYSTEM_INSTRUCTION = `You are a helpful voice assistant with access to image search.
When the user asks to see an image or picture of something, use the image_search tool.
After performing a search, describe what you found briefly.
Keep your responses conversational and concise.`;

interface ImageResult {
  dataUrl: string;
  title: string;
  width?: number;
  height?: number;
}

export default function Phase3Page() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [logs, setLogs] = useState<string[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [images, setImages] = useState<ImageResult[]>([]);
  const [pendingToolCall, setPendingToolCall] = useState<string | null>(null);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);

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

  // Handle image search tool call
  const handleImageSearch = useCallback(
    async (query: string, toolCallId: string) => {
      addLog("tool", `Searching for: "${query}"`);
      setPendingToolCall(query);

      try {
        const response = await fetch(
          `/api/image-search?q=${encodeURIComponent(query)}`
        );
        const data = await response.json();

        if (data.error) {
          addLog("tool", `Search failed: ${data.error}`);
          clientRef.current?.sendToolResponse(toolCallId, "image_search", `Error: ${data.error}`);
          setPendingToolCall(null);
          return;
        }

        // Add image to display
        setImages((prev) => [
          ...prev,
          {
            dataUrl: data.dataUrl,
            title: data.title || query,
            width: data.width,
            height: data.height,
          },
        ]);

        addLog("tool", `Found image: ${data.title}`);

        // Send simple success response back to Gemini
        clientRef.current?.sendToolResponse(toolCallId, "image_search", `Successfully displayed image: ${data.title}`);
      } catch (err) {
        addLog("tool", `Search error: ${err}`);
        clientRef.current?.sendToolResponse(toolCallId, "image_search", `Error: Failed to search`);
      } finally {
        setPendingToolCall(null);
      }
    },
    [addLog]
  );

  const handleConnect = async () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      addLog("error", "NEXT_PUBLIC_GOOGLE_API_KEY not set");
      return;
    }

    addLog("client", "Creating GeminiLiveClient with tools...");

    audioPlaybackRef.current = new AudioPlayback();
    await audioPlaybackRef.current.resume();
    addLog("audio", "Audio playback initialized");

    const client = new GeminiLiveClient({
      apiKey,
      tools: [IMAGE_SEARCH_TOOL],
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    clientRef.current = client;

    client.on("stateChange", (state) => {
      addLog("state", state);
      setConnectionState(state);
    });

    client.on("setupComplete", () => {
      addLog("server", "Setup complete!");
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
        if (tc.name === "image_search" && tc.args.query) {
          handleImageSearch(tc.args.query as string, tc.id);
        } else {
          addLog("error", `Unknown tool: ${tc.name}`);
          client.sendToolResponse(tc.id, { error: "Unknown tool" });
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
      addLog(type, message);
    });

    try {
      const success = await client.connect();
      if (success) {
        addLog("client", "Connection established!");
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
        addLog("mic", "Microphone started");
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
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Phase 3: Tool Calling</h1>
        <p className="text-gray-400 mb-6">
          Voice conversation with image search tool
        </p>

        {/* Connection Status */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
            <span className="font-medium capitalize">{connectionState}</span>
            {pendingToolCall && (
              <span className="text-yellow-400 text-sm animate-pulse">
                Searching: {pendingToolCall}
              </span>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            {connectionState === "disconnected" ||
            connectionState === "error" ? (
              <button
                onClick={handleConnect}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium"
              >
                Connect
              </button>
            ) : connectionState === "connecting" ? (
              <button
                disabled
                className="bg-gray-600 px-4 py-2 rounded font-medium cursor-not-allowed"
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
                  } px-4 py-2 rounded font-medium`}
                >
                  {micEnabled ? "Stop Mic" : "Start Mic"}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded font-medium"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {/* Microphone Status */}
        {connectionState === "connected" && (
          <div
            className={`rounded-lg p-4 mb-6 ${
              micEnabled
                ? "bg-green-900/30 border border-green-600"
                : "bg-gray-800"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-4 h-4 rounded-full ${
                  micEnabled ? "bg-green-500 animate-pulse" : "bg-gray-500"
                }`}
              />
              <span className="font-medium">
                {micEnabled ? "Listening... Speak now!" : "Microphone off"}
              </span>
            </div>
            {micEnabled && (
              <p className="text-gray-400 text-sm mt-2">
                Try saying: &quot;Show me a picture of a golden retriever
                puppy&quot;
              </p>
            )}
          </div>
        )}

        {/* Images Display */}
        {images.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 mb-6">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold">Images Found</h2>
              <button
                onClick={() => setImages([])}
                className="text-gray-400 hover:text-white text-sm"
              >
                Clear All
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img
                    src={img.dataUrl}
                    alt={img.title}
                    className="w-full rounded-lg"
                  />
                  <p className="text-xs text-gray-400 mt-1 truncate">
                    {img.title}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Debug Logs */}
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold">Debug Logs</h2>
            <button
              onClick={() => setLogs([])}
              className="text-gray-400 hover:text-white text-sm"
            >
              Clear
            </button>
          </div>
          <div className="bg-black rounded p-3 h-64 overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <span className="text-gray-500">No logs yet...</span>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={`${
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
        </div>

        {/* What's Being Tested */}
        <div className="mt-6 bg-gray-800 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Phase 3: Tool Calling Test</h2>
          <ul className="space-y-2 text-sm text-gray-400">
            <li>
              <span className="text-white">Tool:</span> image_search (via
              SerpAPI)
            </li>
            <li>
              <span className="text-white">Flow:</span> User speaks → Gemini
              decides to call tool → Browser executes → Response sent back
            </li>
            <li>
              <span className="text-white">Try:</span> &quot;Show me a picture
              of the Eiffel Tower&quot;
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
