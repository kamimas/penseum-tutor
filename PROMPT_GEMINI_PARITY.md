# Continue: Gemini Direct Feature Parity

## Context

We're building `/gemini` - a direct browser-to-Gemini connection that replaces the LiveKit architecture. Core functionality works (voice, canvas streaming, tool calls). Now we need feature parity with the production `/` page.

## What's Done

1. **Tool call loop bug** - Fixed by sending `sendToolResponse()` immediately before async work
2. **Transcriptions** - Added input/output transcription events, displaying in ChatPill
3. **ChatPill visual redesign** - Message bubbles, audio visualizer dots, proper layout matching production

## Files to Read

- `frontend/src/app/experiments/gemini-direct/PLAN.md` - Full progress and gap analysis
- `frontend/src/app/gemini/page.tsx` - The Gemini Direct page (needs feature parity work)
- `frontend/src/app/page.tsx` - Production LiveKit page (reference for features)
- `frontend/src/components/ChatPill.tsx` - Production ChatPill (reference for animations/history)

## What's Left (from PLAN.md)

| Feature | Priority | Notes |
|---------|----------|-------|
| Message history | Medium | Currently clears on turn complete. Need to persist across turns, show last 4 with fade |
| Framer Motion animations | Low | Add smooth transitions for messages, status dot pulse |
| Mode selector | High | Add Guided/Normal selection screen (UI only, no guided lesson logic) |

## Not Implementing

- Pause/Resume - Can't pause Gemini server-side generation
- Speed control - Same reason

## Task

Pick up where we left off. Start with whichever feature makes sense (probably message history or mode selector based on priority).

Key implementation notes:
- `/gemini` page is self-contained, no LiveKit dependencies
- Uses `GeminiLiveClient` from `experiments/gemini-direct/lib/`
- Uses `triggerToolCall` from `ExcalidrawToolHandler` for canvas rendering
- Framer Motion is already installed (used in production ChatPill)
