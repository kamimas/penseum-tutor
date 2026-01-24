import { NextRequest, NextResponse } from "next/server";

const DRAW_SERVER_URL = process.env.DRAW_SERVER_URL || "http://localhost:5001";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: 'Missing or invalid "prompt" parameter' },
        { status: 400 }
      );
    }

    // Call persistent Python server instead of spawning
    const response = await fetch(`${DRAW_SERVER_URL}/p5`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "P5 server error" }));
      return NextResponse.json(
        { error: error.detail || "P5 server error" },
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
      { error: error.message || "Failed to generate animation" },
      { status: 500 }
    );
  }
}
