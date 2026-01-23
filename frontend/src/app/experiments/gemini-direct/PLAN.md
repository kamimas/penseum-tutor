# Gemini Direct: Replacing LiveKit with Direct Browser-to-Gemini Connection

## Goal
Replace LiveKit's WebRTC infrastructure with direct browser-to-Gemini WebSocket connections for lower latency and simpler architecture.

**Success Metric:** Achieve latency comparable to or faster than current LiveKit implementation (~150-300ms mouth-to-ear).

---

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | **COMPLETE** | Voice conversation working |
| Phase 2 | **COMPLETE** | Screen sharing working (simplified from canvas) |
| Phase 3 | **COMPLETE** | Tool calling working (tested with image_search) |
| Phase 4 | **COMPLETE** | Moved to production-style page at `/gemini` |
| Production Integration | **COMPLETE** | Core functionality working |
| Feature Parity | **COMPLETE** | Message history, Framer Motion animations, status transitions |
| **Video/Vision** | **NEEDS VERIFICATION** | Canvas streaming implemented but not verified working in production |

---

## Current Status: `/gemini` Page

### What's Working
- **Voice conversation** - Connects directly to Gemini, mic input works
- **Canvas streaming** - 1 FPS JPEG frames sent to Gemini via `sendImage()` (implemented in `GeminiCanvasStreamer`)
- **Tool calls** - `draw()` and `clear_board()` tools trigger correctly
- **Canvas capture** - Screenshot returns proper size using `.excalidraw__canvas` selector
- **Tool execution** - `/api/draw` returns tool calls, they render on Excalidraw
- **UI** - Production-style ChatPill layout with message bubbles, Framer Motion animations, audio visualizer dots
- **Transcriptions** - Real-time display of user and AI speech with message history (last 4 messages with fade)
- **Message history** - Messages persist across turns with smooth animations

### Needs Verification
- **Vision/Video** - Canvas frames are being sent but need to verify Gemini actually receives and processes them

### Fixed: Tool Call Loop Bug

**Problem:** Tool calls fired repeatedly (10+ times) instead of once.

**Root cause:** With `NON_BLOCKING` behavior, Gemini continues generating while waiting for tool response. If the response takes too long (e.g., waiting for `/api/draw` to complete), Gemini retries the tool call.

**Solution:** Send `sendToolResponse()` immediately when tool call arrives, before async work begins. The actual drawing happens in background - Gemini doesn't need to wait since we use `SILENT` scheduling anyway.

---

## Feature Parity Status (COMPLETE)

The `/gemini` page now matches production features (excluding LiveKit-specific features).

### Feature Comparison

| Feature | Production `/` | `/gemini` | Status |
|---------|---------------|-----------|--------|
| Voice conversation | ✅ | ✅ | Done |
| Canvas vision | ✅ | ⚠️ | **Needs verification** |
| Tool calls (draw, clear_board) | ✅ | ✅ | Done |
| Transcriptions | ✅ Message history | ✅ Message history | Done |
| Framer Motion animations | ✅ Smooth transitions | ✅ Smooth transitions | Done |
| Mode selector (Guided/Normal) | ✅ | ❌ | Deferred (not needed for testing) |
| Guided lesson tools | ✅ next_concept, finish_lesson | ❌ | Deferred |
| Pause/Resume button | ✅ | N/A | Not applicable |
| Speed control (1x, 1.25x, etc) | ✅ | N/A | Not applicable |

### Not Applicable for Gemini Direct

- **Pause/Resume** - Gemini Direct streams audio directly, can't pause server-side generation
- **Speed control** - Same reason, speed is controlled by Gemini server

---

## Video/Vision Investigation

### Current Implementation

