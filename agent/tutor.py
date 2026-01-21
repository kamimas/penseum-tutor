import asyncio
import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from livekit import rtc
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

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tutor")
logger.setLevel(logging.DEBUG)

# Load .env from parent directory
load_dotenv(Path(__file__).parent.parent / ".env")

# Load prompt from file
PROMPT_FILE = Path(__file__).parent / "prompt.txt"
SYSTEM_PROMPT = PROMPT_FILE.read_text() if PROMPT_FILE.exists() else """
You are a tutor. Speak English only.
"""

# Load lesson from JSON
LESSON_FILE = Path(__file__).parent / "lesson.json"
LESSON_DATA = None
if LESSON_FILE.exists():
    try:
        LESSON_DATA = json.loads(LESSON_FILE.read_text())
    except json.JSONDecodeError:
        logger.error("Failed to parse lesson.json")

LOG_FILE = Path(__file__).parent / "tool_calls.log"

# Global state
_room: rtc.Room | None = None
_current_concept_index = 0
_lesson_complete = False


def _send_tool_call(tool: str, params: dict):
    """Send a tool call to the frontend via LiveKit data channel."""
    with open(LOG_FILE, "a") as f:
        f.write(f"[TOOL] {tool}: {params}\n")

    logger.info(f"[TOOL] {tool}: {params}")

    if _room is None:
        logger.error("[TOOL ERROR] _room is None - cannot publish!")
        return

    payload = json.dumps({"tool": tool, "params": params})
    asyncio.create_task(
        _room.local_participant.publish_data(
            payload.encode(), reliable=True, topic="tutor_draw"
        )
    )


# ============================================
# TOOLS
# ============================================

@function_tool()
async def add_text(context: RunContext, content: str, size: str = "medium") -> str:
    """
    Write text on the whiteboard.

    Args:
        content: Text to display
        size: 'large' for titles, 'medium' for explanations (default), 'small' for annotations
    """
    _send_tool_call("add_text", {"content": content, "size": size})
    return f"Added text: '{content}'"


@function_tool()
async def show_image(context: RunContext, query: str) -> str:
    """
    Search and display an image on the whiteboard.

    Args:
        query: Specific search query for the image
    """
    _send_tool_call("show_image", {"query": query})
    return f"Showing image for: {query}"


@function_tool()
async def draw_table(context: RunContext, headers: list[str], rows: list[list[str]]) -> str:
    """
    Draw a comparison table on the whiteboard.

    Args:
        headers: Column headers
        rows: Table rows, each row is a list of cells
    """
    _send_tool_call("draw_table", {"headers": headers, "rows": rows})
    return f"Drew table with {len(headers)} columns and {len(rows)} rows"


@function_tool()
async def draw_flowchart(context: RunContext, steps: list[str]) -> str:
    """
    Draw a flowchart showing a process or sequence.

    Args:
        steps: List of steps in order
    """
    _send_tool_call("draw_flowchart", {"steps": steps})
    return f"Drew flowchart with {len(steps)} steps"


@function_tool()
async def plot_function(context: RunContext, equation: str) -> str:
    """
    Plot a mathematical function on the whiteboard.

    Args:
        equation: The function to plot. MUST use 'x' as the variable (e.g., "x^2", "sin(x)", "2*x + 1").
                  Use multiplication symbol: "2*x" not "2x".
    """
    _send_tool_call("plot_function", {"equation": equation})
    return f"Plotted function: {equation}"


@function_tool()
async def clear_board(context: RunContext) -> str:
    """Clear all content from the whiteboard."""
    _send_tool_call("clear_board", {})
    return "Board cleared"


@function_tool()
async def next_concept(context: RunContext) -> str:
    """
    Call this when you have finished teaching the current concept.
    Returns the next concept's instructions.
    """
    global _current_concept_index

    with open(LOG_FILE, "a") as f:
        f.write(f"[TOOL] next_concept called (current index: {_current_concept_index})\n")

    if LESSON_DATA is None:
        return "No lesson loaded."

    concepts = LESSON_DATA.get("concepts", [])

    _current_concept_index += 1

    if _current_concept_index >= len(concepts):
        return "[INTERNAL: All concepts complete.] You have finished all concepts. Call finish_lesson() to wrap up and take questions."

    next_concept_data = concepts[_current_concept_index]
    logger.info(f"=== ADVANCING TO CONCEPT {_current_concept_index + 1}: {next_concept_data['name']} ===")

    return f"""[INTERNAL: Concept transition successful. Do not announce this transition to the student.]

CURRENT CONCEPT ({_current_concept_index + 1}/{len(concepts)}): {next_concept_data['name']}

{next_concept_data['instructions']}

[Continue teaching naturally following the instructions above.]"""


@function_tool()
async def finish_lesson(context: RunContext) -> str:
    """Call this when you have finished teaching ALL concepts."""
    global _lesson_complete
    _lesson_complete = True
    logger.info("=== LESSON MARKED COMPLETE ===")
    return "Lesson complete! You can now answer any questions the student has."


# ============================================
# ENTRYPOINT
# ============================================

async def entrypoint(ctx: JobContext):
    global _room, _current_concept_index, _lesson_complete

    # Reset state for new session
    _current_concept_index = 0
    _lesson_complete = False

    with open(LOG_FILE, "a") as f:
        f.write("\n=== NEW SESSION ===\n")
    logger.info("=== TUTOR AGENT STARTING ===")

    await ctx.connect()
    _room = ctx.room

    logger.info(f"=== CONNECTED TO ROOM: {ctx.room.name} ===")

    agent = Agent(
        instructions=SYSTEM_PROMPT,
        tools=[add_text, show_image, draw_table, draw_flowchart, plot_function, clear_board, next_concept, finish_lesson],
    )

    session = AgentSession(
        llm=google.realtime.RealtimeModel(
            voice="Puck",
        ),
        allow_interruptions=True,
    )

    logger.info("=== STARTING SESSION ===")
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(video_enabled=True),
    )

    # Start the lesson if we have lesson data
    if LESSON_DATA and LESSON_DATA.get("concepts"):
        first_concept = LESSON_DATA["concepts"][0]
        logger.info(f"=== STARTING LESSON: {LESSON_DATA.get('title', 'Untitled')} ===")
        logger.info(f"=== FIRST CONCEPT: {first_concept['name']} ===")

        # Give the model the first concept's instructions
        trigger = f"Begin teaching. First concept (1/{len(LESSON_DATA['concepts'])}): {first_concept['instructions']}"
        await session.generate_reply(instructions=trigger)
    else:
        await session.say("Hi! What topic would you like to learn today?", allow_interruptions=True)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
