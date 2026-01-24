# CLAUDE.md

## Project Overview

Penseum Tutor: Real-time AI tutoring with Excalidraw whiteboard and Gemini Live API.

**Production URL**: https://L0.penseum.com

## Commands

```bash
# Local Development
docker compose up --build
```

## Architecture

```
Browser (Gemini Live WebSocket)
  ├── Voice conversation
  ├── Canvas streaming (1 FPS)
  └── Tools: draw(query), clear_board()

draw(query) → /api/draw → Draw Server (FastAPI) → Gemini Flash
                                    ↓
                            Tool calls returned to frontend
                                    ↓
                            ExcalidrawToolHandler renders
```

## Key Files

```
frontend/src/
├── app/page.tsx                              # Main tutor (landing + whiteboard)
├── app/api/draw/route.ts                     # Proxies to draw-server
├── app/experiments/gemini-direct/lib/
│   ├── GeminiLiveClient.ts                   # Gemini WebSocket client
│   ├── AudioCapture.ts                       # Mic capture (16kHz PCM)
│   └── AudioPlayback.ts                      # Audio output
├── components/ExcalidrawToolHandler.tsx      # Renders draw tool calls
└── components/landing/InvestorOverlay.tsx    # Landing page UI

agent/
├── draw_server.py        # FastAPI server (keeps Python warm)
├── draw_subagent.py      # Gemini Flash for whiteboard tools
└── p5js/p5_subagent.py   # p5.js animation generator
```

## Environment Variables

```
GOOGLE_API_KEY    # Gemini Live + Flash
SERPAPI_API_KEY   # Image search
```

## VPS Deployment

**Host**: OVH VPS (vps-a37f039e.vps.ovh.ca)
**User**: ubuntu
**Project path**: /home/ubuntu/penseum-tutor

### Services
- **Caddy**: Reverse proxy with auto-HTTPS (Let's Encrypt)
- **Frontend**: Next.js on port 3004 (dev mode for hot reload)
- **Draw server**: FastAPI on port 5001

### Deploy a file change
```bash
# 1. SCP the changed file
scp <local-file> ubuntu@148.113.203.68:/home/ubuntu/penseum-tutor/<path>

# 2. Restart the container
ssh ubuntu@148.113.203.68 "cd /home/ubuntu/penseum-tutor && docker compose restart frontend"
```

### View logs
```bash
ssh ubuntu@148.113.203.68 "cd /home/ubuntu/penseum-tutor && docker compose logs -f frontend"
ssh ubuntu@148.113.203.68 "cd /home/ubuntu/penseum-tutor && docker compose logs -f draw-server"
```

### Full rebuild (only if dependencies change)
```bash
ssh ubuntu@148.113.203.68 "cd /home/ubuntu/penseum-tutor && docker compose down && docker compose up --build -d"
```
