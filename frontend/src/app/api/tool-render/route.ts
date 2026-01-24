/**
 * Tool Render Benchmark API
 *
 * Tests tool calling across models AND executes the tools to get renderable output.
 * For animate tool, generates actual p5.js code.
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

// Only animate tool for p5.js benchmark
const TOOLS_OPENAI: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "animate",
      description: "Create a p5.js animation. ALWAYS use this tool to render the user's request as an interactive animation.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed description of the animation to create" },
        },
        required: ["prompt"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are a p5.js Animation Agent. Your ONLY job is to call the animate tool.

RULES:
1. ALWAYS call the animate tool with a detailed prompt
2. Convert the user's request into animation instructions
3. Include physics, colors, motion details in the prompt

Example:
User: "bouncing ball"
You call: animate(prompt: "A red ball bouncing up and down with gravity. Ball starts at top, falls with acceleration, bounces off bottom with energy loss. Show velocity with motion blur.")

IMPORTANT: Always call animate. Never respond with text only.`;

// Full P5.js code generation prompt from p5_subagent.py
const P5_SYSTEM_PROMPT = `You generate interactive p5.js sketches for education.

OUTPUT ONLY valid JSON (no prose/markdown):
{"code":"// p5.js code"}

HARD RULES
- Must call createCanvas(600,400) in setup.
- Never use: loadImage, loadFont, createGraphics, WEBGL, while loops, get(x,y).
- Keep it fast: 20–50 particles max; any array <100; avoid nested loops over particles.
- Use Math.random / sin / cos. Declare all variables with let/const.

INTERACTIVITY (only if it teaches)
- Add interaction only when it clarifies cause→effect (diffusion click-drop, gravity drag-mass, equilibrium perturb).
- Otherwise, no controls.
- If controls exist: draw rectangle buttons with labels; click hitbox:
  if (mouseX>bx && mouseX<bx+bw && mouseY>by && mouseY<by+bh)
- Show state visually (hover/active changes).

VISUAL BASELINE
- Dark background (26,26,46), readable white title at top.
- If controls exist, hint text at bottom.
- One concept per sketch.

GOOD OUTPUT EXAMPLE (shape only)
{"code":"function setup(){createCanvas(600,400);} function draw(){background(26,26,46); fill(255); text('Diffusion',10,25);}"}

BAD OUTPUT EXAMPLE (never do this)
- Any text outside JSON
- \`\`\`code fences\`\`\`
- Using WEBGL/loadImage/while loops`;

// =============================================================================
// MODEL CONFIGS
// =============================================================================

interface ModelConfig {
  id: string;
  provider: "openai" | "xai" | "gemini";
  model: string;
  label: string;
}

const MODELS: ModelConfig[] = [
  // xAI models - model name controls reasoning (-reasoning vs -non-reasoning)
  { id: "grok-4-1-fast-non-reasoning", provider: "xai", model: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast (No Think)" },
  { id: "grok-4-1-fast-reasoning", provider: "xai", model: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast (Think)" },
  // Gemini models - thinkingBudget: 0 disables thinking
  { id: "gemini-3-flash-preview", provider: "gemini", model: "gemini-3-flash-preview", label: "Gemini 3 Flash (draw_subagent)" },
  { id: "gemini-flash-latest", provider: "gemini", model: "gemini-flash-latest", label: "Gemini Flash Latest" },
  { id: "gemini-flash-lite-latest", provider: "gemini", model: "gemini-flash-lite-latest", label: "Gemini Flash Lite" },
];

// =============================================================================
// BENCHMARK FUNCTIONS
// =============================================================================

interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  rendered?: {
    type: "text" | "diagram" | "function" | "p5js";
    content: string;
  };
}

interface BenchmarkResult {
  modelId: string;
  modelLabel: string;
  provider: string;
  prompt: string;
  toolCallLatencyMs: number;
  renderLatencyMs: number;
  totalLatencyMs: number;
  toolCalls: ToolCallResult[];
  error?: string;
}

async function generateP5Code(
  prompt: string,
  provider: "openai" | "xai" | "gemini",
  apiKey: string
): Promise<{ code: string; latencyMs: number }> {
  const start = performance.now();

  if (provider === "gemini") {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ text: `Generate p5.js animation for: ${prompt}` }] }],
      config: {
        systemInstruction: P5_SYSTEM_PROMPT,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let text = response.text?.trim() || "";
    if (text.includes("```json")) {
      text = text.split("```json")[1].split("```")[0].trim();
    } else if (text.includes("```")) {
      text = text.split("```")[1].split("```")[0].trim();
    }

    try {
      const result = JSON.parse(text);
      return { code: result.code || "", latencyMs: performance.now() - start };
    } catch {
      return { code: "", latencyMs: performance.now() - start };
    }
  } else {
    // OpenAI/xAI
    const baseURL = provider === "xai" ? "https://api.x.ai/v1" : undefined;
    const client = new OpenAI({ apiKey, baseURL });

    const response = await client.chat.completions.create({
      model: provider === "xai" ? "grok-4-1-fast-non-reasoning" : "gpt-4o-mini",
      messages: [
        { role: "system", content: P5_SYSTEM_PROMPT },
        { role: "user", content: `Generate p5.js animation for: ${prompt}` },
      ],
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content || "";
    try {
      const result = JSON.parse(text);
      return { code: result.code || "", latencyMs: performance.now() - start };
    } catch {
      return { code: "", latencyMs: performance.now() - start };
    }
  }
}

async function benchmarkOpenAI(
  config: ModelConfig,
  prompt: string,
  apiKey: string
): Promise<BenchmarkResult> {
  const baseURL = config.provider === "xai" ? "https://api.x.ai/v1" : undefined;
  const client = new OpenAI({
    apiKey: config.provider === "xai" ? process.env.XAI_API_KEY : apiKey,
    baseURL
  });

  const start = performance.now();

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      tools: TOOLS_OPENAI,
      tool_choice: "auto",
    });

    const toolCallLatencyMs = performance.now() - start;
    const toolCalls: ToolCallResult[] = response.choices[0]?.message?.tool_calls?.map((tc) => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}"),
    })) || [];

    // Render animate tool -> generate p5.js code
    let renderLatencyMs = 0;
    for (const tc of toolCalls) {
      if (tc.name === "animate" && tc.args.prompt) {
        const { code, latencyMs } = await generateP5Code(
          tc.args.prompt as string,
          config.provider,
          config.provider === "xai" ? process.env.XAI_API_KEY! : apiKey
        );
        renderLatencyMs += latencyMs;
        tc.rendered = { type: "p5js", content: code };
      }
    }

    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      toolCallLatencyMs,
      renderLatencyMs,
      totalLatencyMs: toolCallLatencyMs + renderLatencyMs,
      toolCalls,
    };
  } catch (error) {
    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      toolCallLatencyMs: performance.now() - start,
      renderLatencyMs: 0,
      totalLatencyMs: performance.now() - start,
      toolCalls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function benchmarkGemini(
  config: ModelConfig,
  prompt: string,
  apiKey: string
): Promise<BenchmarkResult> {
  const client = new GoogleGenAI({ apiKey });

  // Only animate tool for p5.js benchmark
  const tools = [
    {
      functionDeclarations: [
        {
          name: "animate",
          description: "Create a p5.js animation. ALWAYS use this tool to render the user's request as an interactive animation.",
          parameters: {
            type: "object" as const,
            properties: {
              prompt: { type: "string" as const, description: "Detailed description of the animation to create" },
            },
            required: ["prompt"],
          },
        },
      ],
    },
  ];

  const start = performance.now();

  try {
    const response = await client.models.generateContent({
      model: config.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const toolCallLatencyMs = performance.now() - start;
    const toolCalls: ToolCallResult[] = [];

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if ("functionCall" in part && part.functionCall) {
          toolCalls.push({
            name: part.functionCall.name || "",
            args: (part.functionCall.args as Record<string, unknown>) || {},
          });
        }
      }
    }

    // Render animate tool -> generate p5.js code
    let renderLatencyMs = 0;
    for (const tc of toolCalls) {
      if (tc.name === "animate" && tc.args.prompt) {
        const { code, latencyMs } = await generateP5Code(
          tc.args.prompt as string,
          "gemini",
          apiKey
        );
        renderLatencyMs += latencyMs;
        tc.rendered = { type: "p5js", content: code };
      }
    }

    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      toolCallLatencyMs,
      renderLatencyMs,
      totalLatencyMs: toolCallLatencyMs + renderLatencyMs,
      toolCalls,
    };
  } catch (error) {
    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      toolCallLatencyMs: performance.now() - start,
      renderLatencyMs: 0,
      totalLatencyMs: performance.now() - start,
      toolCalls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// API ROUTE
// =============================================================================

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { models, prompt } = body as {
    models?: string[];
    prompt: string;
  };

  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const geminiKey = process.env.GOOGLE_API_KEY;

  if (!openaiKey && !xaiKey && !geminiKey) {
    return NextResponse.json({ error: "No API keys configured" }, { status: 500 });
  }

  // Filter models based on request or use all
  const modelsToTest = models
    ? MODELS.filter((m) => models.includes(m.id))
    : MODELS;

  // Run all models in PARALLEL for fair comparison
  const promises = modelsToTest
    .filter((modelConfig) => {
      if (modelConfig.provider === "openai" && !openaiKey) return false;
      if (modelConfig.provider === "xai" && !xaiKey) return false;
      if (modelConfig.provider === "gemini" && !geminiKey) return false;
      return true;
    })
    .map((modelConfig) => {
      if (modelConfig.provider === "openai") {
        return benchmarkOpenAI(modelConfig, prompt, openaiKey!);
      } else if (modelConfig.provider === "xai") {
        return benchmarkOpenAI(modelConfig, prompt, xaiKey!);
      } else {
        return benchmarkGemini(modelConfig, prompt, geminiKey!);
      }
    });

  const results = await Promise.all(promises);

  // Sort by total latency
  results.sort((a, b) => a.totalLatencyMs - b.totalLatencyMs);

  return NextResponse.json({ results });
}

export async function GET() {
  return NextResponse.json({
    models: MODELS,
    examplePrompts: [
      "animate a ball bouncing",
      "draw the water cycle",
      "graph sin(x)",
      "explain photosynthesis with a diagram",
    ],
  });
}