The video feed is implemented in `GeminiCanvasStreamer` component ([page.tsx:440-496](frontend/src/app/gemini/page.tsx#L440-L496)):

1. **Canvas Capture** - Captures `.excalidraw__canvas` element
2. **Resize** - Scales to max 1024x1024 if needed
3. **JPEG Encoding** - Converts to JPEG at 70% quality
4. **Send to Gemini** - Calls `client.sendImage(base64)` at 1 FPS

### Knowns

1. ✅ `GeminiCanvasStreamer` component exists and is rendered when `excalidrawAPI` and `client` are ready
2. ✅ `sendImage()` method in `GeminiLiveClient` uses `sendRealtimeInput({ media: { mimeType: "image/jpeg", data } })`
3. ✅ Canvas selector `.excalidraw__canvas` is the same one that works for tool screenshots
4. ✅ The interval is set to 1000ms (1 FPS)
5. ✅ Phase 2 experiment (screen share) confirmed vision worked with same SDK

### Unknowns / To Verify

1. ❓ **Is the canvas element found?** - Need console log to confirm
2. ❓ **Is `sendImage()` actually being called?** - Need console log for each frame sent
3. ❓ **What's the frame size?** - Previous issue was 3-byte screenshots
4. ❓ **Does Gemini acknowledge receiving images?** - Ask "what do you see?" test
5. ❓ **Is the client connected when streaming starts?** - Timing issue possible
6. ❓ **Are there any SDK errors being silently swallowed?**

### Debug Plan

1. ✅ Add console.log to `GeminiCanvasStreamer.captureAndSend()` to log:
   - Whether canvas element was found
   - Size of the base64 string being sent
   - Whether `client.sendImage()` is called

2. ✅ Add console.log to `GeminiLiveClient.sendImage()` to confirm it's being invoked

3. ✅ Add log event listener in GeminiRoom to see client logs

4. ⬜ Manual test: Draw something on canvas, ask Gemini "what do you see on the whiteboard?"

### Fixes Applied

1. **Fixed conditional rendering of GeminiCanvasStreamer** - Was checking `clientRef.current` (a ref that doesn't trigger re-renders) instead of `connectionState` (state). Now uses: `connectionState === "connected" && clientRef.current`

2. **Added debug logging** - Comprehensive console.logs in both the streamer component and the client's sendImage method

### What to Look for in Console

When testing, check the browser console for:
```
[GeminiCanvasStreamer] useEffect triggered {hasExcalidrawAPI: true, hasClient: true, clientState: "connected"}
[GeminiCanvasStreamer] Starting canvas streaming at 1 FPS
[GeminiCanvasStreamer] Frame #1: XXXXX bytes, WxH
[GeminiClient:client] Sending image: XXXXX bytes
```

If you see "Not starting - conditions not met", that indicates a timing/rendering issue.

---

### Files

**Main page:** `frontend/src/app/gemini/page.tsx`
- Self-contained, no LiveKit dependencies
- Uses `GeminiLiveClient` from experiments/gemini-direct/lib
- Uses `triggerToolCall` from ExcalidrawToolHandler for rendering

**Shared libs (from experiments):**
- `experiments/gemini-direct/lib/GeminiLiveClient.ts` - WebSocket client
- `experiments/gemini-direct/lib/AudioCapture.ts` - Mic → PCM 16kHz
- `experiments/gemini-direct/lib/AudioPlayback.ts` - PCM 24kHz → speakers

---

## Architecture Comparison

| Component | LiveKit (production `/`) | Gemini Direct (`/gemini`) |
|-----------|--------------------------|---------------------------|
| Voice connection | Browser → LiveKit → Python → Gemini | Browser → Gemini directly |
| Canvas vision | ExcalidrawStreamer → LiveKit video track | GeminiCanvasStreamer → sendImage() |
| Tool calls | Python agent sends via data channel | Gemini toolCall event → handleDrawToolCall |
| Audio playback | RoomAudioRenderer (LiveKit) | AudioPlayback class |
| Mic capture | LiveKit audio track | AudioCapture class |
| Backend needed | Yes (Python agent + LiveKit server) | No (only /api/draw for sub-agent) |

---

## Old Phase 4 Status (Deprecated)

The `/experiments/gemini-direct/phase4` page had canvas capture issues (3-byte screenshots). This was fixed by:
1. Moving to production-style page at `/gemini`
2. Using the same `document.querySelector(".excalidraw__canvas").toDataURL()` pattern as `/test-draw`
3. Ensuring Excalidraw CSS is imported

### Files Created

```
frontend/src/app/experiments/gemini-direct/
├── PLAN.md
├── page.tsx                     # Index page with links to phases
├── lib/
│   ├── GeminiLiveClient.ts      # @google/genai SDK wrapper (with tool support + scheduling)
│   ├── AudioCapture.ts          # Microphone → PCM 16kHz (AudioWorklet)
│   ├── AudioPlayback.ts         # PCM 24kHz → speakers
│   └── ScreenCapture.ts         # Screen share → JPEG frames
├── phase1/
│   └── page.tsx                 # Voice-only conversation
├── phase2/
│   └── page.tsx                 # Voice + screen share
├── phase3/
│   └── page.tsx                 # Voice + tool calling (image_search)
└── phase4/
    └── page.tsx                 # Full Excalidraw + draw()/clear_board() tools
```

### Key Decisions
- Used `@google/genai` npm package instead of raw WebSocket (handles protocol correctly)
- Model: `models/gemini-2.5-flash-native-audio-preview-09-2025` (same as Python agent)
- Phase 2 uses screen share instead of canvas streaming (simpler, proves the concept)
- Phase 3 tested tool calling with simpler `image_search` tool before full draw integration
- Tool response format: `{ output: string }` wrapped by sendToolResponse method

---

## Current Architecture (LiveKit)

```
Browser ←→ LiveKit Server (WebRTC) ←→ Python Agent ←→ Gemini Live API
```

- Audio/video goes through LiveKit's WebRTC infrastructure
- Python agent manages Gemini session
- Data channels for tool calls
- ~150-300ms latency due to multiple hops

## Target Architecture (Gemini Direct)

```
Browser ←→ Gemini Live API (WebSocket direct)
    ↓
Backend (HTTP only for tool execution)
```

- Browser connects directly to Gemini via WebSocket
- No intermediate audio/video proxying
- Backend only handles tool execution (/api/draw)
- Target: 50-150ms latency

---

## Phases

### Phase 1: Speech-to-Speech (No Video, No Tools)
**Goal:** Establish basic voice conversation with Gemini directly from browser.

### Phase 2: Add Video/Canvas Streaming
**Goal:** Send Excalidraw canvas frames to Gemini for vision capabilities.

### Phase 3: Add Tool Calling
**Goal:** Implement draw() tool with backend integration.

### Phase 4: Full Integration & Comparison
**Goal:** Replace LiveKit entirely, measure latency, ensure feature parity.

---

## Phase 1: Speech-to-Speech

### Objective
Create a minimal page that:
1. Connects to Gemini Live API via WebSocket from browser
2. Captures microphone audio, sends to Gemini
3. Receives audio responses, plays through speakers
4. Displays transcriptions

### Files to Create

```
frontend/src/app/experiments/gemini-direct/
├── PLAN.md                          # This file
├── lib/
│   ├── GeminiLiveClient.ts          # WebSocket client for Gemini (shared)
│   ├── AudioCapture.ts              # Microphone → PCM 16kHz (shared)
│   ├── AudioPlayback.ts             # PCM 24kHz → speakers (shared)
│   └── worklets/
│       ├── audio-capture-worklet.js # AudioWorklet for low-latency capture
│       └── audio-playback-worklet.js# AudioWorklet for low-latency playback (optional)
├── phase1/
│   └── page.tsx                     # Next.js page at /experiments/gemini-direct/phase1
├── phase2/
│   └── page.tsx                     # Phase 2 page
└── phase3/
    └── page.tsx                     # Phase 3 page
```

### Technical Specifications

#### Audio Formats (from Gemini SDK)
- **Input:** PCM 16-bit, 16kHz, mono
- **Output:** PCM 16-bit, 24kHz, mono

#### WebSocket Connection
```
URL: wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent

Setup Message:
{
  "setup": {
    "model": "models/gemini-2.5-flash-preview-native-audio-dialog",
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "speechConfig": {
        "voiceConfig": {
          "prebuiltVoiceConfig": { "voiceName": "Charon" }
        }
      }
    }
  }
}
```

#### Message Types

**Client → Server:**
```typescript
// Realtime audio input
{
  "realtimeInput": {
    "mediaChunks": [{
      "mimeType": "audio/pcm;rate=16000",
      "data": "<base64 encoded PCM>"
    }]
  }
}

// Activity signals (for interruption)
{ "realtimeInput": { "activityStart": {} } }
{ "realtimeInput": { "activityEnd": {} } }
```

**Server → Client:**
```typescript
// Setup complete
{ "setupComplete": { "sessionId": "..." } }

// Audio response
{
  "serverContent": {
    "modelTurn": {
      "parts": [{
        "inlineData": {
          "mimeType": "audio/pcm;rate=24000",
          "data": "<base64 encoded PCM>"
        }
      }]
    }
  }
}

// Transcriptions
{
  "serverContent": {
    "inputTranscription": { "text": "user said..." },
    "outputTranscription": { "text": "model said..." }
  }
}

// Turn complete
{ "serverContent": { "turnComplete": true } }
```

### Implementation Prompt for Phase 1

```
## Task: Implement Phase 1 - Speech-to-Speech

Create a minimal Gemini Direct voice chat implementation.

### Context
- This is an experiment to replace LiveKit with direct Gemini connections
- Read PLAN.md at frontend/src/experiments/gemini-direct/PLAN.md for full context
- API key is hardcoded for testing (will be in .env as NEXT_PUBLIC_GOOGLE_API_KEY)

### Reference Code Locations

**LiveKit's Gemini Plugin (Python) - How they handle the connection:**
- agent/venv/lib/python3.13/site-packages/livekit/plugins/google/realtime/realtime_api.py
  - Lines 543-563: push_audio() - how audio is formatted and sent
  - Lines 556-563: push_video() - how video frames are sent
  - Lines 876-926: _build_connect_config() - connection configuration
  - Lines 751-795: _send_task() - message sending patterns
  - Lines 798-874: _recv_task() - message receiving patterns

**Google's Gemini SDK (Python) - WebSocket protocol:**
- agent/venv/lib/python3.13/site-packages/google/genai/live.py
  - Lines 240-343: send_realtime_input() - realtime input message format
  - Lines 430-457: receive() - response handling
  - Lines 889-1120: connect() - WebSocket URL construction and setup

**Google's Reference Implementation (Browser):**
- https://github.com/google-gemini/live-api-web-console
- Key patterns: AudioWorklet for capture, Web Audio API for playback

### Files to Create

1. **frontend/src/experiments/gemini-direct/phase1/page.tsx**
   - Simple UI: Connect button, status indicator, transcription display
   - Use React hooks for state management
   - Route: /experiments/gemini-direct/phase1

2. **frontend/src/experiments/gemini-direct/phase1/GeminiLiveClient.ts**
   - Class that manages WebSocket connection to Gemini
   - Methods: connect(), disconnect(), sendAudio(), sendActivityStart(), sendActivityEnd()
   - Events: onSetupComplete, onAudio, onTranscription, onTurnComplete, onError
   - Handle reconnection logic

3. **frontend/src/experiments/gemini-direct/phase1/AudioCapture.ts**
   - Use AudioWorklet for low-latency capture
   - Resample to 16kHz mono if needed
   - Output: Base64 encoded PCM chunks (50ms chunks = 1600 samples)
   - Events: onAudioData, onVolumeLevel

4. **frontend/src/experiments/gemini-direct/phase1/AudioPlayback.ts**
   - Use Web Audio API with AudioBufferSourceNode
   - Accept base64 PCM 24kHz input
   - Buffer management to prevent gaps
   - Methods: addPCM16(), stop(), resume()

5. **frontend/src/experiments/gemini-direct/phase1/worklets/audio-capture-worklet.js**
   - Process microphone input
   - Convert Float32 to Int16 PCM
   - Emit chunks at regular intervals

### Key Implementation Details

**Audio Format Conversion (Float32 → Int16):**
```javascript
// In AudioWorklet
const int16 = new Int16Array(float32.length);
for (let i = 0; i < float32.length; i++) {
  const s = Math.max(-1, Math.min(1, float32[i]));
  int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
}
```

**Base64 Encoding:**
```javascript
const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
```

**Resampling (if needed):**
- Browser usually captures at 44.1kHz or 48kHz
- Need to resample to 16kHz for Gemini
- Use OfflineAudioContext or simple linear interpolation

**Interruption Handling:**
- When user starts speaking (VAD or always-on), send activityStart
- Stop audio playback immediately
- Gemini will stop generating and listen

### Testing Checklist
- [ ] WebSocket connects successfully
- [ ] Setup message sent and setupComplete received
- [ ] Microphone audio captured and sent
- [ ] Audio responses received and played
- [ ] Transcriptions displayed
- [ ] Interruption works (user can interrupt agent)
- [ ] Reconnection works after disconnect
- [ ] Measure and log latency (time from speech end to first audio response)

### Success Criteria
- Voice conversation works smoothly
- Latency feels natural (< 500ms response start)
- No audio glitches or gaps
- Transcriptions appear in real-time
```

---

## Phase 2: Add Video/Canvas Streaming

### Objective
Add ability to send canvas/video frames to Gemini for vision capabilities.

### Files to Create/Modify

```
frontend/src/experiments/gemini-direct/
├── phase2/
│   ├── page.tsx                     # Page with Excalidraw + voice
│   ├── GeminiLiveClient.ts          # Extended with video support
│   ├── CanvasStreamer.ts            # Canvas → JPEG frames
│   └── ... (copy audio files from phase1)
```

### Technical Specifications

#### Video Format (from Gemini SDK)
- **Format:** JPEG
- **Max Resolution:** 1024x1024
- **Quality:** 75
- **Frame Rate:** 1 FPS (adjustable)

#### Video Message Format
```typescript
{
  "realtimeInput": {
    "mediaChunks": [{
      "mimeType": "image/jpeg",
      "data": "<base64 encoded JPEG>"
    }]
  }
}
```

### Implementation Prompt for Phase 2

```
## Task: Implement Phase 2 - Add Video/Canvas Streaming

Extend Phase 1 to include canvas streaming to Gemini.

### Context
- Phase 1 is complete with working speech-to-speech
- Now adding video input so Gemini can see the canvas
- Read PLAN.md for full context

### Reference Code Locations

**LiveKit's Canvas Streaming:**
- frontend/src/components/ExcalidrawStreamer.tsx
  - How current implementation captures canvas at 1 FPS
  - Uses captureStream() and publishes as screen share track

**LiveKit's Gemini Plugin - Video Handling:**
- agent/venv/lib/python3.13/site-packages/livekit/plugins/google/realtime/realtime_api.py
  - Lines 556-563: push_video() - image encoding and sending
  - Lines 38-42: DEFAULT_IMAGE_ENCODE_OPTIONS - JPEG settings

**Google's Gemini SDK:**
- agent/venv/lib/python3.13/site-packages/google/genai/live.py
  - Lines 240-343: send_realtime_input() - supports video parameter

### Files to Create

1. **frontend/src/experiments/gemini-direct/phase2/page.tsx**
   - Include Excalidraw component
   - Voice chat + canvas visible to Gemini
   - Toggle for canvas streaming on/off

2. **frontend/src/experiments/gemini-direct/phase2/CanvasStreamer.ts**
   - Capture Excalidraw canvas periodically
   - Convert to JPEG, resize to max 1024x1024
   - Encode as base64
   - Configurable frame rate (default 1 FPS)

3. **Extend GeminiLiveClient.ts**
   - Add sendVideo(base64Jpeg: string) method
   - Can send audio and video in same connection

### Key Implementation Details

**Canvas Capture:**
```typescript
const canvas = document.querySelector('canvas');
const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
const base64 = dataUrl.split(',')[1];
```

**Resize if Needed:**
```typescript
const maxDim = 1024;
if (canvas.width > maxDim || canvas.height > maxDim) {
  const scale = Math.min(maxDim / canvas.width, maxDim / canvas.height);
  // Draw to smaller canvas, then capture
}
```

### Testing Checklist
- [ ] Canvas frames captured at 1 FPS
- [ ] Frames sent to Gemini successfully
- [ ] Gemini can describe what's on canvas
- [ ] Audio still works with video enabled
- [ ] Frame rate is adjustable
- [ ] No performance degradation

### Success Criteria
- Ask Gemini "what do you see on the canvas?" and get accurate response
- Voice conversation still works smoothly
- No noticeable performance impact
```

---

## Phase 3: Add Tool Calling

### Objective
Implement the draw() tool so Gemini can trigger visual actions on the canvas.

### Files to Create/Modify

```
frontend/src/experiments/gemini-direct/
├── phase3/
│   ├── page.tsx                     # Full page with tools
│   ├── GeminiLiveClient.ts          # Extended with tool handling
│   ├── ToolHandler.ts               # Execute tool calls
│   └── ... (copy from phase2)
```

### Technical Specifications

#### Tool Definition (sent in setup)
```typescript
{
  "setup": {
    "model": "...",
    "tools": [{
      "functionDeclarations": [{
        "name": "draw",
        "description": "Draw visuals on the whiteboard...",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "Natural language description of what to draw"
            }
          },
          "required": ["query"]
        }
      }]
    }]
  }
}
```

#### Tool Call Response (Server → Client)
```typescript
{
  "toolCall": {
    "functionCalls": [{
      "id": "call_123",
      "name": "draw",
      "args": { "query": "draw a diagram of photosynthesis" }
    }]
  }
}
```

#### Tool Response (Client → Server)
```typescript
{
  "toolResponse": {
    "functionResponses": [{
      "id": "call_123",
      "name": "draw",
      "response": { "result": "success" }
    }]
  }
}
```

### Implementation Prompt for Phase 3

```
## Task: Implement Phase 3 - Add Tool Calling

Extend Phase 2 to support Gemini calling tools (specifically draw()).

### Context
- Phase 2 is complete with voice + video working
- Now adding tool support so Gemini can trigger drawing
- The draw() tool should call /api/draw endpoint (already exists)
- Read PLAN.md for full context

### Reference Code Locations

**Current Tool Implementation:**
- frontend/src/components/ExcalidrawToolHandler.tsx
  - Lines 1671-1751: handleToolCall() - how current system handles tools
  - Shows all tool types: add_text, show_image, draw_diagram, annotate, animate

**Current Draw API:**
- frontend/src/app/api/draw/route.ts
  - POST endpoint that takes query + screenshot
  - Returns array of tool calls to execute

**LiveKit's Gemini Plugin - Tool Handling:**
- agent/venv/lib/python3.13/site-packages/livekit/plugins/google/realtime/realtime_api.py
  - Lines 1098-1114: _handle_tool_calls() - processing tool calls
  - Lines 876-926: _build_connect_config() - tool configuration

**Google's Gemini SDK - Tool Protocol:**
- agent/venv/lib/python3.13/site-packages/google/genai/live.py
  - Lines 345-428: send_tool_response() - how to respond to tools

### Files to Create

1. **frontend/src/experiments/gemini-direct/phase3/page.tsx**
   - Full featured page with Excalidraw
   - Voice + video + tool calling

2. **frontend/src/experiments/gemini-direct/phase3/ToolHandler.ts**
   - Receive tool call from Gemini
   - For draw(): capture screenshot, call /api/draw, execute results
   - Return tool response to Gemini

3. **Extend GeminiLiveClient.ts**
   - Add tools to setup configuration
   - Handle toolCall messages
   - Add sendToolResponse() method
   - Events: onToolCall

### Key Implementation Details

**Tool Call Flow:**
```
1. Gemini sends: { toolCall: { functionCalls: [{ name: "draw", args: { query: "..." } }] } }
2. Browser captures canvas screenshot
3. Browser calls /api/draw with { query, screenshot }
4. /api/draw returns tool calls (add_text, draw_diagram, etc.)
5. Browser executes each tool call on canvas
6. Browser sends tool response to Gemini
7. Gemini continues speaking
```

**Tool Configuration in Setup:**
```typescript
const setupMessage = {
  setup: {
    model: "...",
    tools: [{
      functionDeclarations: [{
        name: "draw",
        description: "Draw visuals on the whiteboard. Use for text, images, diagrams, annotations.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "What to draw (e.g., 'show the water cycle diagram')"
            }
          },
          required: ["query"]
        }
      }, {
        name: "clear_board",
        description: "Clear the whiteboard",
        parameters: { type: "object", properties: {} }
      }]
    }],
    // IMPORTANT: Set tool behavior to BLOCKING so Gemini waits for response
    toolConfig: {
      functionCallingConfig: {
        mode: "AUTO"
      }
    }
  }
};
```

### Testing Checklist
- [ ] Tools defined in setup message
- [ ] Tool calls received from Gemini
- [ ] Screenshot captured on tool call
- [ ] /api/draw called successfully
- [ ] Tool results rendered on canvas
- [ ] Tool response sent back to Gemini
- [ ] Gemini continues after tool completion
- [ ] clear_board tool works

### Success Criteria
- Say "draw a diagram of the solar system" and see it appear
- Gemini acknowledges the drawing after it completes
- Multiple tool calls in sequence work correctly
```

