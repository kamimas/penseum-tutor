"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  GeminiLiveClient,
  ConnectionState,
} from "../lib/GeminiLiveClient";
import { AudioPlayback } from "../lib/AudioPlayback";
import { AudioCapture } from "../lib/AudioCapture";
import { ScreenCapture } from "../lib/ScreenCapture";

export default function Phase2Page() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [logs, setLogs] = useState<string[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [framesSent, setFramesSent] = useState(0);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const screenCaptureRef = useRef<ScreenCapture | null>(null);

  const addLog = useCallback((type: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-100), `[${timestamp}] [${type}] ${message}`]);
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      audioPlaybackRef.current?.stop();
      audioCaptureRef.current?.stop();
      screenCaptureRef.current?.stop();
    };
  }, []);

  const handleConnect = async () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      addLog("error", "NEXT_PUBLIC_GOOGLE_API_KEY not set");
      return;
    }

    addLog("client", "Creating GeminiLiveClient...");

    audioPlaybackRef.current = new AudioPlayback();
    await audioPlaybackRef.current.resume();
    addLog("audio", "Audio playback initialized");

    const client = new GeminiLiveClient({ apiKey });
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
    screenCaptureRef.current?.stop();
    setMicEnabled(false);
    setScreenEnabled(false);
    setFramesSent(0);
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

  const handleToggleScreen = async () => {
    if (screenEnabled) {
      screenCaptureRef.current?.stop();
      screenCaptureRef.current = null;
      setScreenEnabled(false);
      addLog("screen", "Screen share stopped");
    } else {
      try {
        const capture = new ScreenCapture();
        screenCaptureRef.current = capture;
        await capture.start((base64Jpeg) => {
          clientRef.current?.sendImage(base64Jpeg);
          setFramesSent((prev) => prev + 1);
        }, 1); // 1 FPS
        setScreenEnabled(true);
        addLog("screen", "Screen share started (1 FPS)");
      } catch (err) {
        addLog("error", `Screen share error: ${err}`);
        setScreenEnabled(false);
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
        <h1 className="text-2xl font-bold mb-2">Phase 2: Voice + Screen Share</h1>
        <p className="text-gray-400 mb-6">
          Voice conversation with screen sharing - Gemini can see your screen
        </p>

        {/* Connection Status */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
            <span className="font-medium capitalize">{connectionState}</span>
            {screenEnabled && (
              <span className="text-gray-400 text-sm">
                Frames sent: {framesSent}
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
                  onClick={handleToggleScreen}
                  className={`${
                    screenEnabled
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-purple-600 hover:bg-purple-700"
                  } px-4 py-2 rounded font-medium`}
                >
                  {screenEnabled ? "Stop Screen" : "Share Screen"}
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

        {/* Status Indicators */}
        {connectionState === "connected" && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div
              className={`rounded-lg p-4 ${
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
                  {micEnabled ? "Mic ON" : "Mic OFF"}
                </span>
              </div>
            </div>
            <div
              className={`rounded-lg p-4 ${
                screenEnabled ? "bg-purple-900/30 border border-purple-600" : "bg-gray-800"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-4 h-4 rounded-full ${
                    screenEnabled ? "bg-purple-500 animate-pulse" : "bg-gray-500"
                  }`}
                />
                <span className="font-medium">
                  {screenEnabled ? "Screen ON" : "Screen OFF"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        {connectionState === "connected" && (
          <div className="bg-gray-800 rounded-lg p-4 mb-6">
            <h2 className="font-semibold mb-2">How to test</h2>
            <ol className="list-decimal list-inside text-gray-400 text-sm space-y-1">
              <li>Click &quot;Start Mic&quot; to enable voice</li>
              <li>Click &quot;Share Screen&quot; and select a window/screen</li>
              <li>Ask Gemini &quot;What do you see on my screen?&quot;</li>
            </ol>
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
                      : log.includes("[screen]")
                      ? "text-purple-400"
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
      </div>
    </div>
  );
}
