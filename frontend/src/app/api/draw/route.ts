import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import * as path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: 'Missing or invalid "query" parameter' },
        { status: 400 }
      );
    }

    // Path to the Python sub-agent script
    const agentPath = path.join(process.cwd(), "..", "agent");
    const scriptPath = path.join(agentPath, "draw_subagent.py");
    const venvPython = path.join(agentPath, "venv", "bin", "python");

    // Call the Python sub-agent
    const toolCalls = await new Promise<any[]>((resolve, reject) => {
      const python = spawn(venvPython, [scriptPath, query], {
        cwd: agentPath,
        env: {
          ...process.env,
          GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        },
      });

      let stdout = "";
      let stderr = "";

      python.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      python.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      python.on("close", (code) => {
        if (code !== 0) {
          console.error("Python stderr:", stderr);
          console.error("Python stdout:", stdout);
          console.error("Python path:", venvPython);
          console.error("Script path:", scriptPath);
          console.error("GOOGLE_API_KEY set:", !!process.env.GOOGLE_API_KEY);
          reject(new Error(`Python script exited with code ${code}. stderr: ${stderr}, stdout: ${stdout}`));
          return;
        }

        try {
          // Extract JSON from output (skip the "Query:" and "---" lines)
          const lines = stdout.split("\n");
          const jsonStartIndex = lines.findIndex((line) =>
            line.trim().startsWith("[")
          );
          if (jsonStartIndex === -1) {
            reject(new Error("Could not find JSON output"));
            return;
          }
          const jsonOutput = lines.slice(jsonStartIndex).join("\n");
          const parsed = JSON.parse(jsonOutput);
          resolve(parsed);
        } catch (e) {
          console.error("Failed to parse Python output:", stdout);
          reject(new Error("Failed to parse JSON from Python script"));
        }
      });
    });

    return NextResponse.json({ toolCalls });
  } catch (error: any) {
    console.error("Error calling draw sub-agent:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process draw query" },
      { status: 500 }
    );
  }
}
