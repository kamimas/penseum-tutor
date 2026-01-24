# CLAUDE.md

## Project Overview

Penseum Tutor: Real-time multimodal AI tutoring platform with Next.js frontend (Excalidraw whiteboard), Python agent (LiveKit), and Gemini Realtime API.

## Commands

```bash
# Full Stack
docker-compose up --build

# Frontend Only
cd frontend && npm install && npm run dev

# Agent Only
cd agent && source venv/bin/activate && python tutor.py dev

# Testing (no LiveKit needed)
cd agent && python draw_subagent.py "explain photosynthesis"
cd agent && python p5js/p5_subagent.py "animate an exothermic reaction"
# http://localhost:3000/test-draw
# http://localhost:3000/test-p5
```

## Architecture

```
Realtime Tutor (Gemini)
  ├── Voice conversation + video input
  └── Tools: draw(query), clear_board

draw(query) → Frontend → /api/draw → Draw Sub-Agent (Gemini Flash)

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
├── tutor.py              # Main realtime agent
├── draw_subagent.py      # R&D version (CLI testing)
├── draw_subagent_live.py # Production version
└── p5js/p5_subagent.py   # p5.js animation generator

frontend/src/
├── app/page.tsx                         # Main entry
├── app/api/draw/route.ts                # Draw sub-agent API
├── app/api/p5/route.ts                  # p5.js animation API
├── app/test-draw/page.tsx               # Test page
└── components/ExcalidrawToolHandler.tsx # Tool rendering
```

## Environment Variables

```
LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
GOOGLE_API_KEY   # Gemini Realtime + Sub-agents
SERPAPI_API_KEY  # Image search
```

## Current Priorities

1. **Animate Drawing Actions (High)** - Make annotations feel hand-drawn. R&D in `AnimatedAnnotation.tsx` using Framer Motion SVG + Excalidraw `freedraw` elements.
2. **P5.js Prompt Optimization (Medium)** - Trim `p5_subagent.py` 500+ line prompt.
3. **P5.js Iframe Deletable (Low)** - Add close button to animation overlays.
