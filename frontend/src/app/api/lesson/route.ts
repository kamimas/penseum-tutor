import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic } = body;

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { error: 'Missing or invalid "topic" parameter' },
        { status: 400 }
      );
    }

    // Path to the Python sub-agent script
    const agentPath = path.join(process.cwd(), "..", "agent");
    const scriptPath = path.join(agentPath, "lesson_subagent.py");
    const venvPython = path.join(agentPath, "venv", "bin", "python");

    // Call the Python sub-agent
    const lesson = await new Promise<any>((resolve, reject) => {
      const python = spawn(venvPython, [scriptPath, topic], {
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
          reject(new Error(`Python script exited with code ${code}. stderr: ${stderr}`));
          return;
        }

        try {
          // Extract JSON from output (skip the "Topic:" and "---" lines)
          const lines = stdout.split("\n");
          const jsonStartIndex = lines.findIndex((line) =>
            line.trim().startsWith("{") || line.trim().startsWith("[")
          );
          if (jsonStartIndex === -1) {
            reject(new Error("Could not find JSON output"));
            return;
          }
          const jsonOutput = lines.slice(jsonStartIndex).join("\n");
          let parsed = JSON.parse(jsonOutput);
          // If array, take first element
          if (Array.isArray(parsed)) {
            parsed = parsed[0];
          }
          resolve(parsed);
        } catch {
          reject(new Error("Failed to parse JSON from Python script"));
        }
      });
    });

    // Save lesson to lesson.json for debugging
    const lessonJsonPath = path.join(agentPath, "lesson.json");
    fs.writeFileSync(lessonJsonPath, JSON.stringify(lesson, null, 2));

    return NextResponse.json({ lesson });
  } catch (error: any) {

    return NextResponse.json(
      { error: error.message || "Failed to generate lesson" },
      { status: 500 }
    );
  }
}
