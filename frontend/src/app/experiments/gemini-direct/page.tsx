"use client";

import Link from "next/link";

export default function GeminiDirectIndex() {
  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-2">Gemini Direct Experiments</h1>
      <p className="text-gray-400 mb-8">
        Replacing LiveKit with direct browser-to-Gemini WebSocket connections
      </p>

      <div className="space-y-4 max-w-2xl">
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2">Phase 1: Speech-to-Speech</h2>
          <p className="text-gray-400 mb-4">
            Basic voice conversation with Gemini. No video, no tools.
          </p>
          <Link
            href="/experiments/gemini-direct/phase1"
            className="inline-block bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
          >
            Open Phase 1
          </Link>
        </div>

        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2">Phase 2: Voice + Screen Share</h2>
          <p className="text-gray-400 mb-4">
            Voice conversation with screen sharing - Gemini can see your screen.
          </p>
          <Link
            href="/experiments/gemini-direct/phase2"
            className="inline-block bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded"
          >
            Open Phase 2
          </Link>
        </div>

        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2">Phase 3: Tool Calling</h2>
          <p className="text-gray-400 mb-4">
            Voice conversation with image search tool (testing tool calling flow).
          </p>
          <Link
            href="/experiments/gemini-direct/phase3"
            className="inline-block bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded"
          >
            Open Phase 3
          </Link>
        </div>

        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2">Phase 4: Full Integration</h2>
          <p className="text-gray-400 mb-4">
            Full Excalidraw integration with draw() and clear_board() tools.
          </p>
          <Link
            href="/experiments/gemini-direct/phase4"
            className="inline-block bg-green-600 hover:bg-green-700 px-4 py-2 rounded"
          >
            Open Phase 4
          </Link>
        </div>
      </div>

      <div className="mt-8 p-4 bg-gray-800 rounded-lg max-w-2xl">
        <h3 className="font-semibold mb-2">Documentation</h3>
        <p className="text-gray-400 text-sm">
          See{" "}
          <code className="bg-gray-700 px-1 rounded">
            frontend/src/experiments/gemini-direct/PLAN.md
          </code>{" "}
          for full implementation details and prompts.
        </p>
      </div>
    </div>
  );
}
