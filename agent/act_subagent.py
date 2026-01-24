"""
Act Sub-Agent using Gemini 2.0 Flash with function calling.

This agent receives an intent string from Gemini Live's act() tool and
interprets it into specific screen actions (add_text, show_image, clear_board, etc.)
"""

import os
import json
import time
from google import genai
from google.genai import types

# ===========================================
# REUSABLE CLIENT (avoid cold start per call)
# ===========================================
_client = None

def get_client():
    global _client
    if _client is None:
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY environment variable not set")
        _client = genai.Client(api_key=api_key)
    return _client

# ============================================
# TOOL DEFINITIONS
# ============================================

TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="clear_board",
                description="Clear everything from the screen. Use when switching topics, starting fresh, or user asks to clear/reset.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={},
                    required=[]
                )
            ),
            types.FunctionDeclaration(
                name="add_text",
                description="Write text on the screen. Use for titles, equations, definitions, key points.",
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
                        "emoji": types.Schema(
                            type=types.Type.STRING,
                            description="Optional emoji to prepend (e.g., '🌱', '⚡', '💡', '🔬')"
                        ),
                        "accent": types.Schema(
                            type=types.Type.STRING,
                            description="Optional colored side accent bar",
                            enum=["none", "purple", "green", "blue", "red", "orange"]
                        ),
                        "underline": types.Schema(
                            type=types.Type.ARRAY,
                            description="Words to underline for emphasis",
                            items=types.Schema(type=types.Type.STRING)
                        ),
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
                            description="Flow direction: 'TB' (top-to-bottom) or 'LR' (left-to-right)",
                            enum=["TB", "LR"]
                        ),
                    },
                    required=["type", "nodes"]
                )
            ),
            types.FunctionDeclaration(
                name="annotate",
                description="Draw an annotation to highlight something on screen. Use for circling, pointing, highlighting.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "shape": types.Schema(
                            type=types.Type.STRING,
                            description="Shape to draw",
                            enum=["circle", "rectangle", "arrow"]
                        ),
                        "target": types.Schema(
                            type=types.Type.STRING,
                            description="What is being annotated (e.g., 'the mitochondria', 'the equation')"
                        ),
                        "x": types.Schema(
                            type=types.Type.NUMBER,
                            description="X coordinate (0-1 normalized)"
                        ),
                        "y": types.Schema(
                            type=types.Type.NUMBER,
                            description="Y coordinate (0-1 normalized)"
                        ),
                    },
                    required=["shape", "target"]
                )
            ),
            types.FunctionDeclaration(
                name="animate",
                description="Create a p5.js animation for physics, motion, simulations. Use for anything that needs movement.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "prompt": types.Schema(
                            type=types.Type.STRING,
                            description="Detailed description of the animation"
                        ),
                    },
                    required=["prompt"]
                )
            ),
            types.FunctionDeclaration(
                name="draw_function",
                description="Draw a math function graph. Use for plotting sin(x), x^2, etc.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "expression": types.Schema(
                            type=types.Type.STRING,
                            description="Math expression using x (e.g., 'sin(x)', 'x^2', '2*x + 1')"
                        ),
                        "xMin": types.Schema(
                            type=types.Type.NUMBER,
                            description="Minimum x value (default: -3.14)"
                        ),
                        "xMax": types.Schema(
                            type=types.Type.NUMBER,
                            description="Maximum x value (default: 3.14)"
                        ),
                    },
                    required=["expression"]
                )
            ),
            types.FunctionDeclaration(
                name="show_question",
                description="Display a quiz question. Use for MCQ, fill-in-blank, or long answer.",
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
                            description="The question text"
                        ),
                        "options": types.Schema(
                            type=types.Type.ARRAY,
                            description="For MCQ: answer choices",
                            items=types.Schema(type=types.Type.STRING)
                        ),
                        "correct_answer": types.Schema(
                            type=types.Type.STRING,
                            description="The correct answer"
                        ),
                        "hint": types.Schema(
                            type=types.Type.STRING,
                            description="Optional hint"
                        ),
                    },
                    required=["question_type", "question"]
                )
            ),
            types.FunctionDeclaration(
                name="memorize",
                description="Store important information about the student or session. Use for preferences, progress, mistakes, interests.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "key": types.Schema(
                            type=types.Type.STRING,
                            description="What to remember (e.g., 'student_name', 'weak_topic', 'learning_style', 'interest')"
                        ),
                        "value": types.Schema(
                            type=types.Type.STRING,
                            description="The value to store"
                        ),
                    },
                    required=["key", "value"]
                )
            ),
        ]
    )
]

