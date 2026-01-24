"""
p5.js Animation Sub-Agent using Gemini Flash.

Takes a natural language animation request and generates p5.js code
that can be executed in an iframe for rich, physics-based animations.
"""

import os
import json
from google import genai
from google.genai import types

SYSTEM_PROMPT = """You generate interactive p5.js sketches for education.

OUTPUT ONLY valid JSON (no prose/markdown):
{"code":"// p5.js code"}

HARD RULES
- Must call createCanvas(600,400) in setup.
- Never use: loadImage, loadFont, createGraphics, WEBGL, while loops, get(x,y).
- Keep it fast: 20–50 particles max; any array <100; avoid nested loops over particles.
- Use Math.random / sin / cos. Declare all variables with let/const.

INTERACTIVITY (only if it teaches)
- Add interaction only when it clarifies cause→effect (diffusion click-drop, gravity drag-mass, equilibrium perturb).
- Otherwise, no controls.
- If controls exist: draw rectangle buttons with labels; click hitbox:
  if (mouseX>bx && mouseX<bx+bw && mouseY>by && mouseY<by+bh)
- Show state visually (hover/active changes).

VISUAL BASELINE
- Dark background (26,26,46), readable white title at top.
- If controls exist, hint text at bottom.
- One concept per sketch.

GOOD OUTPUT EXAMPLE (shape only)
{"code":"function setup(){createCanvas(600,400);} function draw(){background(26,26,46); fill(255); text('Diffusion',10,25);}"}

BAD OUTPUT EXAMPLE (never do this)
- Any text outside JSON
- ```code fences```
- Using WEBGL/loadImage/while loops
"""


def generate_p5_animation(prompt: str) -> dict:
    """
    Generate p5.js animation code from a natural language prompt.

    Args:
        prompt: Natural language description of desired animation

    Returns:
        dict with 'code' key containing p5.js sketch code
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY environment variable not set")

    client = genai.Client(api_key=api_key)

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        thinking_config=types.ThinkingConfig(
            thinking_budget=0,
        ),
    )

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[types.Content(
            role="user",
            parts=[types.Part.from_text(text=f"Generate p5.js animation for: {prompt}")]
        )],
        config=config,
    )

    text = response.text.strip()

    # Handle markdown code blocks
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    try:
        result = json.loads(text)
        if "code" not in result:
            raise ValueError("Response missing 'code' key")
        return result
    except json.JSONDecodeError as e:
        return {
            "code": "",
            "error": str(e),
            "raw": text[:500]
        }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python p5_subagent.py <prompt>")
        print('Example: python p5_subagent.py "animate an exothermic reaction"')
        sys.exit(1)

    prompt = " ".join(sys.argv[1:])
    print(f"Prompt: {prompt}")
    print("-" * 50)

    try:
        result = generate_p5_animation(prompt)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
