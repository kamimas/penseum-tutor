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
from livekit.plugins import openai
from openai.types import realtime as openai_realtime

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tutor")
logger.setLevel(logging.DEBUG)

# Load .env from parent directory
load_dotenv(Path(__file__).parent.parent / ".env")

# Load prompts from files
PROMPT_GUIDED_FILE = Path(__file__).parent / "prompt_guided.txt"
PROMPT_NORMAL_FILE = Path(__file__).parent / "prompt_normal.txt"

PROMPT_GUIDED = PROMPT_GUIDED_FILE.read_text() if PROMPT_GUIDED_FILE.exists() else """
You are a tutor teaching a structured lesson. Speak English only.
"""

PROMPT_NORMAL = PROMPT_NORMAL_FILE.read_text() if PROMPT_NORMAL_FILE.exists() else """
You are a tutor. Ask the student what they want to learn. Speak English only.
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
_session: AgentSession | None = None
_current_concept_index = 0
_lesson_complete = False
_tutor_mode = "normal"  # "guided" or "normal"


def detect_mode_from_room_name(room_name: str) -> str:
    """
    Detect tutor mode from room name.
    Room name format: penseum-{mode}-{timestamp}
    Examples: penseum-guided-1234567890, penseum-normal-1234567890
    """
    if "-guided-" in room_name:
        return "guided"
    elif "-normal-" in room_name:
        return "normal"
    else:
        # Default to guided if lesson.json exists, otherwise normal
        if LESSON_DATA:
            return "guided"
        return "normal"


async def _publish_tool_call(tool: str, params: dict):
    """Actually publish the tool call (async)."""
    if _room is None:
        logger.error("[TOOL ERROR] _room is None - cannot publish!")
        return

    payload = json.dumps({"tool": tool, "params": params})
    try:
        await _room.local_participant.publish_data(
            payload.encode(), reliable=True, topic="tutor_draw"
        )
        logger.info(f"[TOOL PUBLISHED] {tool} -> tutor_draw topic")
    except Exception as e:
        logger.error(f"[TOOL ERROR] Failed to publish {tool}: {e}")


def _send_tool_call(tool: str, params: dict):
    """Send a tool call to the frontend via LiveKit data channel."""
    with open(LOG_FILE, "a") as f:
        f.write(f"[TOOL] {tool}: {params}\n")

    logger.info(f"[TOOL] {tool}: {params}")

    if _room is None:
        logger.error("[TOOL ERROR] _room is None - cannot publish!")
        return

    # Schedule the async publish
    asyncio.create_task(_publish_tool_call(tool, params))


# ============================================
# POSITION VALUES (for tool parameters)
# ============================================
# Screen regions (3x3 grid):
#   top-left,    top-center,    top-right
#   middle-left, center,        middle-right
#   bottom-left, bottom-center, bottom-right
#
# Relative positions:
#   below-last   - below the last element added
#   right-of-last - right of the last element added

VALID_POSITIONS = [
    "top-left", "top-center", "top-right",
    "middle-left", "center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
    "below-last", "right-of-last"
]

# ============================================
# TOOLS
# ============================================

@function_tool()
async def add_text(context: RunContext, content: str, size: str = "medium", position: str = "center") -> str:
    """
    Write text on the whiteboard. USE THIS for titles, equations, definitions, key points.

    Args:
        content: Text to display (supports math notation)
        size: "large" for titles, "medium" for content (default), "small" for notes
        position: "center" (default for first item), "below-last", or "right-of-last"
    """
    _send_tool_call("add_text", {"content": content, "size": size, "position": position})
    return "Text added. Briefly explain it, then add your next visual."


@function_tool()
async def show_image(context: RunContext, query: str, position: str = "center") -> str:
    """
    Search and display an image. USE THIS for diagrams, photos, illustrations that help explain concepts.

    Args:
        query: Specific search query (e.g., "mitochondria cell diagram", "world war 2 map europe")
        position: "center" (default for first item), "below-last", or "right-of-last"
    """
    _send_tool_call("show_image", {"query": query, "position": position})
    return "Image added. Briefly explain what it shows, then continue teaching."


@function_tool()
async def clear_board(context: RunContext) -> str:
    """Clear the whiteboard. USE THIS when switching to a new topic or when the board is cluttered."""
    _send_tool_call("clear_board", {})
    return "Board cleared. Start fresh with your next visual."


@function_tool()
async def draw_diagram(
    context: RunContext,
    type: str,
    nodes: list[str],
    edges: list[list] | None = None,
    direction: str = "TB",
    position: str = "center"
) -> str:
    """
    Draw a diagram. USE THIS for processes, relationships, hierarchies, timelines.

    Args:
        type: "flowchart", "mindmap", "cycle", or "timeline"
        nodes: List of step/concept labels. Just provide the labels - connections are automatic.
        edges: Optional. Omit for linear flow (0→1→2→3). Or specify: [[0,1], [1,2,"label"]]
        direction: "TB" (top-to-bottom, default), "LR" (left-to-right)
        position: "center" (default for first item), "below-last", or "right-of-last"
    """
    _send_tool_call("draw_diagram", {
        "type": type,
        "nodes": nodes,
        "edges": edges,
        "direction": direction,
        "position": position
    })
    return "Diagram added. Walk through it with the student, then continue teaching."


@function_tool()
async def next_concept(context: RunContext) -> str:
    """
    REQUIRED: Call this after completing all tool calls in the current concept's instructions.
    This advances to the next concept. You must call this to progress through the lesson.
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

    return f"Next concept ({_current_concept_index + 1}/{len(concepts)}): {next_concept_data['instructions']}"


