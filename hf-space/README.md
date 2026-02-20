---
title: Argentic Search Lab Live Demo
emoji: 🔎
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

Live demo of Argentic Search Lab (UI + MCP proxy + internal Ollama model) with demo quota mode.

Notes:
- This live demo is intentionally limited to 2 interactions per browser cookie.
- For full performance and unlimited use, run locally from GitHub.
- Default runtime in this Space:
  - Provider: `ollama`
  - Base URL: `/ollama/v1`
  - Model: `qwen3:0.6b-q4_K_M`
- Optional custom GGUF:
  - Set `OLLAMA_GGUF_URL` in Space Variables.
  - Keep `OLLAMA_MODEL` as your target model name.
