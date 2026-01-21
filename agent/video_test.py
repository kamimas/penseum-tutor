"""
Phase 1: Video + Audio test (no tools)
Goal: Verify Gemini can receive and process video input

Run: python video_test.py dev
Test: Share screen or enable camera, ask "what do you see?"
"""

import logging
from pathlib import Path
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    RoomInputOptions,
    WorkerOptions,
    cli,
)
from livekit.plugins import google

# Logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("video_test")

# Load .env from parent directory
load_dotenv(Path(__file__).parent.parent / ".env")

SYSTEM_PROMPT = """
You are a vision test assistant. You can see the user's screen or camera.
When asked, describe what you see in detail.
Keep responses short and conversational.
"""


class SimpleVisionAgent(Agent):
    """Minimal agent with no tools - just audio + video"""
    def __init__(self):
        super().__init__(instructions=SYSTEM_PROMPT)


async def entrypoint(ctx: JobContext):
    logger.info("=== VIDEO TEST STARTING ===")

    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
    logger.info(f"Connected to room: {ctx.room.name}")

    model = google.realtime.RealtimeModel(
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        modalities=["AUDIO"],
        instructions=SYSTEM_PROMPT,
    )

    session = AgentSession(llm=model)

    await session.start(
        agent=SimpleVisionAgent(),
        room=ctx.room,
        room_input_options=RoomInputOptions(video_enabled=True),
    )

    logger.info("=== VIDEO TEST READY - Try asking 'what do you see?' ===")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
