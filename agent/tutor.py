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
# === MODEL SELECTION ===
# Uncomment ONE of the following import blocks:

# --- GEMINI (has video) ---
from livekit.plugins import google
from google.genai import types

# --- XAI (no video) ---
# from livekit.plugins import xai

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tutor")
logger.setLevel(logging.DEBUG)

# Load .env from parent directory
load_dotenv(Path(__file__).parent.parent / ".env")

# Load prompts from files
PROMPT_GUIDED_FILE = Path(__file__).parent / "prompt_guided.txt"
# Using Gemini prompt for now (works with xAI too, just remove vision references if needed)
PROMPT_NORMAL_FILE = Path(__file__).parent / "prompt_normal_gemini.txt"

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
async def draw(context: RunContext, query: str) -> str:
    """
    Draw visuals on the whiteboard. USE THIS for any visual content: text, images, diagrams.
    Also use this to annotate/circle/highlight things on the whiteboard.

    A specialized sub-agent will decide the best way to visualize your request.

    Args:
        query: Natural language description of what to show (e.g., "show the water cycle",
               "display the pythagorean theorem", "draw a neuron diagram",
               "circle the mitochondria", "highlight the equation")
    """
    logger.info(f"[DRAW TOOL] Sending draw_query to frontend: {query}")

    # Send query to frontend - frontend will handle screenshot + API call + render
    # This matches the R&D flow exactly (test-draw page)
    _send_tool_call("draw_query", {"query": query})

    # NOTE: For xAI/OpenAI, the framework auto-triggers generate_reply() after tool completion.
    # Keep return value minimal to avoid prompting the model to over-explain.
    return "Done."


@function_tool()
async def clear_board(context: RunContext) -> str:
    """Clear the whiteboard. USE THIS when switching to a new topic or when the board is cluttered."""
    _send_tool_call("clear_board", {})
    return "Done."


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
            logger.info(f"[CONTROL] Speed control requested: {speed}x")
            # NOTE: Gemini does not support speed control, only OpenAI/xAI does
            # logger.warning("[CONTROL] Speed control not supported with Gemini model")
            logger.info("[CONTROL] Speed control supported with xAI model")
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

    # Register data channel handlers
    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        if data.topic == "tutor_control":
            asyncio.create_task(handle_control_message(data.data))

    logger.info(f"=== CONNECTED TO ROOM: {ctx.room.name} ===")

    # Select prompt and tools based on mode
    if _tutor_mode == "guided":
        system_prompt = PROMPT_GUIDED
        tools = [draw, clear_board, next_concept, finish_lesson]
        logger.info("=== USING GUIDED TOOLS (with next_concept, finish_lesson) ===")
    else:
        system_prompt = PROMPT_NORMAL
        tools = [draw, clear_board]
        logger.info("=== USING NORMAL TOOLS (no lesson progression) ===")

    agent = Agent(
        instructions=system_prompt,
        tools=tools,
    )

    # === MODEL SELECTION ===
    # Uncomment ONE of the following session blocks:

    # --- GEMINI (has video) ---
    session = AgentSession(
        llm=google.realtime.RealtimeModel(
            model="gemini-2.5-flash-native-audio-preview-09-2025",
            voice="Charon",
            input_audio_transcription=types.AudioTranscriptionConfig(),
            tool_behavior=types.Behavior.NON_BLOCKING,  # Continue speaking while tools execute
            tool_response_scheduling=types.FunctionResponseScheduling.WHEN_IDLE,  # Respond to tool result when done speaking
        ),
        allow_interruptions=True,
    )

    # --- XAI (no video) ---
    # session = AgentSession(
    #     llm=xai.realtime.RealtimeModel(
    #         voice="Ara",  # Options: Ara, Eve, Leo, Rex, Sal
    #         # model is hardcoded to grok-4-1-fast-non-reasoning
    #     ),
    #     allow_interruptions=True,
    # )

    _session = session  # Store globally for speed control

    logger.info("=== STARTING SESSION ===")

    # === MODEL SELECTION ===
    # Uncomment ONE of the following start blocks:

    # --- GEMINI (has video) ---
    logger.info("=== VIDEO INPUT ENABLED ===")
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(video_enabled=True),
    )

    # --- XAI (no video) ---
    # logger.info("=== XAI MODE - NO VIDEO ===")
    # await session.start(
    #     agent=agent,
    #     room=ctx.room,
    # )

    # Log video input status (only relevant for Gemini)
    # logger.info(f"=== SESSION INPUT VIDEO: {session.input.video} ===")
    # if session.input.video:
    #     logger.info("=== VIDEO INPUT IS ACTIVE ===")
    # else:
    #     logger.info("=== WARNING: VIDEO INPUT IS NONE ===")

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
