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
- This demo is intentionally limited by cookie quota.
- For full usage, run the project locally from GitHub.
- Default runtime in this Space:
  - Provider: `ollama`
  - Base URL: `/ollama/v1`
  - Model: `gemma3:1b`
- Optional custom GGUF:
  - Set `OLLAMA_GGUF_URL` in Space Variables.
  - Keep `OLLAMA_MODEL` as your target model name.
