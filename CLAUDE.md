# CLAUDE.md

## Project Overview

Penseum Tutor is a real-time multimodal AI tutoring platform:
- Next.js frontend with Excalidraw whiteboard canvas
- Python agent using LiveKit for real-time audio/video
- Gemini Realtime API for voice + vision
- Agent orchestration: Realtime tutor delegates to specialized sub-agents

## Development Commands

```bash
# Full Stack (Docker)
docker-compose up --build

# Frontend Only
cd frontend && npm install && npm run dev

# Agent Only
cd agent && source venv/bin/activate && python tutor.py dev
```

## Architecture

```
Realtime Tutor (Gemini)
  ├── Voice conversation + video input
  └── Tools: draw(query), clear_board

draw(query) → Frontend
  ├── Captures canvas screenshot
  ├── Calls /api/draw → Draw Sub-Agent (Gemini 3 Flash)
  └── Renders returned tool calls

Draw Sub-Agent Tools:
  - add_text(content, size, position)
  - show_image(query, position)
  - draw_diagram(type, nodes, direction)
  - annotate(shape, x, y, width, height, target)
  - animate(prompt, position) → p5.js iframe
```

## Key Files

```
agent/
├── tutor.py                 # Main realtime agent
├── draw_subagent.py         # R&D version (CLI testing)
├── draw_subagent_live.py    # Production version
├── p5js/p5_subagent.py      # p5.js animation generator
├── prompt_normal_gemini.txt # Tutor system prompt
└── prompt_guided.txt        # Guided lesson prompt

frontend/src/
├── app/page.tsx                        # Main entry
├── app/api/draw/route.ts               # Draw sub-agent API
├── app/api/p5/route.ts                 # p5.js animation API
├── app/test-draw/page.tsx              # Test page (no LiveKit)
├── app/test-p5/page.tsx                # p5.js test page
└── components/ExcalidrawToolHandler.tsx # Tool rendering
```

## Environment Variables

```
LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
GOOGLE_API_KEY          # Gemini Realtime + Sub-agents
SERPAPI_API_KEY         # Image search
```

## Current Priorities

### 1. Animate Drawing Actions (High) - IN PROGRESS
Make annotations feel hand-drawn instead of instant.

**Status:** R&D in progress on test-draw page.

**What works:**
- `AnimatedAnnotation` component uses Framer Motion SVG `pathLength` animation
- Circle draws progressively over 0.6s with wobbly hand-drawn path
- Test button "Animated Circle" on `/test-draw` page

**Current approach (testing):**
Using Excalidraw's `freedraw` element type which accepts custom `points` array.
Found in SDK: `newFreeDrawElement({ type: "freedraw", points, simulatePressure })`.

Plan:
1. Animate SVG overlay (visual feedback)
2. On complete, create `freedraw` element with same points
3. Remove SVG overlay → element is now native/selectable

**Files:**
- `frontend/src/components/AnimatedAnnotation.tsx` - Framer Motion SVG component
- `frontend/src/app/test-draw/page.tsx` - R&D test page with manual trigger buttons

**Reference:** Excalidraw types at `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/element/`

### 2. P5.js Prompt Optimization (Medium)
`agent/p5js/p5_subagent.py` has 500+ line prompt. Trim redundant examples to speed up generation.

### 3. P5.js Iframe Deletable (Low)
Overlays stored in `animationOverlays` Map. Add close button or `delete_animation` tool.
Currently only `clear_board` removes all animations.

## Testing

```bash
# Test draw sub-agent
cd agent && python draw_subagent.py "explain photosynthesis"

# Test p5.js animations
cd agent && python p5js/p5_subagent.py "animate an exothermic reaction"

# Test pages (no LiveKit needed)
http://localhost:3000/test-draw
http://localhost:3000/test-p5
```
