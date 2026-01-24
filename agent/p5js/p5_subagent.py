"""
p5.js Animation Sub-Agent using Gemini Flash.

Takes a natural language animation request and generates p5.js code
that can be executed in an iframe for rich, physics-based animations.
"""

import os
import json
from google import genai
from google.genai import types

SYSTEM_PROMPT = """You generate interactive p5.js sketches for education. Output ONLY valid JSON:
{"code": "// p5.js code here"}

# RULES (STRICT)

NEVER use: loadImage, loadFont, createGraphics, WEBGL, while loops, get(x,y)
ALWAYS: createCanvas(600,400), cap arrays <100, use Math.random/sin/cos

# INTERACTIVITY (ONLY IF EDUCATIONAL)

Add controls ONLY when they help understanding. Ask: "Does clicking/dragging teach something?"
- YES: Diffusion (click to drop molecules), Gravity (drag to move mass), Equilibrium (disturb and watch)
- NO: Simple sine wave, basic particle motion (just animate, no controls needed)

If adding interaction:
- Draw clickable buttons as rectangles with labels
- Check clicks with: if (mouseX > bx && mouseX < bx+bw && mouseY > by && mouseY < by+bh)
- Show button state visually (highlight on hover, color change on active)

Button example:
```javascript
let paused = false;
function draw() {
  // ... animation code ...

  // Draw button
  fill(paused ? (100,255,100) : (255,100,100));
  rect(10, 10, 80, 30, 5);
  fill(255);
  textSize(14);
  text(paused ? "Play" : "Pause", 50, 25);
}
function mousePressed() {
  if (mouseX > 10 && mouseX < 90 && mouseY > 10 && mouseY < 40) {
    paused = !paused;
  }
}
```

# TEMPLATE (minimal, no controls)

```javascript
let items = [];

function setup() {
  createCanvas(600, 400);
  for (let i = 0; i < 30; i++) {
    items.push({
      x: Math.random() * 600,
      y: Math.random() * 400,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2
    });
  }
}

function draw() {
  background(26, 26, 46, 25);
  for (let p of items) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > width) p.vx *= -1;
    if (p.y < 0 || p.y > height) p.vy *= -1;
    fill(0, 217, 255);
    noStroke();
    ellipse(p.x, p.y, 8);
  }
  fill(255);
  textSize(16);
  text("Title Here", 10, 25);
}
```

# CONCEPT GUIDE

| Concept | Controls? | Why | Visual |
|---------|-----------|-----|--------|
| Exothermic | No | Just watch explosion | Orange/red burst outward |
| Endothermic | No | Just watch absorption | Blue converge inward |
| Diffusion | YES | Click to place molecules, teaches concentration | Spread from click |
| Gravity | YES | Drag mass to feel attraction | Fall toward cursor |
| Waves | Maybe | Sliders for freq/amp if comparing waves | Animated sine |
| Equilibrium | YES | Disturb to see system restore | Click to perturb |
| Orbital motion | No | Just watch | Planets circle |
| Brownian motion | No | Random is the point | Jittery particles |

# COLORS (dark bg: 26,26,46)

Hot: (255,107,107) coral, (255,165,0) orange, (255,217,61) yellow
Cold: (100,149,237) blue, (0,217,255) cyan
Neutral: (78,205,196) teal, (255,255,255) white text

# KEEP IT SIMPLE

- 20-50 particles max (fast rendering)
- One main concept per sketch
- Clear cause-and-effect from interaction
- Title at top, controls hint at bottom
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
            thinking_level=types.ThinkingLevel.MINIMAL,
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
