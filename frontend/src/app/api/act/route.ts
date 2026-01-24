import { NextRequest, NextResponse } from "next/server";

const DRAW_SERVER_URL = process.env.DRAW_SERVER_URL || "http://localhost:5001";

let callCount = 0;

export async function POST(request: NextRequest) {
  callCount++;
  const callId = callCount;

  try {
    const body = await request.json();
    const { intent } = body;

    console.log(`[ACT #${callId}] Called with: "${intent}"`);

    if (!intent || typeof intent !== "string") {
      return NextResponse.json(
        { error: 'Missing or invalid "intent" parameter' },
        { status: 400 }
      );
    }

    // Call persistent Python server
    const response = await fetch(`${DRAW_SERVER_URL}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Act server error" }));
      return NextResponse.json(
        { error: error.detail || "Act server error" },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log(`[ACT #${callId}] Got ${data.toolCalls?.length || 0} tool calls`);
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
      { error: error.message || "Failed to process act intent" },
      { status: 500 }
    );
  }
}
