FROM ollama/ollama:latest

ENV OLLAMA_HOST=0.0.0.0:11434
ENV OLLAMA_MODEL=qwen2.5:1.5b

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 11434

ENTRYPOINT ["/start.sh"]
