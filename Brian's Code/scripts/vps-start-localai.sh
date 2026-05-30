#!/usr/bin/env bash
set -euo pipefail

COMPOSE_BASE="docker-compose.vps.example.yml"
COMPOSE_AI="docker-compose.ai.example.yml"
ENV_PRODUCTION=".env.production"
ENV_AI=".env.ai"
LOCALAI_HOST="${LOCALAI_HOST:-127.0.0.1}"
LOCALAI_PORT="${LOCALAI_PORT:-8080}"
LOCALAI_URL="http://${LOCALAI_HOST}:${LOCALAI_PORT}"

read_env_value() {
  local name="$1"
  local file="$2"
  grep -E "^${name}=" "$file" | tail -n 1 | cut -d= -f2-
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not available on PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is not available. Install the docker-compose-plugin package." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install and validate the LocalAI model." >&2
  exit 1
fi

if [ ! -f "$ENV_PRODUCTION" ]; then
  echo "$ENV_PRODUCTION is missing. Create it from .env.example and fill production values before starting the stack." >&2
  exit 1
fi

if [ ! -f "$ENV_AI" ]; then
  cp .env.ai.example "$ENV_AI"
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
    n8n_secret="$(openssl rand -hex 32)"
    sed -i "s/^LOCALAI_API_KEY=.*/LOCALAI_API_KEY=$secret/" "$ENV_AI"
    sed -i "s/^N8N_ENCRYPTION_KEY=.*/N8N_ENCRYPTION_KEY=$n8n_secret/" "$ENV_AI"
  fi
  echo "Created $ENV_AI from .env.ai.example."
fi

LOCALAI_PORT="$(read_env_value "LOCALAI_PORT" "$ENV_AI")"
LOCALAI_PORT="${LOCALAI_PORT:-8080}"
LOCALAI_URL="http://${LOCALAI_HOST}:${LOCALAI_PORT}"
LOCALAI_API_KEY="$(read_env_value "LOCALAI_API_KEY" "$ENV_AI")"
LOCALAI_API_KEY="${LOCALAI_API_KEY:-keeptally-local-ai}"
LOCALAI_MODEL_CONFIG_URL="$(read_env_value "LOCALAI_MODEL_CONFIG_URL" "$ENV_AI")"
LOCALAI_MODEL_CONFIG_URL="${LOCALAI_MODEL_CONFIG_URL:-github:mudler/LocalAI/gallery/gpt4all-j.yaml}"
LOCALAI_MODEL_INSTALL_NAME="$(read_env_value "LOCALAI_MODEL_INSTALL_NAME" "$ENV_AI")"
LOCALAI_MODEL_INSTALL_NAME="${LOCALAI_MODEL_INSTALL_NAME:-local-llm}"

docker compose \
  -f "$COMPOSE_BASE" \
  -f "$COMPOSE_AI" \
  --env-file "$ENV_PRODUCTION" \
  --env-file "$ENV_AI" \
  up -d localai

echo "Waiting for LocalAI at $LOCALAI_URL ..."
for _ in $(seq 1 60); do
  if curl -fsS "$LOCALAI_URL/readyz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS "$LOCALAI_URL/readyz" >/dev/null

echo "Installing LocalAI model '$LOCALAI_MODEL_INSTALL_NAME' from '$LOCALAI_MODEL_CONFIG_URL' ..."
apply_response="$(
  curl -fsS "$LOCALAI_URL/models/apply" \
    -H "Authorization: Bearer $LOCALAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$LOCALAI_MODEL_CONFIG_URL\",\"name\":\"$LOCALAI_MODEL_INSTALL_NAME\"}"
)"
echo "$apply_response"

job_id="$(printf '%s' "$apply_response" | sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -n "$job_id" ]; then
  echo "LocalAI model job: $job_id"
  for _ in $(seq 1 900); do
    job_response="$(curl -fsS "$LOCALAI_URL/models/jobs/$job_id" -H "Authorization: Bearer $LOCALAI_API_KEY")"
    if printf '%s\n' "$job_response" | grep -q '"processed"[[:space:]]*:[[:space:]]*true'; then
      echo "$job_response"
      break
    fi
    sleep 2
  done
fi

echo "Available LocalAI models:"
curl -fsS "$LOCALAI_URL/v1/models" -H "Authorization: Bearer $LOCALAI_API_KEY"
echo

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
echo "LocalAI first test started with model: $LOCALAI_MODEL_INSTALL_NAME"
echo "Validate KeepTally AI status at: /api/ai/status"
