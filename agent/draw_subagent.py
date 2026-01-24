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
                description="Create a dynamic p5.js animation for physics simulations, particle systems, motion, and scientific visualizations. Use for anything that needs movement or real-time simulation.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "prompt": types.Schema(
                            type=types.Type.STRING,
                            description="Detailed description of the animation including what objects move, how they move, colors, and physics behavior."
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
            types.FunctionDeclaration(
                name="show_question",
                description="Display a question on the whiteboard for the student to answer. Use for quizzes, comprehension checks, or practice problems. Supports multiple choice (MCQ), fill-in-the-blank, and long answer formats.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "question_type": types.Schema(
                            type=types.Type.STRING,
                            description="Type of question",
                            enum=["mcq", "fill_blank", "long_answer"]
                        ),
                        "question": types.Schema(
                            type=types.Type.STRING,
                            description="The question text. For fill_blank, use ___ (triple underscore) to indicate the blank."
                        ),
                        "options": types.Schema(
                            type=types.Type.ARRAY,
                            description="For MCQ only: list of answer choices (A, B, C, D will be auto-prefixed)",
                            items=types.Schema(type=types.Type.STRING)
                        ),
                        "correct_answer": types.Schema(
                            type=types.Type.STRING,
                            description="The correct answer (letter for MCQ, word/phrase for fill_blank, or key points for long_answer)"
                        ),
                        "hint": types.Schema(
                            type=types.Type.STRING,
                            description="Optional hint to help the student"
                        ),
                        "position": types.Schema(
                            type=types.Type.STRING,
                            description="Position: 'center' (default), 'below-last', etc."
                        )
                    },
                    required=["question_type", "question"]
                )
            ),
        ]
    )
]

# System prompt for the sub-agent
SYSTEM_PROMPT = """Visual Rendering Agent. Call tools only - no text output.

# RULES
1. Title first: add_text(size=large, emoji, <10 words)
2. Max 5 tool calls, max 2 animate
3. One concept per visual, max 15 words per text
4. Best-guess if unclear - never ask questions

# TOOL GUIDELINES

## draw_diagram (processes, relationships)
- flowchart: 4-6 nodes max, sequential cause→effect
- cycle: 4-5 nodes max, repeating processes
- mindmap: 5-7 branches max, hierarchies/categories
- timeline: 5-6 events max, use direction=LR
- Node labels: max 5 words, use action verbs

## animate (motion/dynamics ONLY)
USE FOR: physics (gravity, waves, collisions), biology (blood flow, cell division), chemistry (reactions)
NOT FOR: static structures, comparisons, conceptual sequences → use draw_diagram instead

## show_image (static visuals)
USE FOR: real-world photos, anatomical diagrams, labeled structures
Query tip: add "educational diagram labeled" for technical content

## draw_function (math graphs)
Specify xMin/xMax: trig [-6.28, 6.28], polynomial [-5, 5]

## show_question (assessment)
ONLY when prompt contains: "quiz", "test", "question"
- mcq: 3 options (A/B/C), include correct_answer
- fill_blank: use ___ for blank, correct_answer is missing word
- hint: guide thinking, never reveal answer

## add_text (titles, labels, definitions, math formulas)
- size=large: titles only (1 per sequence)
- size=medium: content, definitions
- Emoji by domain: 🌱bio ⚡physics 💡ideas 🔬science 📈math 📜history
- Use accent colors + underline for key terms
- MATH NOTATION: Use plain text, NOT LaTeX. Write x^2 not $x^2$, write f'(x) not $f'(x)$
  Examples: "f(x) = x^2", "f'(x) = 2x", "dy/dx = nx^(n-1)", "∫x dx = x^2/2"

# TOOL SELECTION
SHORT (<15 words, single concept) → show_image or draw_diagram
LONG (describes motion/behavior) → animate
"graph/plot" + equation → draw_function
"quiz/test/question" → show_question

# EXAMPLES

"labeled heart diagram"
→ add_text("❤️ The Human Heart", size=large, accent=red)
→ show_image("labeled heart diagram educational anatomy")

"water cycle diagram"
→ add_text("💧 The Water Cycle", size=large, accent=blue)
→ draw_diagram(type=cycle, nodes=["Evaporation", "Condensation", "Precipitation", "Collection"])

"show how blood flows through the heart with valves opening and closing"
→ add_text("❤️ Blood Flow", size=large, accent=red)
→ animate("blood flowing through heart, valves opening as blood enters chambers, closing as it pumps out")

"steps of photosynthesis"
→ add_text("🌱 Photosynthesis", size=large, accent=green)
→ draw_diagram(type=flowchart, nodes=["Absorb sunlight", "Take in CO₂ + H₂O", "Convert to glucose", "Release O₂"])

"graph sin(x)"
→ add_text("📈 Sine Wave", size=large, accent=blue)
→ draw_function(expression="sin(x)", xMin=-6.28, xMax=6.28)

"power rule for derivatives"
→ add_text("📈 Power Rule", size=large, accent=blue)
→ add_text("If f(x) = x^n, then f'(x) = n·x^(n-1)", accent=blue)
→ add_text("Example: f(x) = x^3 → f'(x) = 3x^2", accent=blue)

"quiz on photosynthesis"
→ add_text("🧪 Quick Check!", size=large, accent=purple)
→ show_question(question_type=mcq, question="What gas do plants release during photosynthesis?", options=["Carbon dioxide", "Oxygen", "Nitrogen"], correct_answer="B")
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

    model = "gemini-flash-latest"

    parts = [types.Part.from_text(text=query)]

    contents = [
        types.Content(
            role="user",
            parts=parts
        )
    ]

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=TOOLS,
        thinking_config=types.ThinkingConfig(
            thinking_budget=0,
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
