FROM node:22.13.1-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000
ENV WHISPER_COMMAND=whisper
ENV WHISPER_MODEL=base
ENV HOME=/home/node
ARG INSTALL_WHISPER=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
  && rm -rf /var/lib/apt/lists/*

RUN if [ "$INSTALL_WHISPER" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends \
        build-essential \
        cargo \
        ffmpeg \
        python3 \
        python3-pip \
        python3-venv \
        rustc \
      && python3 -m venv /opt/whisper-venv \
      && /opt/whisper-venv/bin/pip install --upgrade pip setuptools wheel \
      && /opt/whisper-venv/bin/pip install --no-cache-dir -U openai-whisper \
      && rm -rf /var/lib/apt/lists/*; \
    fi

RUN mkdir -p /home/node/.cache/whisper /app \
  && chown -R node:node /home/node /app

USER root
ENV PATH="/opt/whisper-venv/bin:${PATH}"
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
