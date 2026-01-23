import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import * as path from "path";

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

    console.log("[API /p5] Prompt:", prompt);

    // Path to the Python p5.js sub-agent
    const agentPath = path.join(process.cwd(), "..", "agent", "p5js");
    const scriptPath = path.join(agentPath, "p5_subagent.py");
    const venvPython = path.join(process.cwd(), "..", "agent", "venv", "bin", "python");

    // Call the Python sub-agent
    const result = await new Promise<any>((resolve, reject) => {
      const python = spawn(venvPython, [scriptPath, prompt], {
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
          reject(new Error(`Python script exited with code ${code}. stderr: ${stderr}`));
          return;
        }

        try {
          // Extract JSON from output (skip the "Prompt:" and "---" lines)
          const lines = stdout.split("\n");
          const jsonStartIndex = lines.findIndex((line) =>
            line.trim().startsWith("{")
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

    console.log("[API /p5] Result received, code length:", result.code?.length || 0);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error calling p5.js sub-agent:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate animation" },
      { status: 500 }
    );
  }
}
