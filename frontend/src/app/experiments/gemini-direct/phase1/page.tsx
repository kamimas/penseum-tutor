"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  GeminiLiveClient,
  ConnectionState,
} from "../lib/GeminiLiveClient";
import { AudioPlayback } from "../lib/AudioPlayback";
import { AudioCapture } from "../lib/AudioCapture";

export default function Phase1Page() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [textInput, setTextInput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [audioChunksReceived, setAudioChunksReceived] = useState(0);
  const [micEnabled, setMicEnabled] = useState(false);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);

  const addLog = useCallback((type: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-100), `[${timestamp}] [${type}] ${message}`]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      audioPlaybackRef.current?.stop();
      audioCaptureRef.current?.stop();
    };
  }, []);

  const handleConnect = async () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      addLog("error", "NEXT_PUBLIC_GOOGLE_API_KEY not set");
      return;
    }

    addLog("client", "Creating GeminiLiveClient...");

    // Initialize audio playback
    audioPlaybackRef.current = new AudioPlayback();
    await audioPlaybackRef.current.resume();
    addLog("audio", "Audio playback initialized");

    const client = new GeminiLiveClient({ apiKey });
    clientRef.current = client;

    // Set up event listeners
    client.on("stateChange", (state) => {
      addLog("state", state);
      setConnectionState(state);
    });

    client.on("setupComplete", () => {
      addLog("server", "Setup complete!");
    });

    client.on("audio", (buffer) => {
      setAudioChunksReceived((prev) => prev + 1);
      audioPlaybackRef.current?.addPCM16(buffer);
    });

    client.on("content", (parts) => {
      addLog("content", JSON.stringify(parts));
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
    setAudioChunksReceived(0);
    setMicEnabled(false);
    addLog("client", "Disconnected");
  };

  const handleToggleMic = async () => {
    if (micEnabled) {
      // Stop microphone
      audioCaptureRef.current?.stop();
      audioCaptureRef.current = null;
      setMicEnabled(false);
      addLog("mic", "Microphone stopped");
    } else {
      // Start microphone
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

  const handleSendText = () => {
    if (!textInput.trim()) return;
    audioPlaybackRef.current?.stop();
    audioPlaybackRef.current?.resume();
    clientRef.current?.sendText(textInput);
    setTextInput("");
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
        <h1 className="text-2xl font-bold mb-2">Phase 1: Speech-to-Speech</h1>
        <p className="text-gray-400 mb-6">
          Direct browser-to-Gemini voice conversation
        </p>

        {/* Connection Status */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
            <span className="font-medium capitalize">{connectionState}</span>
            {connectionState === "connected" && (
              <span className="text-gray-400 text-sm">
                Audio chunks: {audioChunksReceived}
              </span>
            )}
          </div>

          <div className="flex gap-2">
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
              micEnabled ? "bg-green-900/30 border border-green-600" : "bg-gray-800"
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
                Your voice is being sent to Gemini in real-time
              </p>
            )}
          </div>
        )}

        {/* Text Input (fallback) */}
        {connectionState === "connected" && (
          <div className="bg-gray-800 rounded-lg p-4 mb-6">
            <h2 className="font-semibold mb-2">Or type a message</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendText()}
                placeholder="Type a message..."
                className="flex-1 bg-gray-700 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSendText}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium"
              >
                Send
              </button>
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
                      : log.includes("[audio]") || log.includes("[mic]")
                      ? "text-purple-400"
                      : "text-gray-300"
                  }`}
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Implementation Progress */}
        <div className="mt-6 bg-gray-800 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Phase 1 Complete</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>GeminiLiveClient.ts - @google/genai SDK</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>AudioPlayback.ts - Speaker output (24kHz PCM)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>AudioCapture.ts - Microphone input (16kHz PCM)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>Full speech-to-speech conversation</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
