"""
Draw Sub-Agent (Live Version) - For integration with tutor.py

This is the production version that tutor.py imports directly.
For R&D/testing, use draw_subagent.py instead.
"""

import os
import base64
import logging
from google import genai
from google.genai import types

logger = logging.getLogger("draw_subagent")

# ============================================
# TOOL DEFINITIONS
# ============================================

TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="add_text",
                description="Write text on the whiteboard. Use for titles, equations, definitions, key points.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "content": types.Schema(
                            type=types.Type.STRING,
                            description="Text to display (supports math notation like x^2, sqrt, etc.)"
                        ),
                        "size": types.Schema(
                            type=types.Type.STRING,
                            description="Text size: 'large' for titles, 'medium' for content (default), 'small' for notes",
                            enum=["small", "medium", "large"]
                        ),
                        "position": types.Schema(
                            type=types.Type.STRING,
                            description="Position: 'center' (default), 'below-last', 'right-of-last', or 'top-left', 'top-center', etc."
                        )
                    },
                    required=["content"]
                )
            ),
            types.FunctionDeclaration(
                name="show_image",
                description="Search and display an image. Use for diagrams, photos, illustrations.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "query": types.Schema(
                            type=types.Type.STRING,
                            description="Specific search query (e.g., 'mitochondria cell diagram', 'red car on hill')"
                        ),
                        "position": types.Schema(
                            type=types.Type.STRING,
                            description="Position: 'center' (default), 'below-last', 'right-of-last', etc."
                        )
                    },
                    required=["query"]
                )
            ),
            types.FunctionDeclaration(
                name="draw_diagram",
                description="Draw a diagram (flowchart, mindmap, cycle, timeline). Use for processes, relationships, hierarchies.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "type": types.Schema(
                            type=types.Type.STRING,
                            description="Diagram type",
                            enum=["flowchart", "mindmap", "cycle", "timeline"]
                        ),
                        "nodes": types.Schema(
                            type=types.Type.ARRAY,
                            description="List of step/concept labels",
                            items=types.Schema(type=types.Type.STRING)
                        ),
                        "direction": types.Schema(
                            type=types.Type.STRING,
                            description="Flow direction: 'TB' (top-to-bottom, default) or 'LR' (left-to-right)",
                            enum=["TB", "LR"]
                        ),
                        "position": types.Schema(
                            type=types.Type.STRING,
                            description="Position: 'center' (default), 'below-last', etc."
                        )
                    },
                    required=["type", "nodes"]
                )
            ),
            types.FunctionDeclaration(
                name="annotate",
                description="Draw an annotation shape on the canvas to highlight or circle something visible on screen. ONLY use when a screenshot is provided and you need to point to something specific.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "shape": types.Schema(
                            type=types.Type.STRING,
                            description="Shape to draw",
                            enum=["circle", "rectangle", "arrow"]
                        ),
                        "x": types.Schema(
                            type=types.Type.NUMBER,
                            description="X coordinate (0-1 normalized, where 0=left edge, 1=right edge)"
                        ),
                        "y": types.Schema(
                            type=types.Type.NUMBER,
                            description="Y coordinate (0-1 normalized, where 0=top edge, 1=bottom edge)"
                        ),
                        "width": types.Schema(
                            type=types.Type.NUMBER,
                            description="Width of shape (0-1 normalized). For circle, this is diameter."
                        ),
                        "height": types.Schema(
                            type=types.Type.NUMBER,
                            description="Height of shape (0-1 normalized). For circle, use same as width."
                        ),
                        "target": types.Schema(
                            type=types.Type.STRING,
                            description="Description of what is being annotated (e.g., 'the aorta', 'the red car')"
                        )
                    },
                    required=["shape", "x", "y", "width", "height", "target"]
                )
            ),
            types.FunctionDeclaration(
                name="animate",
                description="Create a dynamic p5.js animation for physics simulations, particle systems, and scientific visualizations. Use when static images or diagrams cannot convey the concept - especially for reactions, energy, motion, waves, and processes that need to FEEL real.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "prompt": types.Schema(
                            type=types.Type.STRING,
                            description="Detailed description of the animation. Be specific about: the concept (e.g., 'exothermic reaction'), the physics (e.g., 'particles explode outward'), and the feel (e.g., 'hot colors, energy release')"
                        ),
                        "position": types.Schema(
                            type=types.Type.STRING,
                            description="Position: 'center' (default), 'below-last', etc."
                        )
                    },
                    required=["prompt"]
                )
            ),
        ]
    )
]

