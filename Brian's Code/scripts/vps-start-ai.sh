#!/usr/bin/env bash
set -euo pipefail

COMPOSE_BASE="docker-compose.vps.example.yml"
COMPOSE_AI="docker-compose.ollama-ai.example.yml"
ENV_PRODUCTION=".env.production"
ENV_AI=".env.ai"
MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not available on PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is not available. Install the docker-compose-plugin package." >&2
  exit 1
fi

if [ ! -f "$ENV_PRODUCTION" ]; then
  echo "$ENV_PRODUCTION is missing. Create it from .env.example and fill production values before starting the stack." >&2
  exit 1
fi

if [ ! -f "$ENV_AI" ]; then
  cp .env.ollama-ai.example "$ENV_AI"
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
    n8n_secret="$(openssl rand -hex 32)"
    sed -i "s/^OLLAMA_OPENAI_API_KEY=.*/OLLAMA_OPENAI_API_KEY=$secret/" "$ENV_AI"
    sed -i "s/^N8N_ENCRYPTION_KEY=.*/N8N_ENCRYPTION_KEY=$n8n_secret/" "$ENV_AI"
  fi
  echo "Created $ENV_AI from .env.ollama-ai.example."
fi

docker compose \
  -f "$COMPOSE_BASE" \
  -f "$COMPOSE_AI" \
  --env-file "$ENV_PRODUCTION" \
  --env-file "$ENV_AI" \
  up -d ollama

docker compose \
  -f "$COMPOSE_BASE" \
  -f "$COMPOSE_AI" \
  --env-file "$ENV_PRODUCTION" \
  --env-file "$ENV_AI" \
  exec ollama ollama pull "$MODEL"

docker compose \
  -f "$COMPOSE_BASE" \
  -f "$COMPOSE_AI" \
  --env-file "$ENV_PRODUCTION" \
  --env-file "$ENV_AI" \
  up -d --build keeptally

docker compose \
  -f "$COMPOSE_BASE" \
  -f "$COMPOSE_AI" \
  --env-file "$ENV_PRODUCTION" \
  --env-file "$ENV_AI" \
  ps

echo
echo "AI stack started with Ollama model: $MODEL"
echo "Validate KeepTally AI status at: /api/ai/status"
