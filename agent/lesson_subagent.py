"""
Lesson Sub-Agent using Gemini Flash.

This agent receives a topic and generates a structured lesson plan JSON.
The lesson plan contains concepts with instructions that reference draw tools.
"""

import os
import sys
import json
import time
from google import genai
from google.genai import types
from pydantic import BaseModel

# ==============================================
# OUTPUT SCHEMA
# ==============================================

class Concept(BaseModel):
    name: str
    script: str  # What the tutor should SAY
    visual: str  # What to draw (query for draw tool)

class Lesson(BaseModel):
    title: str
    subject: str
    concepts: list[Concept]

# ==============================================
# SYSTEM PROMPT
# ==============================================

SYSTEM_PROMPT = """You are a curriculum designer. Generate a lesson plan.

# COGNITIVE SCIENCE PRINCIPLES

Based on learning science research, effective lessons use:

1. **Retrieval Practice** - Ask questions BEFORE revealing answers. Let students think first.
2. **Concrete Examples** - Always ground abstract ideas in specific, tangible examples.
3. **Dual Coding** - Combine visuals + verbal explanation.
4. **Elaboration** - Ask "why" and "how" questions to deepen understanding.
5. **Cognitive Load** - Don't overload. One concept at a time. Chunk information.
6. **Prior Knowledge** - Connect new concepts to what students already know.

# LESSON FLOW

Each concept builds on the previous. Create a narrative arc:

1. **HOOK** - Question or surprising fact that sparks curiosity
2. **RETRIEVE** - Ask what they already know or can predict
3. **EXPLAIN** - Core concept with visual
4. **EXAMPLE** - Concrete, specific application
5. **CONNECT** - Link back to hook, preview what's next
6. **SUMMARY** - Quick retrieval check

# CONCEPT FORMAT

Each concept has TWO separate fields:

1. **script** - What the tutor should SAY (1-3 sentences). End with a question to the student.
2. **visual** - What to draw on the whiteboard (just describe it, NO "draw()" syntax)

IMPORTANT: Do NOT include tool calls like draw() or next_concept() in the script. The tutor will handle tools separately.

# VISUAL HINTS

Speed hints for the visual field:
- "quickly: X" → instant (text/diagram) - use early
- "animate X" → slower, use for core concepts
- "show me X" → image search

# EXAMPLES

GOOD:
{
  "name": "Hook",
  "script": "What do you think happens to water when it's heated? Take a guess!",
  "visual": "quickly: text showing the question 'What happens to heated water?'"
}

{
  "name": "Evaporation",
  "script": "Exactly - it evaporates! The water molecules get so excited they escape into the air. Can you think of where you've seen this happen?",
  "visual": "animate water evaporating from a puddle on a sunny day"
}

BAD (includes tool calls in script):
{
  "name": "Hook",
  "script": "Let me show you evaporation. draw('evaporation diagram')",
  "visual": "evaporation"
}

# GUIDELINES

1. 5-7 concepts that BUILD on each other
2. Script should END with a question to engage the student
3. Visual describes what to show (no draw() syntax)
4. Ask questions BEFORE explaining (retrieval)
5. Use concrete examples, not just definitions
6. Each concept references the previous
"""


def generate_lesson(topic: str) -> dict:
    """
    Generate a lesson plan for the given topic.

    Args:
        topic: The subject/topic to create a lesson for (e.g., "photosynthesis", "quadratic equations")

    Returns:
        Lesson plan as a dictionary matching the JSON schema
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY environment variable not set")

    client = genai.Client(api_key=api_key)

    model = "gemini-flash-lite-latest"

    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=f"Create a lesson plan for: {topic}")]
        )
    ]

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=Lesson,
    )

    start = time.time()
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=config,
    )
    latency = time.time() - start

    # Log token usage if available (to stderr so it doesn't interfere with JSON output)
    if hasattr(response, 'usage_metadata') and response.usage_metadata:
        usage = response.usage_metadata
        input_tokens = getattr(usage, 'prompt_token_count', 0)
        output_tokens = getattr(usage, 'candidates_token_count', 0)
        print(f"[lesson_subagent] Latency: {latency:.2f}s | Tokens: {input_tokens} in, {output_tokens} out", file=sys.stderr)

    # Parse the JSON response
    if response.candidates and len(response.candidates) > 0:
        candidate = response.candidates[0]
        if candidate.content and candidate.content.parts:
            for part in candidate.content.parts:
                if hasattr(part, 'text') and part.text:
                    return json.loads(part.text)

    raise ValueError("Failed to generate lesson plan - no valid response")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python lesson_subagent.py <topic>")
        print('Example: python lesson_subagent.py "photosynthesis"')
        print('Example: python lesson_subagent.py "quadratic equations"')
        sys.exit(1)

    topic = " ".join(sys.argv[1:])
    print(f"Topic: {topic}")
    print("-" * 50)

    try:
        lesson = generate_lesson(topic)
        print(json.dumps(lesson, indent=2))
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
