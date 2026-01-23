import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

export async function POST(request: NextRequest) {
  let tempImagePath: string | null = null;

  try {
    const body = await request.json();
    const { query, screenshot } = body;

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

    // Build command args
    const args = [scriptPath, query];

    // If screenshot provided, write to temp file and add --image flag
    if (screenshot && typeof screenshot === "string") {
      tempImagePath = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
      const imageBuffer = Buffer.from(screenshot, "base64");
      fs.writeFileSync(tempImagePath, imageBuffer);
      args.push("--image", tempImagePath);

      // DEBUG: Also save to agent folder for inspection
      const debugPath = path.join(agentPath, "debug-screenshot.png");
      fs.writeFileSync(debugPath, imageBuffer);
      console.log("[API /draw] Screenshot saved to:", debugPath);
      console.log("[API /draw] Screenshot size:", imageBuffer.length, "bytes");
    } else {
      console.log("[API /draw] No screenshot provided");
    }

    console.log("[API /draw] Query:", query);

    // Call the Python sub-agent
    const toolCalls = await new Promise<any[]>((resolve, reject) => {
      const python = spawn(venvPython, args, {
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

    // DEBUG: Log the tool calls returned
    console.log("[API /draw] Tool calls returned:", JSON.stringify(toolCalls, null, 2));

    // Resolve animate tool calls by fetching p5.js code
    const resolvedToolCalls = await Promise.all(
      toolCalls.map(async (toolCall: any) => {
        if (toolCall.tool === "animate" && toolCall.params?.prompt) {
          console.log("[API /draw] Resolving animate tool call:", toolCall.params.prompt);

          try {
            // Call p5 subagent to get the code
            const p5AgentPath = path.join(process.cwd(), "..", "agent", "p5js");
            const p5ScriptPath = path.join(p5AgentPath, "p5_subagent.py");

            const p5Result = await new Promise<any>((resolve, reject) => {
              const python = spawn(venvPython, [p5ScriptPath, toolCall.params.prompt], {
                cwd: p5AgentPath,
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
                  console.error("[API /draw] p5 subagent stderr:", stderr);
                  reject(new Error(`p5 subagent failed: ${stderr}`));
                  return;
                }

                try {
                  const lines = stdout.split("\n");
                  const jsonStartIndex = lines.findIndex((line) =>
                    line.trim().startsWith("{")
                  );
                  if (jsonStartIndex === -1) {
                    reject(new Error("Could not find JSON output from p5 subagent"));
                    return;
                  }
                  const jsonOutput = lines.slice(jsonStartIndex).join("\n");
                  const parsed = JSON.parse(jsonOutput);
                  resolve(parsed);
                } catch (e) {
                  reject(new Error("Failed to parse p5 subagent output"));
                }
              });
            });

            // Add the code to the tool call params
            if (p5Result.code) {
              console.log("[API /draw] Got p5.js code, length:", p5Result.code.length);
              return {
                ...toolCall,
                params: {
                  ...toolCall.params,
                  code: p5Result.code,
                },
              };
            }
          } catch (err) {
            console.error("[API /draw] Failed to resolve animate:", err);
          }
        }
        return toolCall;
      })
    );

    // Cleanup temp file
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      fs.unlinkSync(tempImagePath);
    }

    return NextResponse.json({ toolCalls: resolvedToolCalls });
  } catch (error: any) {
    console.error("Error calling draw sub-agent:", error);

    // Cleanup temp file on error
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      fs.unlinkSync(tempImagePath);
    }

    return NextResponse.json(
      { error: error.message || "Failed to process draw query" },
      { status: 500 }
    );
  }
}
