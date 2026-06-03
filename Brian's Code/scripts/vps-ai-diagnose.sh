#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
KeepTally VPS AI diagnostics

Usage:
  ./scripts/vps-ai-diagnose.sh <dev|test> [--with-ai]

Examples:
  ./scripts/vps-ai-diagnose.sh dev
  ./scripts/vps-ai-diagnose.sh test
  ./scripts/vps-ai-diagnose.sh test --with-ai

What it checks:
  - Which env file the stack should use.
  - AI-related values in that env file, with API keys masked.
  - AI-related values visible inside the running app container.
  - Local app AI status and connectivity endpoints.
USAGE
}

if [[ $# -eq 1 && ( "$1" == "--help" || "$1" == "-h" ) ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

STACK="$1"
shift

WITH_AI="${KEEP_TALLY_WITH_AI:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-ai)
      WITH_AI=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

mask_secret_lines() {
  sed -E \
    -e 's#(AI_INTEGRATIONS_OPENAI_API_KEY=).*#\1***set***#' \
    -e 's#(LOCALAI_API_KEY=).*#\1***set***#' \
    -e 's#(SESSION_SECRET=).*#\1***set***#'
}

COMPOSE=(docker compose)
SERVICE=""
ENV_FILE=""
HEALTH_BASE=""

case "$STACK" in
  dev)
    require_file "docker-compose.vps-dev.yml"
    require_file ".env.vps-dev"
    COMPOSE+=(
      -p keeptally-dev
      -f docker-compose.vps-dev.yml
      --env-file .env.vps-dev
    )
    SERVICE="keeptally-dev"
    ENV_FILE=".env.vps-dev"
    HEALTH_BASE="http://127.0.0.1:${KEEP_TALLY_DEV_HOST_PORT:-3100}"
    ;;
  test)
    require_file "docker-compose.vps.example.yml"
    if [[ -f ".env.vps-test" ]]; then
      ENV_FILE=".env.vps-test"
    else
      ENV_FILE=".env.production"
    fi
    require_file "$ENV_FILE"
    export KEEP_TALLY_ENV_FILE="$ENV_FILE"
    COMPOSE+=(
      -f docker-compose.vps.example.yml
    )
    if [[ "$WITH_AI" == "1" ]]; then
      require_file "docker-compose.ai.example.yml"
      require_file ".env.ai"
      COMPOSE+=(
        -f docker-compose.ai.example.yml
      )
    fi
    if [[ -f "docker-compose.vps-test.override.yml" ]]; then
      COMPOSE+=(
        -f docker-compose.vps-test.override.yml
      )
    fi
    COMPOSE+=(
      --env-file "$ENV_FILE"
    )
    if [[ "$WITH_AI" == "1" ]]; then
      COMPOSE+=(
        --env-file .env.ai
      )
    fi
    SERVICE="keeptally"
    HEALTH_BASE="http://127.0.0.1:${KEEP_TALLY_HOST_PORT:-3000}"
    ;;
  *)
    echo "Unknown stack: $STACK" >&2
    usage
    exit 2
    ;;
esac

echo "== KeepTally AI diagnostics =="
echo "Stack: $STACK"
echo "Directory: $APP_DIR"
echo "Env file: $ENV_FILE"
echo "With LocalAI compose overlay: $WITH_AI"
echo

echo "== Host env file AI values =="
grep -nE '^(AI_|VITE_VOICE|LOCALAI_|KEEP_TALLY_|CORS_ORIGIN|NODE_ENV)=' "$ENV_FILE" 2>/dev/null | mask_secret_lines || true
if [[ "$WITH_AI" == "1" && -f ".env.ai" ]]; then
  echo
  echo "== .env.ai values =="
  grep -nE '^(AI_|LOCALAI_|VITE_VOICE)=' ".env.ai" 2>/dev/null | mask_secret_lines || true
fi
echo

echo "== Compose service status =="
"${COMPOSE[@]}" ps || true
echo

echo "== Container AI env values =="
if "${COMPOSE[@]}" ps --services --filter "status=running" | grep -qx "$SERVICE"; then
  "${COMPOSE[@]}" exec -T "$SERVICE" sh -lc \
    'printenv | grep -E "^(AI_|VITE_VOICE|LOCALAI_|CORS_ORIGIN|NODE_ENV|PORT)=" | sort' \
    | mask_secret_lines || true
else
  echo "Service is not running: $SERVICE"
fi
echo

echo "== Local app AI status =="
curl -fsS "$HEALTH_BASE/api/ai/status" || true
echo
echo

echo "== Local app AI connectivity =="
curl -fsS "$HEALTH_BASE/api/ai/connectivity" || true
echo
