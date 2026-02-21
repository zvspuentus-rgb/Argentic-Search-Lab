FROM node:20-bookworm-slim

WORKDIR /app

ARG TARGETARCH
ARG LLAMA_CPP_ARCH
ARG LLAMA_CPP_VERSION=b8123

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ca-certificates curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="${LLAMA_CPP_ARCH:-${TARGETARCH:-}}"; \
    if [ -z "$arch" ]; then \
      u="$(uname -m)"; \
      [ "$u" = "x86_64" ] && arch="amd64" || true; \
      [ "$u" = "aarch64" ] && arch="arm64" || true; \
    fi; \
    [ "$arch" = "amd64" ] || [ "$arch" = "arm64" ]; \
    mkdir -p /opt/llama; \
    if [ "$arch" = "amd64" ]; then \
      curl -fsSL "https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-ubuntu-x64.tar.gz" -o /tmp/llama.tar.gz; \
      tar -xzf /tmp/llama.tar.gz -C /tmp; \
      cp -a /tmp/llama-${LLAMA_CPP_VERSION}/* /opt/llama/; \
      rm -rf /tmp/llama.tar.gz /tmp/llama-${LLAMA_CPP_VERSION}; \
    else \
      apt-get update && apt-get install -y --no-install-recommends build-essential cmake git && rm -rf /var/lib/apt/lists/*; \
      git clone --depth 1 --branch "${LLAMA_CPP_VERSION}" https://github.com/ggml-org/llama.cpp /tmp/llama.cpp; \
      cmake -S /tmp/llama.cpp -B /tmp/llama.cpp/build -DGGML_NATIVE=OFF -DGGML_OPENMP=ON -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release; \
      cmake --build /tmp/llama.cpp/build --target llama-server -j2; \
      cp -a /tmp/llama.cpp/build/bin/llama-server /opt/llama/llama-server; \
      rm -rf /tmp/llama.cpp; \
    fi; \
    /opt/llama/llama-server --version || true

COPY AppAgent.html /app/AppAgent.html
COPY assets /app/assets
COPY server.js /app/server.js
COPY mcp-service /app/mcp-service
COPY entrypoint.sh /app/entrypoint.sh

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:/opt/llama:$PATH"
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/mcp-service/requirements.txt
RUN chmod +x /app/entrypoint.sh

ENV PORT=7860
ENV MCP_BASE=http://127.0.0.1:8090
ENV SEARX_BASE=https://searx.be
ENV OLLAMA_BASE=http://127.0.0.1:11434
ENV LLAMA_HOST=127.0.0.1
ENV LLAMA_PORT=11434
ENV LLAMA_MODEL_PATH=/data/models/model.gguf
ENV LLAMA_MODEL_NAME=qwen3-0.6b-presinq-q4_k_s
ENV LLAMA_MODEL_URL=https://huggingface.co/huawei-csl/Qwen3-0.6B-PreSINQ-GGUF/resolve/main/Qwen3-0.6B-presinq-Q4_K_S.gguf
ENV LLAMA_CTX_SIZE=2048
ENV LLAMA_THREADS=4
ENV LLAMA_TEMPERATURE=0.2
ENV LIVE_DEMO_MODE=true
ENV LIVE_DEMO_QUERY_LIMIT=2

EXPOSE 7860

CMD ["/app/entrypoint.sh"]
