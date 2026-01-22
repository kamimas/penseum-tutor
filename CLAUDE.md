# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Penseum Tutor is a real-time multimodal AI tutoring platform combining:
- React/Next.js frontend with an interactive tldraw whiteboard canvas
- Python-based AI agent backend using LiveKit for real-time audio/video communication
- OpenAI Realtime API for speech synthesis
- Custom shape utilities for rendering LaTeX, plots, tables, flowcharts, and images

## Development Commands

### Full Stack (Docker)
```bash
docker-compose up          # Start frontend (port 3000) and agent
docker-compose up --build  # Rebuild and start
```

### Frontend Only
```bash
cd frontend
npm install
npm run dev    # Development server on port 3000
npm run build  # Production build
```

### Agent Only
```bash
cd agent
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python tutor.py dev  # Run agent in dev mode
```

## Architecture

```
penseum-tutor/
├── frontend/                 # Next.js 14 App Router
│   ├── app/
│   │   ├── page.tsx         # Main entry - LiveKit room setup, StatusBar
│   │   ├── api/
│   │   │   ├── token/       # LiveKit token generation
│   │   │   └── image-search/# SerpAPI image search proxy
│   │   └── components/
│   │       ├── TutorCanvas.tsx      # Main canvas, tool handlers, LayoutManager
│   │       └── shapes/              # Custom tldraw shape utilities
│   │           ├── LatexShapeUtil   # KaTeX math rendering
│   │           ├── PlotShapeUtil    # function-plot graphs
│   │           ├── TableShapeUtil   # Comparison tables
│   │           ├── FlowchartShapeUtil
│   │           └── TutorImageShapeUtil
│   └── package.json
│
├── agent/                    # Python LiveKit agent
│   ├── tutor.py             # Main agent - tool definitions, LLM coordination
│   ├── lesson.json          # Lesson structure with concepts array
│   ├── prompt.txt           # System prompt for tutor behavior
│   └── requirements.txt
│
├── docker-compose.yml        # Multi-service orchestration
└── .env                      # API keys (LiveKit, OpenAI, xAI, SerpAPI)
```

## Data Flow

1. Frontend generates LiveKit token via `/api/token`
2. User joins LiveKit room; agent joins same room
3. Agent processes audio input via OpenAI Realtime API
4. Agent publishes tool calls as JSON via LiveKit data channel (topic: `tutor_draw`)
5. TutorCanvas receives tool calls and renders shapes on whiteboard
6. LayoutManager auto-positions content vertically with auto-scroll

## Tool Call Protocol

Agent publishes JSON to `tutor_draw` topic:
```json
{ "tool": "tool_name", "params": { ... } }
```

Available tools:
- `add_text(content, size)` - Text/LaTeX (auto-detects LaTeX patterns)
- `show_image(query)` - Image search and display
- `draw_table(headers, rows)` - Comparison tables
- `draw_flowchart(steps)` - Process flow diagrams
- `plot_function(equation)` - Mathematical function graphs
- `clear_board()` - Reset canvas
- `next_concept()` - Progress to next lesson concept
- `finish_lesson()` - End lesson, enable Q&A

## Environment Variables

Required in `.env`:
- `LIVEKIT_URL` - LiveKit server WebSocket URL
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` - LiveKit credentials
- `OPENAI_API_KEY` - For OpenAI Realtime API
- `GOOGLE_API_KEY` - For Gemini Realtime API
- `SERPAPI_API_KEY` - For image search

## Switching Between OpenAI and Gemini

The agent supports both OpenAI Realtime and Gemini Realtime models.

### File Structure
```
agent/
├── tutor.py                    # Main agent (currently Gemini)
├── tutor_openai.py             # OpenAI version backup
├── prompt_normal.txt           # Generic prompt
├── prompt_normal_openai.txt    # OpenAI-specific prompt
└── prompt_normal_gemini.txt    # Gemini-specific prompt (currently active)
```

### To Switch Models

**Switch to Gemini:**
1. In `tutor.py`, change imports to `from livekit.plugins import google`
2. Change `PROMPT_NORMAL_FILE` to `prompt_normal_gemini.txt`
3. Use `google.realtime.RealtimeModel(...)` with Gemini model name
4. Add `GOOGLE_API_KEY` to `.env`

**Switch to OpenAI:**
1. In `tutor.py`, change imports to `from livekit.plugins import openai`
2. Change `PROMPT_NORMAL_FILE` to `prompt_normal_openai.txt`
3. Use `openai.realtime.RealtimeModel(...)` with OpenAI model name
4. Add `OPENAI_API_KEY` to `.env`

### OpenAI Realtime
```python
from livekit.plugins import openai
from openai.types import realtime as openai_realtime

session = AgentSession(
    llm=openai.realtime.RealtimeModel(
        model="gpt-realtime",
        voice="ash",  # Options: ash, ballad, coral, sage, verse
        input_audio_transcription=openai_realtime.AudioTranscription(
            model="gpt-4o-transcribe",
        ),
    ),
    allow_interruptions=True,
)
```

### Gemini Realtime
```python
from livekit.plugins import google
from google.genai import types

session = AgentSession(
    llm=google.realtime.RealtimeModel(
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        voice="Puck",  # Star names: Puck, Charon, Kore, Aoede, Fenrir, etc.
        input_audio_transcription=types.AudioTranscriptionConfig(),
        # Optional tool behavior settings:
        # tool_behavior=types.Behavior.BLOCKING,  # Wait for tool before continuing
        # tool_response_scheduling=types.FunctionResponseScheduling.WHEN_IDLE,
    ),
    allow_interruptions=True,
)
```

### Key Differences

| Feature | OpenAI | Gemini |
|---------|--------|--------|
| Env var | `OPENAI_API_KEY` | `GOOGLE_API_KEY` |
| Voices | ash, ballad, coral, sage, verse | Puck, Charon, Kore, Aoede, etc. |
| Speed control | Yes (`speed=1.0`) | No |
| Tool behavior | Manual (`manual_function_calls=True`) | Auto (`auto_tool_reply_generation=True`) |
| Message truncation | Yes | No |

### Gemini Tool Behavior Options

**`tool_behavior`** - How model handles tool calls:
- `BLOCKING` - Wait for tool response before continuing (default)
- `NON_BLOCKING` - Continue talking while tool executes

**`tool_response_scheduling`** - What happens when tool responds:
- `SILENT` - Add to context only, no generation
- `WHEN_IDLE` - Generate when model isn't talking (default)
- `INTERRUPT` - Interrupt current speech and respond

## Key Implementation Notes

- **M1/M2/M3 Mac**: Agent Docker uses `platform: linux/amd64` for compatibility
- **LaTeX Detection**: Regex patterns detect `\commands`, `^{}`, `$...$`, `$$...$$`
- **Tool Logging**: All tool calls logged to `agent/tool_calls.log`
- **Interruptions**: Agent session allows user to interrupt mid-speech
