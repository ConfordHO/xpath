FROM node:22.13.1-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV WHISPER_COMMAND=whisper
ENV WHISPER_MODEL=medium
ENV PATH="/opt/whisper-venv/bin:${PATH}"
ENV HOME=/home/node

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cargo \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    rustc \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/whisper-venv \
  && pip install --upgrade pip setuptools wheel \
  && pip install --no-cache-dir -U openai-whisper

RUN mkdir -p /home/node/.cache/whisper /app \
  && chown -R node:node /home/node /app

USER node
RUN python - <<'PY'
import os
import whisper

whisper.load_model(os.environ.get("WHISPER_MODEL", "medium"))
PY

USER root
COPY --chown=node:node package*.json ./
RUN npm ci --include=dev

COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

RUN npm run build \
  && npm prune --omit=dev \
  && mkdir -p storage/documents \
  && chown -R node:node /app

USER node

EXPOSE 10000

CMD ["npm", "run", "start"]
