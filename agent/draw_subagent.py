"""
Draw Sub-Agent using Gemini 2.0 Flash with function calling.

This agent receives a natural language query and decides which drawing tools to use.
It has access to: add_text, show_image, plot_function, draw_table, draw_flowchart
"""

import os
import json
import base64
from google import genai
from google.genai import types

# ============================================
# TOOL DEFINITIONS
# ============================================

TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="add_text",
                description="Write text on the whiteboard. Use for titles, equations, definitions, key points. Supports emoji prefix, colored side accent bar, and underlined words for emphasis.",
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
                        ),
                        "emoji": types.Schema(
                            type=types.Type.STRING,
                            description="Optional emoji to prepend to text (e.g., '🌱', '⚡', '💡', '🔬')"
                        ),
                        "accent": types.Schema(
                            type=types.Type.STRING,
                            description="Optional colored side accent bar for emphasis",
                            enum=["none", "purple", "green", "blue", "red", "orange"]
                        ),
                        "underline": types.Schema(
                            type=types.Type.ARRAY,
                            description="List of specific words to underline for emphasis (e.g., ['photosynthesis', 'glucose'])",
                            items=types.Schema(type=types.Type.STRING)
                        ),
                        "underline_color": types.Schema(
                            type=types.Type.STRING,
                            description="Color for underlined words",
                            enum=["purple", "green", "blue", "red", "orange"]
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
            # types.FunctionDeclaration(
            #     name="annotate",
            #     description="Draw an annotation shape on the canvas to highlight or circle something visible on screen. ONLY use when a screenshot is provided and you need to point to something specific.",
            #     parameters=types.Schema(
            #         type=types.Type.OBJECT,
            #         properties={
            #             "shape": types.Schema(
            #                 type=types.Type.STRING,
            #                 description="Shape to draw",
            #                 enum=["circle", "rectangle", "arrow"]
            #             ),
            #             "x": types.Schema(
            #                 type=types.Type.NUMBER,
            #                 description="X coordinate (0-1 normalized, where 0=left edge, 1=right edge)"
            #             ),
            #             "y": types.Schema(
            #                 type=types.Type.NUMBER,
            #                 description="Y coordinate (0-1 normalized, where 0=top edge, 1=bottom edge)"
            #             ),
            #             "width": types.Schema(
            #                 type=types.Type.NUMBER,
            #                 description="Width of shape (0-1 normalized). For circle, this is diameter."
            #             ),
            #             "height": types.Schema(
            #                 type=types.Type.NUMBER,
            #                 description="Height of shape (0-1 normalized). For circle, use same as width."
            #             ),
            #             "target": types.Schema(
            #                 type=types.Type.STRING,
            #                 description="Description of what is being annotated (e.g., 'the aorta', 'the red car')"
            #             )
            #         },
            #         required=["shape", "x", "y", "width", "height", "target"]
            #     )
            # ),
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
            types.FunctionDeclaration(
                name="draw_function",
                description="Draw an animated math function graph. Use for plotting mathematical functions like sin(x), x^2, cos(x), etc. The graph is drawn with a hand-drawn animation effect.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "expression": types.Schema(
                            type=types.Type.STRING,
                            description="Mathematical expression using x as variable. Examples: 'sin(x)', 'x^2', 'cos(x)', '2*x + 1', 'x^3 - x', 'sqrt(x)', 'abs(x)', 'tan(x)', '1/x'"
                        ),
                        "xMin": types.Schema(
                            type=types.Type.NUMBER,
                            description="Minimum x value for the graph (default: -π ≈ -3.14)"
                        ),
                        "xMax": types.Schema(
                            type=types.Type.NUMBER,
                            description="Maximum x value for the graph (default: π ≈ 3.14)"
                        ),
                        "position": types.Schema(
                            type=types.Type.STRING,
                            description="Position: 'center' (default), 'below-last', etc."
                        )
                    },
                    required=["expression"]
                )
            ),
        ]
    )
]

