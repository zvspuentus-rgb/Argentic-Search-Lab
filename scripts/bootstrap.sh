#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-https://github.com/zvspuentus-rgb/Argentic-Search-Lab.git}"
TARGET_DIR="${2:-Argentic-Search-Lab}"

if ! command -v git >/dev/null 2>&1; then
  echo "[bootstrap] git is required."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[bootstrap] docker is required."
  exit 1
fi

if [ -d "${TARGET_DIR}/.git" ]; then
  echo "[bootstrap] repo already exists at ${TARGET_DIR}, pulling latest..."
  git -C "${TARGET_DIR}" pull --ff-only
else
  echo "[bootstrap] cloning ${REPO_URL} -> ${TARGET_DIR}"
  git clone "${REPO_URL}" "${TARGET_DIR}"
fi

cd "${TARGET_DIR}"

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[bootstrap] created .env from .env.example"
fi

if docker compose version >/dev/null 2>&1; then
  echo "[bootstrap] starting stack with docker compose..."
  docker compose up -d --build
elif command -v docker-compose >/dev/null 2>&1; then
  echo "[bootstrap] starting stack with docker-compose..."
  docker-compose up -d --build
else
  echo "[bootstrap] neither 'docker compose' nor 'docker-compose' found."
  exit 1
fi

echo
echo "[bootstrap] done."
echo "UI:    http://localhost:8093"
echo "MCP:   http://localhost:8193/mcp"
echo "SearX: http://localhost:8393/search?q=test&format=json"
