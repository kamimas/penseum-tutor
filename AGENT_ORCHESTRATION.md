# Agent Orchestration System

## Overview

The Penseum Tutor uses **agent orchestration** to separate real-time conversation from visual rendering decisions. The main realtime agent delegates drawing tasks to a specialized sub-agent.

## Architecture

```
┌─────────────────────────────────────┐
│  Realtime Agent (Gemini realtime)  │
│  - Voice conversation               │
│  - Simple tool: draw(query)         │
│  - Low latency (< 500ms)            │
└──────────────┬──────────────────────┘
               │ draw("red car on hill")
               ↓
┌─────────────────────────────────────┐
│   Draw Sub-Agent (Gemini 3 Flash)  │
│  - Receives natural language        │
│  - Structured prompt + examples     │
│  - Tools: add_text, show_image,     │
│    draw_diagram (flowchart/cycle/   │
│    timeline/mindmap)                │
│  - Returns: [{tool, params}, ...]   │
└──────────────┬──────────────────────┘
               │ JSON tool calls
               ↓
┌─────────────────────────────────────┐
│  Backend (tutor.py)                 │
│  - Publishes to LiveKit             │
│  - Topic: tutor_draw                │
└──────────────┬──────────────────────┘
               │ LiveKit data channel
               ↓
┌─────────────────────────────────────┐
│  Frontend (ExcalidrawToolHandler)  │
│  - Renders shapes on canvas         │
│  - Image search, diagram layout     │
└─────────────────────────────────────┘
```

## Benefits

1. **Low Latency**: Realtime agent has minimal tools, responds instantly
2. **Better Decisions**: Sub-agent uses structured prompt, makes smarter tool choices
3. **Separation of Concerns**: Conversation logic ≠ Visual rendering logic
4. **Flexibility**: Easy to swap models, add new tools, or extend capabilities
5. **Scalability**: Can add more specialized sub-agents (video gen, audio, etc.)

## Implementation

### Phase 1: Draw Sub-Agent (Current) ✓

**Files:**
- `agent/draw_subagent.py` - Sub-agent with function calling
- `frontend/src/app/api/draw/route.ts` - API endpoint
- `frontend/src/app/test-draw/page.tsx` - Test interface

**Sub-Agent Prompt Structure:**
```
1. Role Definition
   - "You are a specialized visual rendering agent..."

2. Tool Descriptions (for each tool)
   - PURPOSE: What it does
   - WHEN TO USE: Specific scenarios
   - WHEN NOT TO USE: What to avoid

3. Decision Framework
   - Step 1: Identify request type
   - Step 2: Choose primary tool
   - Step 3: Consider combinations (optional)

4. Examples (with reasoning)
   INPUT: "draw X"
   REASONING: Why this tool?
   TOOL CALLS: [...]

5. Critical Rules (ALWAYS/NEVER)
   - ALWAYS use position="center" for first element
   - NEVER create abstract diagrams when real images exist
   - ...

6. Edge Cases
   - Ambiguous requests: Default behavior
   - Multiple valid options: Priority order
```

**Testing:**

CLI (standalone):
```bash
cd agent
source venv/bin/activate
python draw_subagent.py "explain photosynthesis"
```

Web (no LiveKit):
```
http://localhost:3000/test-draw
```

API:
```bash
curl -X POST http://localhost:3000/api/draw \
  -H 'Content-Type: application/json' \
  -d '{"query":"draw a red car"}'
```

### Phase 2: Integration with Realtime Agent (Next)

1. Add `draw()` tool to realtime agent
2. Tool calls sub-agent async
3. Returns "Processing..." immediately
4. Sub-agent publishes tool calls to LiveKit
5. Frontend renders

### Future Phases

- **Video Sub-Agent**: Generate educational videos (Manim, animations)
- **Audio Sub-Agent**: Generate sound effects, narration
- **Code Sub-Agent**: Generate code snippets, syntax highlighting
- **3D Sub-Agent**: Generate 3D models, interactive simulations

## Key Design Decisions

### Why Separate Sub-Agent?

**Alternative 1**: Give realtime agent all tools directly
- ❌ Slow: More tools = more tokens = higher latency
- ❌ Poor decisions: Realtime models optimize for speed, not tool choice
- ❌ Hard to maintain: Single massive prompt

**Alternative 2**: Use sub-agent (current)
- ✓ Fast: Realtime agent has 1 simple tool
- ✓ Smart: Sub-agent uses Gemini 3 Flash with structured prompt
- ✓ Maintainable: Separate concerns, clear boundaries

### Why Gemini 3 Flash for Sub-Agent?

- Fast inference (~1-2s for tool decisions)
- Excellent function calling capabilities
- Cost-effective for background processing
- Good at following structured prompts

### Prompt Engineering Principles

Based on Claude's own prompt structure:

1. **Clear Role**: Tell it what it is, what it does
2. **Explicit Guidelines**: Bullet points, specific actions
3. **DO/DON'T Pairs**: ALWAYS/NEVER statements
4. **Rich Examples**: Show exact desired behavior
5. **Tool Clarity**: When and why to use each tool
6. **Edge Cases**: Handle ambiguity explicitly

## Metrics & Monitoring

**Key Metrics to Track:**

- Sub-agent latency (target: < 2s)
- Tool choice accuracy (% correct tool for query type)
- Error rate (failed API calls, invalid JSON)
- Token usage (cost optimization)

**Success Criteria:**

- 95%+ correct tool choices
- < 2s average sub-agent response time
- < 1% error rate

## Next Steps

1. ✓ Build draw sub-agent with structured prompt
2. ✓ Create test page (no LiveKit)
3. ✓ Test API endpoint
4. → Integrate with realtime agent
5. → Add more tools (plot_function, etc.)
6. → Deploy and monitor metrics
7. → Iterate on prompt based on real usage