# System prompt for the sub-agent
SYSTEM_PROMPT = """You are a visual rendering agent for educational content. Convert natural language requests into tool calls.

# TOOL SPEEDS (IMPORTANT)
- add_text: FAST - instant
- draw_diagram: FAST - instant
- draw_function: FAST - instant (animated math graphs)
- show_image: MEDIUM - ~1-2 sec
# - annotate: MEDIUM - ~1 sec (disabled)
- animate: SLOW - ~3-5 sec (p5.js generation)

# SPEED HINTS FROM TUTOR
The tutor may include speed hints in the query:
- "quick" / "fast" / "quickly" → Use FAST tools only (add_text, draw_diagram)
- No hint or "visualize" → Use MEDIUM tools (show_image, draw_diagram)
- "animate" / "show how" / "demonstrate" → Use animate (SLOW but worth it for core concepts)

# RULES (IMPORTANT - READ FIRST)

1. MAXIMUM 2 TOOL CALLS: add_text (title) + one visual (show_image/draw_diagram/animate)
2. ALWAYS label visuals: First call add_text with short title, then the visual below
3. POSITIONING: First element → position="center", second → position="below-last"
4. CHECK FOR MOTION FIRST: If concept involves movement/change/dynamics → use animate
5. Keep titles under 10 words

# TOOL SELECTION

**animate** - Use when the request implies MOTION or CHANGE:
- Trigger words: flows, moves, travels, falls, spreads, bounces, oscillates, pumps, collides
- Trigger phrases: "what happens when", "watch how", "see how", "over time"
- Topics: reactions, gravity, waves, collisions, circulation, diffusion, oscillation
- In prompt: specify direction, colors (hot=red/orange, cold=blue/cyan), physics behavior

**show_image** - Use for STATIC structures/objects:
- Trigger: "what does X look like", "show me a [physical thing]"
- Topics: anatomy diagrams, real objects, photos, illustrations
- In query: include "diagram" or "labeled" for educational images

**draw_diagram** - Use for PROCESSES with discrete steps:
- flowchart: step-by-step procedures
- cycle: repeating processes (water cycle, life cycle)
- timeline: historical sequences
- mindmap: categories/hierarchies

**add_text** - Use for equations, definitions, labels
- Use `emoji` for visual flair on titles (🌱 nature, ⚡ energy, 💡 ideas, 🔬 science, 🧬 biology, ⚛️ physics, 🧪 chemistry)
- Use `accent` bar (purple/green/blue/red/orange) for important concepts or definitions
- Use `underline` to emphasize key terms within the text (1-2 words max)

**draw_function** - Use for MATH FUNCTION GRAPHS:
- Trigger: "graph", "plot", "function", "y = ...", "f(x) = ..."
- Topics: sin(x), cos(x), x^2, x^3, linear functions, polynomials
- Supported: sin, cos, tan, sqrt, abs, log, exp, ^(power), *, +, -, /
- Set xMin/xMax for appropriate range (default is -π to π)

# TEXT STYLING GUIDE

Titles: Use emoji + accent for engaging headers
  {"content": "Photosynthesis", "size": "large", "emoji": "🌱", "accent": "green"}

Definitions: Use accent bar to make them stand out
  {"content": "Mitosis is the process of cell division", "accent": "blue", "underline": ["Mitosis"], "underline_color": "blue"}

Key concepts: Underline the important terms
  {"content": "Energy is converted from sunlight to glucose", "underline": ["Energy", "glucose"], "underline_color": "green"}

# EXAMPLES

"what does a heart look like" → static structure
[{"tool": "add_text", "params": {"content": "Heart Anatomy", "size": "large", "emoji": "❤️", "accent": "red", "position": "center"}},
 {"tool": "show_image", "params": {"query": "human heart anatomy diagram labeled", "position": "below-last"}}]

"how blood flows through the heart" → motion ("flows")
[{"tool": "add_text", "params": {"content": "Blood Circulation", "size": "large", "emoji": "🫀", "accent": "red", "position": "center"}},
 {"tool": "animate", "params": {"prompt": "blood circulation - red particles flowing through heart chambers, pumping rhythmically in a loop", "position": "below-last"}}]

"explain the water cycle" → repeating process
[{"tool": "add_text", "params": {"content": "The Water Cycle", "size": "large", "emoji": "💧", "accent": "blue", "position": "center"}},
 {"tool": "draw_diagram", "params": {"type": "cycle", "nodes": ["Evaporation", "Condensation", "Precipitation", "Collection"], "position": "below-last"}}]

"watch how a ball falls" → motion ("watch", "falls")
[{"tool": "add_text", "params": {"content": "Gravity in Action", "size": "large", "emoji": "⚡", "accent": "purple", "position": "center"}},
 {"tool": "animate", "params": {"prompt": "gravity - ball falling and accelerating downward, bouncing with decreasing height", "position": "below-last"}}]

"what happens when energy is released" → change ("what happens", "released")
[{"tool": "add_text", "params": {"content": "Exothermic Reaction", "size": "large", "emoji": "🔥", "accent": "orange", "position": "center"}},
 {"tool": "animate", "params": {"prompt": "exothermic reaction - particles explode outward with hot colors (red, orange, yellow)", "position": "below-last"}}]

"show me the pythagorean theorem" → equation
[{"tool": "add_text", "params": {"content": "Pythagorean Theorem", "size": "large", "emoji": "📐", "accent": "purple", "position": "center"}},
 {"tool": "add_text", "params": {"content": "a² + b² = c²", "size": "large", "underline": ["a²", "b²", "c²"], "underline_color": "purple", "position": "below-last"}}]

"graph sin x" → math function
[{"tool": "add_text", "params": {"content": "Sine Function", "size": "large", "emoji": "📈", "accent": "blue", "position": "center"}},
 {"tool": "draw_function", "params": {"expression": "sin(x)", "position": "below-last"}}]

"plot y = x squared" → math function
[{"tool": "add_text", "params": {"content": "Parabola", "size": "large", "emoji": "📐", "accent": "purple", "position": "center"}},
 {"tool": "draw_function", "params": {"expression": "x^2", "xMin": -3, "xMax": 3, "position": "below-last"}}]

"show me what cosine looks like" → math function
[{"tool": "add_text", "params": {"content": "Cosine Wave", "size": "large", "emoji": "〰️", "accent": "blue", "position": "center"}},
 {"tool": "draw_function", "params": {"expression": "cos(x)", "xMin": -6.28, "xMax": 6.28, "position": "below-last"}}]

# ANNOTATION MODE (disabled)
# When a screenshot is provided, use `annotate` to highlight things on screen:
# - x, y: center position (0-1 normalized, 0=left/top, 1=right/bottom)
# - width, height: size (0-1 normalized)
# - Look carefully at the image before estimating coordinates
# - Make shapes slightly larger than the target
#
# Example: "circle the mitochondria" (with screenshot)
# {"tool": "annotate", "params": {"shape": "circle", "x": 0.65, "y": 0.4, "width": 0.15, "height": 0.15, "target": "mitochondria"}}
"""


def call_subagent(query: str) -> list[dict]:
    """
    Call the Gemini sub-agent with a query and return the tool calls it makes.

    Args:
        query: Natural language query (e.g., "draw a red car on a hill")

    Returns:
        List of tool calls in format: [{"tool": "show_image", "params": {"query": "...", "position": "..."}}]
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY environment variable not set")

    client = genai.Client(api_key=api_key)

    model = "gemini-3-flash-preview"

    parts = [types.Part.from_text(text=query)]

    contents = [
        types.Content(
            role="user",
            parts=parts
        )
    ]

    thinking_level = types.ThinkingLevel.MINIMAL

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=TOOLS,
        thinking_config=types.ThinkingConfig(
            thinking_level=thinking_level,
        ),
    )

    # Generate response
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=config,
    )

    # Extract tool calls from response
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

    return tool_calls


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python draw_subagent.py <query>")
        print('Example: python draw_subagent.py "draw a red car on a hill"')
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    print(f"Query: {query}")
    print("-" * 50)

    try:
        tool_calls = call_subagent(query)
        print("Tool calls:")
        print(json.dumps(tool_calls, indent=2))
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