@function_tool()
async def finish_lesson(context: RunContext) -> str:
    """Call this when you have finished teaching ALL concepts."""
    global _lesson_complete
    _lesson_complete = True
    logger.info("=== LESSON MARKED COMPLETE ===")
    return "Lesson complete! You can now answer any questions the student has."


# ============================================
# DATA CHANNEL HANDLERS
# ============================================

async def handle_control_message(data: bytes):
    """Handle control messages from frontend (e.g., speed changes)."""
    global _session

    try:
        message = json.loads(data.decode())
        msg_type = message.get("type")

        if msg_type == "set_speed":
            speed = message.get("speed", 1.0)
            logger.info(f"[CONTROL] Setting speed to {speed}x")

            if _session and _session.llm:
                # Update the RealtimeModel speed
                _session.llm.update_options(speed=speed)
                logger.info(f"[CONTROL] Speed updated successfully to {speed}x")
            else:
                logger.warning("[CONTROL] Cannot update speed - session or llm not available")
        else:
            logger.warning(f"[CONTROL] Unknown message type: {msg_type}")

    except json.JSONDecodeError as e:
        logger.error(f"[CONTROL] Failed to parse message: {e}")
    except Exception as e:
        logger.error(f"[CONTROL] Error handling message: {e}")


# ============================================
# ENTRYPOINT
# ============================================

async def entrypoint(ctx: JobContext):
    global _room, _session, _current_concept_index, _lesson_complete, _tutor_mode

    # Reset state for new session
    _current_concept_index = 0
    _lesson_complete = False

    with open(LOG_FILE, "a") as f:
        f.write("\n=== NEW SESSION ===\n")
    logger.info("=== TUTOR AGENT STARTING ===")

    await ctx.connect()
    _room = ctx.room

    # Detect mode from room name
    _tutor_mode = detect_mode_from_room_name(ctx.room.name)
    logger.info(f"=== DETECTED MODE: {_tutor_mode.upper()} ===")
    logger.info(f"=== ROOM NAME: {ctx.room.name} ===")

    with open(LOG_FILE, "a") as f:
        f.write(f"MODE: {_tutor_mode}\n")
        f.write(f"ROOM: {ctx.room.name}\n")

    # Register data channel handler for control messages
    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        if data.topic == "tutor_control":
            asyncio.create_task(handle_control_message(data.data))

    logger.info(f"=== CONNECTED TO ROOM: {ctx.room.name} ===")

    # Select prompt and tools based on mode
    if _tutor_mode == "guided":
        system_prompt = PROMPT_GUIDED
        tools = [add_text, show_image, draw_diagram, next_concept, finish_lesson]
        logger.info("=== USING GUIDED TOOLS (with next_concept, finish_lesson) ===")
    else:
        system_prompt = PROMPT_NORMAL
        tools = [add_text, show_image, clear_board, draw_diagram]
        logger.info("=== USING NORMAL TOOLS (no lesson progression) ===")

    agent = Agent(
        instructions=system_prompt,
        tools=tools,
    )

    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            model="gpt-realtime",
            voice="ash",
            input_audio_transcription=openai_realtime.AudioTranscription(
                model="gpt-4o-transcribe",
            ),
        ),
        allow_interruptions=True,
    )
    _session = session  # Store globally for speed control

    logger.info("=== STARTING SESSION ===")
    logger.info("=== VIDEO INPUT ENABLED ===")
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(video_enabled=True),
    )

    # Log video input status
    logger.info(f"=== SESSION INPUT VIDEO: {session.input.video} ===")
    if session.input.video:
        logger.info("=== VIDEO INPUT IS ACTIVE ===")
    else:
        logger.info("=== WARNING: VIDEO INPUT IS NONE ===")

    # Start based on mode
    if _tutor_mode == "guided" and LESSON_DATA and LESSON_DATA.get("concepts"):
        # Guided mode: start teaching the lesson
        first_concept = LESSON_DATA["concepts"][0]
        logger.info(f"=== STARTING LESSON: {LESSON_DATA.get('title', 'Untitled')} ===")
        logger.info(f"=== FIRST CONCEPT: {first_concept['name']} ===")

        # Give the model the first concept's instructions (simpler trigger like main branch)
        trigger = f"Begin teaching. First concept (1/{len(LESSON_DATA['concepts'])}): {first_concept['instructions']}"
        await session.generate_reply(instructions=trigger)
    else:
        # Normal mode: ask what the student wants to learn
        # NOTE: We use generate_reply instead of say() because RealtimeModel has built-in TTS
        # say() requires a separate TTS model which we don't have
        logger.info("=== NORMAL MODE: Asking student what to learn ===")
        await session.generate_reply(
            instructions="Greet the student warmly and ask what topic they would like to learn today. Keep it brief and friendly."
        )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
