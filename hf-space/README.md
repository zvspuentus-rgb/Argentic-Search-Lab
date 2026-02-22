---
title: Argentic Search Lab Live Demo
emoji: 🔎
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

Live demo of Argentic Search Lab (UI + MCP proxy + internal Ollama model server) with demo quota mode.

Local root-cause stable run (with internal SearXNG): `docker compose -f docker-compose.local.yml up -d --build`

Health checks (local):
- `http://localhost:7860/mcp/health` should return `"searxng": true`
- `http://localhost:7860/searxng/search?q=test&format=json` should return JSON

Important:
- Hugging Face Spaces Docker runtime does not support multi-service compose sidecars in one Space.
- In Space cloud runtime, SearXNG uses external fallbacks; local compose is the stable option for internal SearXNG.

Notes:
- This live demo is intentionally limited to 2 interactions per browser cookie.
- For full performance and unlimited use, run locally from GitHub.
- Default runtime in this Space:
  - Provider: `ollama` (OpenAI-compatible endpoint from llama.cpp)
  - Base URL: `/ollama/v1`
  - Model: `qwen3-0.6b-q4_0`
  - Search mode: `Quick` only (Deep disabled in Space build)
- Optional custom GGUF (recommended for tuning speed/quality):
  - Set `OLLAMA_MODEL_URL` to your `.gguf` URL.
  - Set `OLLAMA_MODEL_NAME` to the exposed model alias.