# System prompt for the sub-agent
SYSTEM_PROMPT = """You are a visual rendering agent. Convert natural language requests into tool calls.

# TOOL SPEEDS (IMPORTANT)
- add_text: FAST - instant
- draw_diagram: FAST - instant
- show_image: MEDIUM - ~1-2 sec
- annotate: MEDIUM - ~1 sec
- animate: SLOW - ~3-5 sec (p5.js generation)

# SPEED HINTS FROM TUTOR
The tutor may include speed hints in the query:
- "quick" / "fast" / "quickly" → Use FAST tools only (add_text, draw_diagram)
- No hint or "visualize" → Use MEDIUM tools (show_image, draw_diagram)
- "animate" / "show how" / "demonstrate" → Use animate (SLOW but worth it for core concepts)

# WHEN TO USE EACH TOOL

**add_text** (FAST) - Text, equations, definitions
- "show the equation" → add_text
- "write the formula" → add_text

**draw_diagram** (FAST) - Steps, processes, hierarchies
- "steps of X" → flowchart
- "timeline of X" → timeline
- "types of X" → mindmap
- Good for: procedures, sequences, comparisons

**show_image** (MEDIUM) - Real photographs
- "what does X look like" → show_image
- "photo of X" → show_image
- Good for: real objects, historical photos, anatomy detail

**annotate** (MEDIUM) - Highlight existing content (requires screenshot)
- "circle the X" → annotate
- "point to X" → annotate

**animate** (SLOW) - Dynamic simulations, core concepts
- ONLY use for concepts where motion is essential to understanding
- Physics: gravity, collisions, waves, orbits
- Biology: heartbeat, blood flow, cell division
- Chemistry: reactions, molecular motion
- NOT for: step-by-step processes (use draw_diagram instead)

# RULES
1. MAX 2 tool calls: add_text (title) + one visual
2. POSITIONING: First → "center", second → "below-last"
3. Titles under 10 words

# EXAMPLES

"quick overview of photosynthesis" → FAST requested
[{"tool": "add_text", "params": {"content": "Photosynthesis", "size": "large", "position": "center"}},
 {"tool": "draw_diagram", "params": {"type": "flowchart", "nodes": ["Sunlight", "CO2 + H2O", "Chloroplast", "Glucose + O2"], "position": "below-last"}}]

"the heart" → No speed hint, use judgment (anatomy = show_image)
[{"tool": "add_text", "params": {"content": "The Human Heart", "size": "large", "position": "center"}},
 {"tool": "show_image", "params": {"query": "human heart anatomy diagram labeled", "position": "below-last"}}]

"show how the heart beats" → "show how" = animate
[{"tool": "add_text", "params": {"content": "Heartbeat", "size": "large", "position": "center"}},
 {"tool": "animate", "params": {"prompt": "anatomical heart beating, chambers contracting rhythmically, blood flowing - red left, blue right", "position": "below-last"}}]

"what does a platypus look like" → real thing = show_image
[{"tool": "add_text", "params": {"content": "Platypus", "size": "large", "position": "center"}},
 {"tool": "show_image", "params": {"query": "platypus photograph wildlife", "position": "below-last"}}]

"steps of the scientific method" → steps = draw_diagram
[{"tool": "add_text", "params": {"content": "Scientific Method", "size": "large", "position": "center"}},
 {"tool": "draw_diagram", "params": {"type": "flowchart", "nodes": ["Question", "Hypothesis", "Experiment", "Analyze", "Conclude"], "position": "below-last"}}]

"demonstrate gravity" → demonstrate = animate
[{"tool": "add_text", "params": {"content": "Gravity", "size": "large", "position": "center"}},
 {"tool": "animate", "params": {"prompt": "ball falling with increasing speed, bouncing with decreasing height each time", "position": "below-last"}}]

# ANNOTATION (when screenshot provided)
"circle the mitochondria" (with screenshot)
→ {"tool": "annotate", "params": {"shape": "circle", "x": 0.65, "y": 0.4, "width": 0.15, "height": 0.15, "target": "mitochondria"}}
"""

# Singleton client
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    """Get or create the Gemini client."""
    global _client
    if _client is None:
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY environment variable not set")
        _client = genai.Client(api_key=api_key)
    return _client


async def call_draw_subagent(query: str, screenshot_base64: str | None = None) -> list[dict]:
    """
    Call the draw sub-agent with a natural language query.

    This is the main entry point for tutor.py to use.

    Args:
        query: Natural language drawing request (e.g., "show the water cycle")
        screenshot_base64: Optional base64-encoded screenshot for annotation mode

    Returns:
        List of tool calls: [{"tool": "draw_diagram", "params": {...}}, ...]
    """
    logger.info(f"[DRAW SUBAGENT] Query: {query}")
    if screenshot_base64:
        logger.info(f"[DRAW SUBAGENT] Screenshot provided ({len(screenshot_base64)} bytes)")

    client = _get_client()
    model = "gemini-3-flash-preview"

    # Build the message parts
    parts = []

    # Add screenshot if provided
    if screenshot_base64:
        parts.append(types.Part.from_bytes(
            data=base64.b64decode(screenshot_base64),
            mime_type="image/png"
        ))
        parts.append(types.Part.from_text(text=f"Screenshot of current canvas is above. User request: {query}"))
    else:
        parts.append(types.Part.from_text(text=query))

    contents = [
        types.Content(
            role="user",
            parts=parts
        )
    ]

    # Use MEDIUM thinking when screenshot is provided (for coordinate accuracy)
    # Use MINIMAL thinking for regular draw calls (faster)
    thinking_level = types.ThinkingLevel.MEDIUM if screenshot_base64 else types.ThinkingLevel.MINIMAL

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=TOOLS,
        thinking_config=types.ThinkingConfig(
            thinking_level=thinking_level,
        ),
    )

    # Generate response (sync call, but wrapped in async for tutor.py compatibility)
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=config,
    )

    # Extract tool calls
    tool_calls = []

    if response.candidates and len(response.candidates) > 0:
        candidate = response.candidates[0]
        if candidate.content and candidate.content.parts:
            for part in candidate.content.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    fc = part.function_call
                    tool_calls.append({
                        "tool": fc.name,
                        "params": dict(fc.args) if fc.args else {}
                    })

    logger.info(f"[DRAW SUBAGENT] Generated {len(tool_calls)} tool call(s)")
    for tc in tool_calls:
        logger.debug(f"[DRAW SUBAGENT] -> {tc['tool']}: {tc['params']}")

    return tool_calls
