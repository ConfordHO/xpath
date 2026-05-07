#!/bin/sh
set -eu

ollama serve &
pid="$!"

cleanup() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
trap cleanup INT TERM

ready=0
for _ in $(seq 1 120); do
  if OLLAMA_HOST=127.0.0.1:11434 ollama list >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" != "1" ]; then
  echo "Ollama did not become ready on 127.0.0.1:11434" >&2
  cleanup
  exit 1
fi

if [ -n "${OLLAMA_MODEL:-}" ]; then
  OLLAMA_HOST=127.0.0.1:11434 ollama pull "$OLLAMA_MODEL"
fi

wait "$pid"
