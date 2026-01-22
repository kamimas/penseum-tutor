"""
Phase 2: Test tool calling with Gemini 2.5 Flash Native Audio
Goal: Verify if @function_tool works with this model

Run: python tool_test.py dev
Test: Ask the agent to "write hello world on the board"
"""

import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    RoomInputOptions,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.plugins import google

# Logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("tool_test")

# Load .env from parent directory
load_dotenv(Path(__file__).parent.parent / ".env")

LOG_FILE = Path(__file__).parent / "tool_calls.log"

SYSTEM_PROMPT = """
You are a test assistant with vision and a whiteboard.
You can see the user's screen and you can write text on a whiteboard using the add_text tool.

When the user asks you to write something, use the add_text tool.
Keep responses conversational.
"""


class ToolTestAgent(Agent):
    """Agent with a single tool to test function calling"""
    def __init__(self):
        super().__init__(instructions=SYSTEM_PROMPT)

    @function_tool
    async def add_text(self, ctx: RunContext, content: str, size: str = "medium") -> str:
        """Write text on the whiteboard.

        Args:
            content: Text to display
            size: 'large' for titles, 'medium' for normal text, 'small' for annotations
        """
        # Log the tool call
        with open(LOG_FILE, "a") as f:
            f.write(f"[TOOL CALLED] add_text: content='{content}', size='{size}'\n")

        logger.info(f"[TOOL CALLED] add_text: content='{content}', size='{size}'")

        # Send to frontend via data channel
        payload = json.dumps({
            "tool": "add_text",
            "params": {"content": content, "size": size}
        })

        await ctx.session.room.local_participant.publish_data(
            payload.encode(), reliable=True, topic="tutor_draw"
        )

        return f"Successfully wrote: '{content}'"


async def entrypoint(ctx: JobContext):
    logger.info("=== TOOL TEST STARTING ===")

    with open(LOG_FILE, "a") as f:
        f.write("\n=== NEW TOOL TEST SESSION ===\n")

    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
    logger.info(f"Connected to room: {ctx.room.name}")

    # Configure Gemini 2.5 with native audio
    model = google.realtime.RealtimeModel(
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        modalities=["AUDIO"],
        instructions=SYSTEM_PROMPT,
    )

    session = AgentSession(llm=model)

    await session.start(
        agent=ToolTestAgent(),
        room=ctx.room,
        room_input_options=RoomInputOptions(video_enabled=True),
    )

    logger.info("=== TOOL TEST READY - Try saying 'write hello world on the board' ===")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
