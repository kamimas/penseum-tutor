# Act Tool Experiment

## Goal
Test if Gemini Live can express tutoring intent through a single `act(intent)` tool instead of multiple specific tools (`draw`, `clear_board`). A smarter text model (act_subagent) interprets the intent into specific tool calls.

## Architecture

```
User speaks
    ↓
Gemini Live (voice model)
    ↓
act("show diagram of photosynthesis")
    ↓
Frontend sends to /api/act
    ↓
Python draw_server.py /act endpoint
    ↓
act_subagent.py (gemini-flash-lite-latest)
    ↓
Returns: [{"tool": "draw_diagram", "params": {...}}]
    ↓
Frontend executes on Excalidraw canvas
```

## Files Created/Modified

### New Files

**`frontend/src/app/experiments/gemini-direct/act-test/page.tsx`**
- Experiment page with Excalidraw canvas
- Single `act(intent)` tool for Gemini Live
- Latency tracking (Voice→Tool, Model, Server, Network, Canvas render)
- Test buttons for different scenarios

**`agent/act_subagent.py`**
- Interprets natural language intents into specific tool calls
- Uses `gemini-flash-lite-latest` for low latency
- Reusable client (avoids cold start per call)
- Returns timing breakdown
- Tools: `clear_board`, `add_text`, `show_image`, `draw_diagram`, `annotate`, `animate`, `draw_function`, `show_question`, `memorize`

**`frontend/src/app/api/act/route.ts`**
- Next.js API route proxying to Python backend

### Modified Files

**`agent/draw_server.py`**
- Added `/act` endpoint
- Added `python-dotenv` for .env loading
- Returns timing breakdown (model_ms, subagent_ms, server_ms)

**`agent/requirements.txt`**
- Added `python-dotenv>=1.0.0`

**`agent/.env`**
- Created with `GOOGLE_API_KEY` and `SERPAPI_API_KEY`

## Configuration

### ACT_TOOL Definition
```typescript
const ACT_TOOL: FunctionDeclaration = {
  name: "act",
  description: "Execute any action on the screen...",
  parameters: {
    type: Type.OBJECT,
    properties: {
      intent: {
        type: Type.STRING,
        description: "Natural language description of the screen action...",
      },
    },
    required: ["intent"],
  },
  behavior: Behavior.NON_BLOCKING,  // Speak while act() runs in parallel
};
```

### Tool Response
```typescript
// Send IMMEDIATELY at start of handler (matches production)
clientRef.current?.sendToolResponse(toolCallId, "act", "Done.", FunctionResponseScheduling.SILENT);
```

### System Prompt (Gemini Live)
```
# CRITICAL RULES
1. EVERY response must include act()
2. Call act() FIRST, then speak - they run in parallel
3. Do NOT react to act() results - just keep talking, the visual appears automatically
4. act() should COMPLEMENT your speech, not duplicate it
5. Show visuals that ADD information - don't repeat what you're saying
```

### Act Subagent Prompt
```
# RULES
1. Call exactly ONE tool - NEVER more than one
2. If intent has multiple things, pick the most important ONE
3. No text output, just the single tool call
4. Best-guess if unclear - never fail
```

## Latency Optimizations

1. **Reusable GenAI client** - Created once, reused across calls
2. **Faster model** - `gemini-flash-lite-latest` instead of `gemini-flash-latest`
3. **Single tool enforcement** - `break` + `[:1]` slice in Python
4. **Immediate tool response** - Sent before processing starts
5. **NON_BLOCKING behavior** - Voice and visuals run in parallel

## Latency Breakdown (typical)

```
Voice → Tool: ~30ms (from last audio chunk)
Model: ~300-500ms (act_subagent inference)
Server: ~350-550ms (total Python time)
Network: ~30-50ms (round-trip overhead)
Canvas render: ~100ms
Total act(): ~500-700ms
```

## Intent → Tool Mapping

| Intent Pattern | Tool |
|---|---|
| clear/reset/fresh | `clear_board()` |
| show image/photo | `show_image(query)` |
| diagram/flowchart/cycle | `draw_diagram(type, nodes)` |
| graph/plot/function | `draw_function(expression)` |
| animate/show how | `animate(prompt)` |
| circle/highlight/arrow | `annotate(shape, target)` |
| quiz/question | `show_question(type, question, options)` |
| write/display/formula | `add_text(content)` |
| remember/note that | `memorize(key, value)` |

## Running the Experiment

```bash
# Terminal 1: Python server
cd agent
pip install -r requirements.txt
uvicorn draw_server:app --port 5001

# Terminal 2: Next.js frontend
cd frontend
npm run dev

# Browser
http://localhost:3000/experiments/gemini-direct/act-test
```

## Key Learnings

1. **NON_BLOCKING + SILENT** - Best for parallel voice/visuals
2. **Immediate tool response** - Prevents Gemini from waiting/retrying
3. **Complementary prompting** - Voice explains, screen shows visuals (not duplicate text)
4. **Single tool per intent** - Faster, simpler, more predictable
5. **Reusable client** - Significant latency reduction on subsequent calls
