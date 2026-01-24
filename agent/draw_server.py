"""
FastAPI server for draw and p5 subagents.
Keeps Python process alive to avoid cold start latency.

Run with: uvicorn draw_server:app --host 0.0.0.0 --port 5001
Or for dev: uvicorn draw_server:app --reload --port 5001
"""

import asyncio
import json
import logging
import os
import time
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Load .env file
from dotenv import load_dotenv
load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# Import subagents (loaded once at startup)
from draw_subagent import call_subagent as call_draw_subagent
from act_subagent import interpret_intent as call_act_subagent
from p5js.p5_subagent import generate_p5_animation

app = FastAPI(title="Draw Subagent Server")


class DrawRequest(BaseModel):
    query: str


class ActRequest(BaseModel):
    intent: str


class P5Request(BaseModel):
    prompt: str


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


@app.post("/draw")
async def draw(request: DrawRequest):
    """
    Process a draw query and return tool calls.
    Replaces the spawn-per-request pattern.
    """
    if not request.query:
        raise HTTPException(status_code=400, detail="Missing query")

    logger.info(f"📥 DRAW: {request.query}")
    start = time.time()

    try:
        # Run in thread pool to not block async loop
        result = await asyncio.to_thread(call_draw_subagent, request.query)
        elapsed = time.time() - start

        # Log each tool call
        for tc in result:
            logger.info(f"  → {tc['tool']}({json.dumps(tc['params'], ensure_ascii=False)[:100]})")
        logger.info(f"  ✓ {len(result)} tools in {elapsed:.2f}s")

        return {"toolCalls": result}
    except Exception as e:
        logger.error(f"  ✗ Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/act")
async def act(request: ActRequest):
    """
    Process an act intent and return tool calls with timing breakdown.
    The act subagent interprets natural language intents into specific tool calls.
    """
    if not request.intent:
        raise HTTPException(status_code=400, detail="Missing intent")

    logger.info(f"📥 ACT: {request.intent}")
    server_start = time.time()

    try:
        # Run in thread pool to not block async loop
        result = await asyncio.to_thread(call_act_subagent, request.intent)
        server_elapsed = (time.time() - server_start) * 1000

        # Extract tool calls and timing from new format
        tool_calls = result.get("tool_calls", [])
        subagent_timing = result.get("timing", {})

        # Log each tool call
        for tc in tool_calls:
            logger.info(f"  → {tc['tool']}({json.dumps(tc['params'], ensure_ascii=False)[:100]})")

        model_ms = subagent_timing.get("model_ms", 0)
        logger.info(f"  ✓ {len(tool_calls)} tools | model: {model_ms:.0f}ms | server: {server_elapsed:.0f}ms")

        return {
            "toolCalls": tool_calls,
            "timing": {
                "model_ms": model_ms,
                "subagent_ms": subagent_timing.get("total_ms", 0),
                "server_ms": round(server_elapsed, 1)
            }
        }
    except Exception as e:
        logger.error(f"  ✗ Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/p5")
async def p5(request: P5Request):
    """
    Generate p5.js animation code.
    Replaces the spawn-per-request pattern.
    """
    if not request.prompt:
        raise HTTPException(status_code=400, detail="Missing prompt")

    logger.info(f"📥 P5: {request.prompt}")
    start = time.time()

    try:
        # Run in thread pool to not block async loop
        result = await asyncio.to_thread(generate_p5_animation, request.prompt)
        elapsed = time.time() - start
        logger.info(f"  ✓ Generated p5.js code in {elapsed:.2f}s")
        return result
    except Exception as e:
        logger.error(f"  ✗ Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DRAW_SERVER_PORT", 5001))
    print(f"Starting draw server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