# System prompt for the act interpreter
SYSTEM_PROMPT = """Act Intent Interpreter. Convert intent strings into screen actions.

You receive an intent from a voice tutor (e.g., "show diagram of photosynthesis", "clear the board", "highlight the mitochondria").
Your job: call the right tool(s) to execute that intent on screen.

# INTENT → TOOL MAPPING

"clear" / "reset" / "fresh" / "new topic" → clear_board()
"show image" / "photo" / "picture of" → show_image(query)
"diagram" / "flowchart" / "cycle" / "process" → draw_diagram(type, nodes)
"graph" / "plot" / "function" → draw_function(expression)
"animate" / "show how" / "in motion" → animate(prompt)
"circle" / "highlight" / "point to" / "arrow" → annotate(shape, target)
"quiz" / "question" / "test me" → show_question(type, question, options)
"write" / "display" / "show text" / "formula" → add_text(content)
"remember" / "note that" / "student likes" / "struggling with" → memorize(key, value)

# RULES
1. Call exactly ONE tool - NEVER more than one
2. If intent has multiple things, pick the most important ONE
3. No text output, just the single tool call
4. Best-guess if unclear - never fail

# EXAMPLES

Intent: "clear the board"
→ clear_board()

Intent: "show diagram of photosynthesis"
→ draw_diagram(type=flowchart, nodes=["Sunlight", "CO₂ + H₂O", "Glucose", "O₂"])

Intent: "show image of a mitochondria"
→ show_image("mitochondria cell diagram labeled")

Intent: "animate blood flowing through the heart"
→ animate("blood flowing through heart chambers")

Intent: "graph sin(x)"
→ draw_function(expression="sin(x)")

Intent: "circle the important part"
→ annotate(shape=circle, target="the highlighted area")

Intent: "quiz me on the water cycle"
→ show_question(question_type=mcq, question="What powers the water cycle?", options=["The moon", "The sun", "Wind"])

Intent: "display the pythagorean theorem"
→ add_text("a² + b² = c²", size=large)

Intent: "show the steps of cell division"
→ draw_diagram(type=timeline, nodes=["Interphase", "Prophase", "Metaphase", "Anaphase", "Telophase"])

Intent: "remember that the student struggles with fractions"
→ memorize(key="weak_topic", value="fractions")

Intent: "note that they prefer visual learning"
→ memorize(key="learning_style", value="visual")

Intent: "student's name is Alex"
→ memorize(key="student_name", value="Alex")
"""


def interpret_intent(intent: str) -> dict:
    """
    Interpret an act intent and return the tool calls to execute with timing.

    Args:
        intent: Natural language intent from Gemini Live's act() call

    Returns:
        Dict with tool_calls and timing:
        {
            "tool_calls": [{"tool": "show_image", "params": {...}}],
            "timing": {
                "model_ms": 123,  # Time for Gemini API call
                "total_ms": 130   # Total function time
            }
        }
    """
    start_total = time.perf_counter()

    client = get_client()
    model = "gemini-flash-lite-latest"  # Faster model for lower latency

    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=f"Intent: {intent}")]
        )
    ]

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=TOOLS,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    # Time the model call specifically
    start_model = time.perf_counter()
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=config,
    )
    model_ms = (time.perf_counter() - start_model) * 1000

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
                    break  # Only take the FIRST tool call

    total_ms = (time.perf_counter() - start_total) * 1000

    return {
        "tool_calls": tool_calls[:1],  # Enforce single tool
        "timing": {
            "model_ms": round(model_ms, 1),
            "total_ms": round(total_ms, 1)
        }
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python act_subagent.py <intent>")
        print('Example: python act_subagent.py "show diagram of photosynthesis"')
        sys.exit(1)

    intent = " ".join(sys.argv[1:])
    print(f"Intent: {intent}")
    print("-" * 50)

    try:
        result = interpret_intent(intent)
        print(f"Model: {result['timing']['model_ms']:.0f}ms")
        print(f"Total: {result['timing']['total_ms']:.0f}ms")
        print("\nTool calls:")
        print(json.dumps(result['tool_calls'], indent=2))
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
