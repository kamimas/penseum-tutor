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

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# Import subagents (loaded once at startup)
from draw_subagent import call_subagent as call_draw_subagent
from p5js.p5_subagent import generate_p5_animation

app = FastAPI(title="Draw Subagent Server")


class DrawRequest(BaseModel):
    query: str


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
