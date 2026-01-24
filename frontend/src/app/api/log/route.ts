import { NextRequest, NextResponse } from "next/server";
import { appendFileSync } from "fs";
import { join } from "path";

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();
    const logPath = join(process.cwd(), "..", "agent", "tool_calls.log");
    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to write log:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
