import asyncio
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

LOG_FILE = Path(__file__).parent / "tool_calls.log"


class TutorAgent(Agent):
    def __init__(self):
        super().__init__(instructions=SYSTEM_PROMPT)

    # ============================================
    # CONTENT TOOLS
    # ============================================

    @function_tool
    async def add_text(self, ctx: RunContext, content: str, size: str = "medium") -> str:
        """Write text on the whiteboard.

        Args:
            content: Text to display (supports LaTeX with $ delimiters)
            size: 'large' for titles, 'medium' for explanations (default), 'small' for annotations
        """
        await self._send(ctx, "add_text", {"content": content, "size": size})
        return f"Added text: '{content}'"

    @function_tool
    async def show_image(self, ctx: RunContext, query: str) -> str:
        """Search and display an image on the whiteboard.

        Args:
            query: Specific search query for the image
        """
        await self._send(ctx, "show_image", {"query": query})
        return f"Showing image for: {query}"

    @function_tool
    async def draw_table(self, ctx: RunContext, headers: list[str], rows: list[list[str]]) -> str:
        """Draw a comparison table on the whiteboard.

        Args:
            headers: Column headers
            rows: Table rows, each row is a list of cells
        """
        await self._send(ctx, "draw_table", {"headers": headers, "rows": rows})
        return f"Drew table with {len(headers)} columns and {len(rows)} rows"

    @function_tool
    async def draw_flowchart(self, ctx: RunContext, steps: list[str]) -> str:
        """Draw a flowchart showing a process or sequence.

        Args:
            steps: List of steps in order
        """
        await self._send(ctx, "draw_flowchart", {"steps": steps})
        return f"Drew flowchart with {len(steps)} steps"

    @function_tool
    async def plot_function(self, ctx: RunContext, equation: str) -> str:
        """Plot a mathematical function on the whiteboard.

        Args:
            equation: The function to plot. MUST use 'x' as the variable (e.g., "x^2", "sin(x)", "2*x + 1").
                      Use multiplication symbol: "2*x" not "2x".
        """
        await self._send(ctx, "plot_function", {"equation": equation})
        return f"Plotted function: {equation}"

    @function_tool
    async def clear_board(self, ctx: RunContext) -> str:
        """Clear all content from the whiteboard."""
        await self._send(ctx, "clear_board", {})
        return "Board cleared"

    # ============================================
    # ANNOTATION TOOLS (Vision-Aware)
    # ============================================

    @function_tool
    async def highlight_area(
        self, ctx: RunContext, x: int, y: int, width: int, height: int, color: str = "yellow"
    ) -> str:
        """Highlight a rectangular area on the screen. Use when you see something to emphasize.

        Args:
            x: Left edge (0-1000, where 0=left edge, 1000=right edge)
            y: Top edge (0-1000, where 0=top edge, 1000=bottom edge)
            width: Width of highlight (0-1000 scale)
            height: Height of highlight (0-1000 scale)
            color: Highlight color - yellow, red, blue, or green
        """
        await self._send(ctx, "highlight_area", {
            "x": x, "y": y, "width": width, "height": height, "color": color
        })
        return f"Highlighted area at ({x}, {y})"

    @function_tool
    async def draw_circle(
        self, ctx: RunContext, x: int, y: int, radius: int = 30, color: str = "red"
    ) -> str:
        """Draw a circle to highlight a specific point you see on screen.

        Args:
            x: Center X position (0-1000, where 0=left, 1000=right)
            y: Center Y position (0-1000, where 0=top, 1000=bottom)
            radius: Circle radius (0-1000 scale, default 30)
            color: Circle color
        """
        await self._send(ctx, "draw_circle", {
            "x": x, "y": y, "radius": radius, "color": color
        })
        return f"Drew circle at ({x}, {y})"

    @function_tool
    async def draw_arrow(
        self, ctx: RunContext, from_x: int, from_y: int, to_x: int, to_y: int, label: str = ""
    ) -> str:
        """Draw an arrow pointing to something you see on screen.

        Args:
            from_x: Arrow start X (0-1000)
            from_y: Arrow start Y (0-1000)
            to_x: Arrow end X - where it points (0-1000)
            to_y: Arrow end Y - where it points (0-1000)
            label: Optional text label for the arrow
        """
        await self._send(ctx, "draw_arrow", {
            "from_x": from_x, "from_y": from_y,
            "to_x": to_x, "to_y": to_y,
            "label": label
        })
        return f"Drew arrow pointing to ({to_x}, {to_y})"

    @function_tool
    async def add_annotation(
        self, ctx: RunContext, x: int, y: int, text: str, color: str = "blue"
    ) -> str:
        """Add a text annotation at a specific position on screen.

        Args:
            x: X position (0-1000, where 0=left, 1000=right)
            y: Y position (0-1000, where 0=top, 1000=bottom)
            text: The annotation text
            color: Text color
        """
        await self._send(ctx, "add_annotation", {
            "x": x, "y": y, "text": text, "color": color
        })
        return f"Added annotation: {text}"

    # ============================================
    # HELPER
    # ============================================

    async def _send(self, ctx: RunContext, tool: str, params: dict):
        """Send tool call to frontend via LiveKit data channel."""
        # Log to file
        with open(LOG_FILE, "a") as f:
            f.write(f"[TOOL] {tool}: {params}\n")

        logger.info(f"[TOOL] {tool}: {params}")

        # Send via LiveKit data channel
        payload = json.dumps({"tool": tool, "params": params})
        await ctx.session.room.local_participant.publish_data(
            payload.encode(), reliable=True, topic="tutor_draw"
        )


# ============================================
# ENTRYPOINT
# ============================================

async def entrypoint(ctx: JobContext):
    with open(LOG_FILE, "a") as f:
        f.write("\n=== NEW SESSION ===\n")
    logger.info("=== TUTOR AGENT STARTING ===")

    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
    logger.info(f"Connected to room: {ctx.room.name}")

    # Configure Gemini 2.5 with native audio (video input enabled via RoomInputOptions)
    model = google.realtime.RealtimeModel(
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        modalities=["AUDIO"],
        instructions=SYSTEM_PROMPT,
    )

    session = AgentSession(llm=model)

    # Start session with video input enabled
    await session.start(
        agent=TutorAgent(),
        room=ctx.room,
        room_input_options=RoomInputOptions(video_enabled=True),
    )

    logger.info("=== TUTOR AGENT READY ===")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
