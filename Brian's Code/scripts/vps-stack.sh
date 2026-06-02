#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
KeepTally VPS stack helper

Usage:
  ./scripts/vps-stack.sh <dev|test> <start|stop|restart|status|logs|health|down> [--with-ai]

Examples:
  ./scripts/vps-stack.sh dev start
  ./scripts/vps-stack.sh dev stop
  ./scripts/vps-stack.sh dev logs

  ./scripts/vps-stack.sh test start
  ./scripts/vps-stack.sh test restart --with-ai
  ./scripts/vps-stack.sh test health

Notes:
  - dev uses docker-compose.vps-dev.yml and .env.vps-dev.
  - test uses docker-compose.vps.example.yml and .env.vps-test when present.
  - --with-ai adds docker-compose.ai.example.yml and .env.ai for test/local AI stacks.
  - stop does not remove containers, networks, images, or volumes.
  - down removes the compose project containers/network, but not named volumes.
USAGE
}

if [[ $# -eq 1 && ( "$1" == "--help" || "$1" == "-h" ) ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 ]]; then
  usage
  exit 2
fi

STACK="$1"
ACTION="$2"
shift 2

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

COMPOSE=(docker compose)
SERVICE=""
HEALTH_URL=""

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
    HEALTH_URL="http://127.0.0.1:${KEEP_TALLY_DEV_HOST_PORT:-3100}/api/healthz"
    ;;
  test)
    require_file "docker-compose.vps.example.yml"
    if [[ -f ".env.vps-test" ]]; then
      TEST_ENV_FILE=".env.vps-test"
    else
      TEST_ENV_FILE=".env.production"
    fi
    require_file "$TEST_ENV_FILE"
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
      --env-file "$TEST_ENV_FILE"
    )
    if [[ "$WITH_AI" == "1" ]]; then
      COMPOSE+=(
        --env-file .env.ai
      )
    fi
    SERVICE="keeptally"
    HEALTH_URL="http://127.0.0.1:${KEEP_TALLY_HOST_PORT:-3000}/api/healthz"
    ;;
  *)
    echo "Unknown stack: $STACK" >&2
    usage
    exit 2
    ;;
esac

echo "Stack: $STACK"
echo "Action: $ACTION"
echo "Directory: $APP_DIR"

case "$ACTION" in
  start)
    "${COMPOSE[@]}" up -d --build --force-recreate "$SERVICE"
    ;;
  stop)
    "${COMPOSE[@]}" stop "$SERVICE"
    ;;
  restart)
    "${COMPOSE[@]}" stop "$SERVICE"
    "${COMPOSE[@]}" up -d --build --force-recreate "$SERVICE"
    ;;
  status)
    "${COMPOSE[@]}" ps
    ;;
  logs)
    "${COMPOSE[@]}" logs --tail="${KEEP_TALLY_LOG_TAIL:-160}" "$SERVICE"
    ;;
  health)
    curl -fsS -I "$HEALTH_URL"
    ;;
  down)
    "${COMPOSE[@]}" down
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage
    exit 2
    ;;
esac
