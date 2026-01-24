/**
 * Tool Latency Benchmark API
 *
 * Tests tool calling latency across OpenAI, xAI, and Gemini models.
 * Returns timing data for comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

// =============================================================================
// TOOL DEFINITIONS (same schema for all providers)
// =============================================================================

const TOOLS_OPENAI: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_text",
      description: "Write text on the whiteboard. Use for titles, equations, definitions.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Text to display" },
          size: { type: "string", enum: ["small", "medium", "large"] },
          position: { type: "string" },
          emoji: { type: "string" },
          accent: { type: "string", enum: ["none", "purple", "green", "blue", "red", "orange"] },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_image",
      description: "Search and display an image.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for the image" },
          position: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draw_diagram",
      description: "Draw a diagram (flowchart, mindmap, cycle, timeline).",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["flowchart", "mindmap", "cycle", "timeline"] },
          nodes: { type: "array", items: { type: "string" } },
          direction: { type: "string", enum: ["TB", "LR"] },
          position: { type: "string" },
        },
        required: ["type", "nodes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draw_function",
      description: "Draw a math function graph like sin(x), x^2.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression using x" },
          xMin: { type: "number" },
          xMax: { type: "number" },
          position: { type: "string" },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "animate",
      description: "Create a p5.js animation for physics simulations, motion, particles.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description of the animation" },
          position: { type: "string" },
        },
        required: ["prompt"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are a Visual Rendering Agent for educational content.
Your ONLY job is to convert the user's natural language into tool calls to render a visual.

AVAILABLE TOOLS
- add_text (FAST) - text, titles, equations
- draw_diagram (FAST) - flowchart, cycle, timeline, mindmap
- draw_function (FAST) - math graphs like sin(x), x^2
- animate (SLOW ~3-5s) - physics simulations, motion, particles, dynamic visualizations
- show_image (MEDIUM ~1-2s) - photos, diagrams from web

RULES
1. Always call add_text first with a short title (<10 words)
2. Then call exactly ONE visual tool (position="below-last")
3. Max 2 tool calls total
4. If request is unclear, make a best-guess render (do NOT ask questions)

TOOL SELECTION LOGIC
A) If user asks for animation/motion/physics/simulation/particles/dynamic movement → animate
B) If user asks for graph/plot/function/y=/f(x)= → draw_function
C) If request is a process with steps (cycle, timeline, flowchart, categories) → draw_diagram
D) Else → show_image (static labeled diagram/photo-style)`;

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
// TEST PROMPTS
// =============================================================================

const TEST_PROMPTS = [
  "draw a diagram of photosynthesis",
  "graph sin(x)",
  "show me the solar system",
  "animate a ball bouncing",
  "draw the water cycle",
];

// =============================================================================
// BENCHMARK FUNCTIONS
// =============================================================================

interface BenchmarkResult {
  modelId: string;
  modelLabel: string;
  provider: string;
  prompt: string;
  latencyMs: number;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  error?: string;
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

    const latencyMs = performance.now() - start;
    const toolCalls = response.choices[0]?.message?.tool_calls?.map((tc) => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}"),
    })) || [];

    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      latencyMs,
      toolCalls,
    };
  } catch (error) {
    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      latencyMs: performance.now() - start,
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

  const tools = [
    {
      functionDeclarations: [
        {
          name: "add_text",
          description: "Write text on the whiteboard.",
          parameters: {
            type: "object" as const,
            properties: {
              content: { type: "string" as const },
              size: { type: "string" as const, enum: ["small", "medium", "large"] },
              position: { type: "string" as const },
              emoji: { type: "string" as const },
              accent: { type: "string" as const },
            },
            required: ["content"],
          },
        },
        {
          name: "show_image",
          description: "Search and display an image.",
          parameters: {
            type: "object" as const,
            properties: {
              query: { type: "string" as const },
              position: { type: "string" as const },
            },
            required: ["query"],
          },
        },
        {
          name: "draw_diagram",
          description: "Draw a diagram.",
          parameters: {
            type: "object" as const,
            properties: {
              type: { type: "string" as const, enum: ["flowchart", "mindmap", "cycle", "timeline"] },
              nodes: { type: "array" as const, items: { type: "string" as const } },
              direction: { type: "string" as const },
              position: { type: "string" as const },
            },
            required: ["type", "nodes"],
          },
        },
        {
          name: "draw_function",
          description: "Draw a math graph.",
          parameters: {
            type: "object" as const,
            properties: {
              expression: { type: "string" as const },
              xMin: { type: "number" as const },
              xMax: { type: "number" as const },
              position: { type: "string" as const },
            },
            required: ["expression"],
          },
        },
        {
          name: "animate",
          description: "Create a p5.js animation.",
          parameters: {
            type: "object" as const,
            properties: {
              prompt: { type: "string" as const },
              position: { type: "string" as const },
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
        // Match draw_subagent.py: MINIMAL thinking
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const latencyMs = performance.now() - start;
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];

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

    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      latencyMs,
      toolCalls,
    };
  } catch (error) {
    return {
      modelId: config.id,
      modelLabel: config.label,
      provider: config.provider,
      prompt,
      latencyMs: performance.now() - start,
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
  const { models, prompts } = body as {
    models?: string[];
    prompts?: string[];
  };

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

  // Filter prompts or use defaults
  const promptsToTest = prompts && prompts.length > 0 ? prompts : TEST_PROMPTS;

  const results: BenchmarkResult[] = [];

  for (const modelConfig of modelsToTest) {
    // Skip if no API key for this provider
    if (modelConfig.provider === "openai" && !openaiKey) continue;
    if (modelConfig.provider === "xai" && !xaiKey) continue;
    if (modelConfig.provider === "gemini" && !geminiKey) continue;

    for (const prompt of promptsToTest) {
      let result: BenchmarkResult;

      if (modelConfig.provider === "openai") {
        result = await benchmarkOpenAI(modelConfig, prompt, openaiKey!);
      } else if (modelConfig.provider === "xai") {
        result = await benchmarkOpenAI(modelConfig, prompt, xaiKey!);
      } else {
        result = await benchmarkGemini(modelConfig, prompt, geminiKey!);
      }

      results.push(result);
    }
  }

  // Calculate summary stats
  const summary = modelsToTest.map((m) => {
    const modelResults = results.filter((r) => r.modelId === m.id && !r.error);
    const avgLatency = modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.latencyMs, 0) / modelResults.length
      : 0;
    const successRate = results.filter((r) => r.modelId === m.id).length > 0
      ? (modelResults.length / results.filter((r) => r.modelId === m.id).length) * 100
      : 0;

    return {
      modelId: m.id,
      modelLabel: m.label,
      provider: m.provider,
      avgLatencyMs: Math.round(avgLatency),
      successRate: Math.round(successRate),
      totalTests: results.filter((r) => r.modelId === m.id).length,
    };
  }).sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);

  return NextResponse.json({ results, summary });
}

export async function GET() {
  return NextResponse.json({
    models: MODELS,
    defaultPrompts: TEST_PROMPTS,
  });
}