---

## Phase 4: Full Integration & Comparison

### Objective
1. Measure latency and compare to LiveKit
2. Ensure feature parity
3. Prepare for production migration

### Implementation Prompt for Phase 4

```
## Task: Implement Phase 4 - Full Integration & Comparison

Complete the experiment and measure results against LiveKit.

### Context
- Phases 1-3 are complete
- Now need to measure performance and ensure parity
- Read PLAN.md for full context

### Tasks

1. **Latency Measurement**
   Add instrumentation to measure:
   - Time from user speech end to first audio byte received
   - Time from tool call to tool response
   - End-to-end conversation turn latency

   Compare against LiveKit implementation at /test-draw

2. **Feature Parity Checklist**
   Ensure these all work:
   - [ ] Voice conversation
   - [ ] Interruption (barge-in)
   - [ ] Canvas vision
   - [ ] draw() tool
   - [ ] clear_board() tool
   - [ ] Transcription display
   - [ ] Connection status
   - [ ] Reconnection on disconnect
   - [ ] Error handling

3. **Performance Testing**
   - Test with slow network (Chrome DevTools throttling)
   - Test with multiple reconnections
   - Monitor memory usage over time
   - Check for audio glitches under load

4. **Documentation**
   Create RESULTS.md with:
   - Latency measurements
   - Comparison table vs LiveKit
   - Known issues
   - Recommendations for production migration

### Latency Measurement Code

```typescript
// Add to GeminiLiveClient
private metrics = {
  turnStart: 0,
  firstAudioReceived: 0,
  toolCallStart: 0,
  toolResponseSent: 0,
};

