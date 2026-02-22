#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
SEARX_DIR="$ROOT_DIR/.searxng-src"
VENV_DIR="$ROOT_DIR/.venv-searxng"
PORT_FILE="$RUN_DIR/searx_port"
DEFAULT_PORT="${SEARX_PORT:-8394}"

mkdir -p "$RUN_DIR"

pick_free_port() {
  local start_port="$1"
  local p="$start_port"
  local limit=$((start_port + 30))
  while [ "$p" -le "$limit" ]; do
    if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
  done
  return 1
}

pick_python() {
  if [ -n "${PYTHON_BIN:-}" ] && command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "$PYTHON_BIN"; return 0
  fi
  for py in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$py" >/dev/null 2>&1; then
      ver="$($py -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
      major="${ver%%.*}"; minor="${ver##*.}"
      if [ "$major" = "3" ] && [ "$minor" -ge 10 ] && [ "$minor" -le 13 ]; then
        echo "$py"; return 0
      fi
    fi
  done
  return 1
}

install_venv_pkg_debian() {
  local py_minor pkg cmd
  py_minor="$("$PYTHON" -c 'import sys; print(sys.version_info.minor)')"
  if [ -f /etc/debian_version ] && command -v apt-get >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      cmd="apt-get"
    elif command -v sudo >/dev/null 2>&1; then
      cmd="sudo apt-get"
    else
      echo "[setup-searxng] missing sudo/root for apt install."
      return 1
    fi

    for pkg in "python3.${py_minor}-venv" "python3-venv"; do
      if apt-cache show "$pkg" >/dev/null 2>&1; then
        echo "[setup-searxng] installing missing package: $pkg"
        $cmd update >/dev/null
        $cmd install -y "$pkg" >/dev/null
        return 0
      fi
    done
  fi
  return 1
}

PYTHON="$(pick_python || true)"
if [ -z "$PYTHON" ]; then
  echo "[setup-searxng] Python 3.10-3.13 is required (not found)."
  echo "[setup-searxng] install Python 3.11+ and re-run."
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "[setup-searxng] creating venv with $PYTHON"
  if ! "$PYTHON" -m venv "$VENV_DIR" >"$RUN_DIR/.venv.err" 2>&1; then
    if grep -Eiq 'ensurepip is not available|No module named venv|venv package' "$RUN_DIR/.venv.err"; then
      echo "[setup-searxng] python venv components are missing."
      if install_venv_pkg_debian; then
        echo "[setup-searxng] retrying venv creation"
        rm -rf "$VENV_DIR"
        "$PYTHON" -m venv "$VENV_DIR"
      else
        echo "[setup-searxng] install failed. Run one of:"
        echo "  sudo apt install python3-venv"
        echo "  sudo apt install python3.$("$PYTHON" -c 'import sys; print(sys.version_info.minor)')-venv"
        exit 1
      fi
    else
      cat "$RUN_DIR/.venv.err"
      exit 1
    fi
  fi
fi

if [ ! -f "$VENV_DIR/bin/activate" ]; then
  echo "[setup-searxng] venv activation script missing: $VENV_DIR/bin/activate"
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install -q -U pip setuptools wheel

if [ ! -d "$SEARX_DIR/.git" ]; then
  echo "[setup-searxng] cloning searxng source"
  git clone --depth 1 https://github.com/searxng/searxng.git "$SEARX_DIR" >/dev/null 2>&1
else
  echo "[setup-searxng] updating searxng source"
  git -C "$SEARX_DIR" pull --ff-only >/dev/null 2>&1 || true
fi

echo "[setup-searxng] installing searxng into venv"
python -m pip install -q -e "$SEARX_DIR"

PORT="$DEFAULT_PORT"
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  alt="$(pick_free_port "$PORT" || true)"
  if [ -z "${alt:-}" ]; then
    echo "[setup-searxng] no free port found near $PORT"
    exit 1
  fi
  PORT="$alt"
fi

echo "$PORT" > "$PORT_FILE"
echo "[setup-searxng] ready (python venv): $VENV_DIR"
echo "[setup-searxng] default search port: $PORT"
