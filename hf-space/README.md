---
title: Argentic Search Lab Live Demo
emoji: 🔎
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

Live demo of Argentic Search Lab (UI + MCP proxy + internal llama.cpp model server) with demo quota mode.

Notes:
- This live demo is intentionally limited to 2 interactions per browser cookie.
- For full performance and unlimited use, run locally from GitHub.
- Default runtime in this Space:
  - Provider: `ollama` (OpenAI-compatible endpoint from llama.cpp)
  - Base URL: `/ollama/v1`
  - Model: `qwen2.5-0.5b-instruct-q4_k_m`
- Optional custom GGUF (recommended for tuning speed/quality):
  - Set `LLAMA_MODEL_URL` to your `.gguf` URL.
  - Set `LLAMA_MODEL_NAME` to the exposed model alias.