// On turn complete (user stops speaking)
this.metrics.turnStart = performance.now();

// On first audio byte received
if (!this.metrics.firstAudioReceived) {
  this.metrics.firstAudioReceived = performance.now();
  const latency = this.metrics.firstAudioReceived - this.metrics.turnStart;
  console.log(`[LATENCY] First audio: ${latency.toFixed(0)}ms`);
}
```

### Success Criteria
- Latency equal to or better than LiveKit
- All features working
- No major bugs or regressions
- Clear documentation of results
```

---

## Reference Locations Quick Reference

### LiveKit Plugin (Python)
```
agent/venv/lib/python3.13/site-packages/livekit/plugins/google/realtime/realtime_api.py

Key sections:
- Lines 33-42: Audio/video format constants
- Lines 543-563: push_audio(), push_video()
- Lines 751-874: _send_task(), _recv_task()
- Lines 876-926: _build_connect_config()
- Lines 1098-1114: _handle_tool_calls()
```

### Google Gemini SDK (Python)
```
agent/venv/lib/python3.13/site-packages/google/genai/live.py

Key sections:
- Lines 86-874: AsyncSession class
- Lines 150-238: send_client_content()
- Lines 240-343: send_realtime_input()
- Lines 345-428: send_tool_response()
- Lines 430-457: receive()
- Lines 877-1120: AsyncLive.connect()
```

