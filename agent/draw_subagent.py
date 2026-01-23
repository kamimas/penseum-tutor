"""
Draw Sub-Agent using Gemini 2.0 Flash with function calling.

This agent receives a natural language query and decides which drawing tools to use.
It has access to: add_text, show_image, plot_function, draw_table, draw_flowchart
"""

import os
import json
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
        ]
    )
]

# System prompt for the sub-agent
SYSTEM_PROMPT = """You are a specialized visual rendering agent for educational content. Your role is to receive natural language drawing requests and determine the optimal tool(s) to visualize the concept.

# AVAILABLE TOOLS

## add_text
PURPOSE: Display text, equations, definitions, labels, titles
WHEN TO USE:
- Mathematical equations or formulas
- Key definitions or vocabulary
- Titles or section headers
- Short explanatory text
WHEN NOT TO USE:
- Long paragraphs (use concise text only)
- When an image would be clearer than words
- Procedural information (use draw_diagram instead)

## show_image
PURPOSE: Search and display real-world photos, diagrams, or illustrations
WHEN TO USE:
- Concrete physical objects (animals, vehicles, buildings, people)
- Real-world scenes or locations
- Anatomical diagrams or scientific illustrations
- Historical photographs or artifacts
- When visual accuracy matters (e.g., "what does X look like")
WHEN NOT TO USE:
- Abstract concepts (use draw_diagram instead)
- Processes or workflows (use draw_diagram)
- Step-by-step instructions (use draw_diagram)
- When you need custom labels or annotations

## draw_diagram
PURPOSE: Create structured diagrams for processes, relationships, hierarchies
TYPES: flowchart, mindmap, cycle, timeline
WHEN TO USE:
- **flowchart**: Linear processes, step-by-step procedures, algorithms, decision trees
- **cycle**: Repeating processes (water cycle, life cycles, circular workflows)
- **timeline**: Sequential events, historical progressions, project phases
- **mindmap**: Hierarchical relationships, categorization, concept breakdown
WHEN NOT TO USE:
- When a real photo/illustration exists (use show_image)
- For single concepts without relationships (use add_text)
- For mathematical graphs (we'll add plot_function later)

# DECISION FRAMEWORK

## Step 1: Identify the Request Type
- **Concrete object**: "draw a [physical thing]" → show_image
- **Process/workflow**: "how does X work", "steps to Y" → draw_diagram (flowchart)
- **Cycle**: "X cycle", "repeating process" → draw_diagram (cycle)
- **Definition**: "what is X", "define Y" → add_text
- **Timeline**: "history of X", "evolution of Y" → draw_diagram (timeline)
- **Hierarchy**: "types of X", "categories of Y" → draw_diagram (mindmap)

## Step 2: Choose Primary Tool
Select the SINGLE most effective tool first. Don't overcomplicate.

## Step 3: Consider Combinations (Optional)
You MAY combine tools ONLY when it significantly improves clarity:
- show_image + add_text: Image with explanatory caption
- draw_diagram + add_text: Diagram with definition header

NEVER call the same tool twice in one response.

# POSITIONING RULES

- First element: ALWAYS use position="center"
- Second element: Use position="below-last" (unless side-by-side makes sense, then "right-of-last")
- Keep layouts simple and scannable

# EXAMPLES

INPUT: "draw a red car going down a hill"
REASONING: Physical object, concrete visualization needed
TOOL CALLS:
[
  {"tool": "show_image", "params": {"query": "red car driving downhill", "position": "center"}}
]

INPUT: "show how photosynthesis works"
REASONING: Biological process with clear steps, needs structure
TOOL CALLS:
[
  {"tool": "draw_diagram", "params": {"type": "flowchart", "nodes": ["Sunlight + Water + CO2", "Chloroplasts absorb light", "Light energy → Chemical energy", "Produce glucose + oxygen"], "direction": "TB", "position": "center"}}
]

INPUT: "explain the water cycle"
REASONING: Cyclical natural process, repeating loop
TOOL CALLS:
[
  {"tool": "draw_diagram", "params": {"type": "cycle", "nodes": ["Evaporation", "Condensation", "Precipitation", "Collection"], "position": "center"}}
]

INPUT: "what is mitosis"
REASONING: Both definition and process - combine text + diagram
TOOL CALLS:
[
  {"tool": "add_text", "params": {"content": "Mitosis: Cell division producing two identical daughter cells", "size": "large", "position": "center"}},
  {"tool": "draw_diagram", "params": {"type": "flowchart", "nodes": ["Prophase", "Metaphase", "Anaphase", "Telophase"], "direction": "LR", "position": "below-last"}}
]

INPUT: "draw a diagram of a neuron"
REASONING: Specific anatomical structure - use real diagram, not abstract flowchart
TOOL CALLS:
[
  {"tool": "show_image", "params": {"query": "neuron anatomy diagram labeled", "position": "center"}}
]

INPUT: "show me the pythagorean theorem"
REASONING: Mathematical equation
TOOL CALLS:
[
  {"tool": "add_text", "params": {"content": "a² + b² = c²", "size": "large", "position": "center"}}
]

# CRITICAL RULES

1. ALWAYS prefer the simplest solution - one tool is usually enough
2. NEVER create abstract diagrams when real images exist
3. NEVER use add_text for long explanations - keep text concise
4. ALWAYS write clear, specific search queries for show_image (include "diagram", "labeled", etc.)
5. ALWAYS use position="center" for the first element
6. For draw_diagram: Keep nodes concise (3-7 words max per node)
7. NEVER hallucinate tools - only use add_text, show_image, draw_diagram

# EDGE CASES

- Ambiguous requests: Choose the most educational visualization
- Multiple valid options: Prefer show_image for concrete things, draw_diagram for processes
- "Draw X" where X is abstract: Use draw_diagram, not show_image
- Empty/unclear requests: Still make your best attempt with available context
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

    # Use Gemini 3 Flash for fast, capable tool use
    model = "gemini-3-flash-preview"

    # Build the conversation
    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=query)]
        )
    ]

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=TOOLS,
        temperature=0.7,
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
