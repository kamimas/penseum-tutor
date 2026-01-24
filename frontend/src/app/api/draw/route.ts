import { NextRequest, NextResponse } from "next/server";

const DRAW_SERVER_URL = process.env.DRAW_SERVER_URL || "http://localhost:5001";

let callCount = 0;

export async function POST(request: NextRequest) {
  callCount++;
  const callId = callCount;

  try {
    const body = await request.json();
    const { query } = body;

    console.log(`[DRAW #${callId}] Called with: "${query}"`);

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: 'Missing or invalid "query" parameter' },
        { status: 400 }
      );
    }

    // Call persistent Python server instead of spawning
    const response = await fetch(`${DRAW_SERVER_URL}/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Draw server error" }));
      return NextResponse.json(
        { error: error.detail || "Draw server error" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    // Check if it's a connection error (server not running)
    if (error.cause?.code === "ECONNREFUSED") {
      return NextResponse.json(
        { error: "Draw server not running. Start with: cd agent && uvicorn draw_server:app --port 5001" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to process draw query" },
      { status: 500 }
    );
  }
}