### Google Reference App (Browser)
```
https://github.com/google-gemini/live-api-web-console

Key files:
- src/lib/genai-live-client.ts - WebSocket wrapper
- src/lib/audio-streamer.ts - Audio playback
- src/lib/audio-recorder.ts - Audio capture
```

### Current LiveKit Implementation
```
frontend/src/app/page.tsx - Main page with LiveKitRoom
frontend/src/components/ExcalidrawToolHandler.tsx - Tool handling
frontend/src/components/ExcalidrawStreamer.tsx - Canvas streaming
frontend/src/components/ChatPill.tsx - Transcription display
agent/tutor.py - Python agent
```

---

## Environment Setup

### Required Environment Variable
```bash
# Add to frontend/.env.local
NEXT_PUBLIC_GOOGLE_API_KEY=your_gemini_api_key_here
```

### Route Registration
Add to Next.js routing (automatic with app directory):
- `/experiments/gemini-direct/phase1`
- `/experiments/gemini-direct/phase2`
- `/experiments/gemini-direct/phase3`

---

## Timeline Estimate

| Phase | Scope | Relative Effort |
|-------|-------|-----------------|
| Phase 1 | Speech-to-speech | Medium - Most complexity here |
| Phase 2 | Add video | Small - Mostly copy existing code |
| Phase 3 | Add tools | Medium - Integration with /api/draw |
| Phase 4 | Testing & docs | Small - Measurement and documentation |

---

## Risk Mitigation

1. **If browser SDK doesn't support WebSocket:**
   - Fall back to using fetch-based streaming
   - Or implement raw WebSocket client manually

2. **If latency is worse than expected:**
   - Check if using correct Gemini model (native audio vs non-native)
   - Verify audio chunk size (50ms optimal)
   - Check for buffering delays in playback

3. **If CORS issues:**
   - Gemini should allow browser connections
   - If not, may need thin proxy (adds latency)

4. **If ephemeral tokens needed for production:**
   - Can add /api/gemini-token endpoint later
   - For experiments, hardcoded key is fine
