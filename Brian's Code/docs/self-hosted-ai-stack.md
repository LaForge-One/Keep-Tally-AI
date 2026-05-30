# Self-Hosted AI Stack For KeepTally VPS

Date: 2026-05-30

## Goal

Run a local AI layer beside KeepTally on the VPS so basic AI workflows can be tested without OpenAI credentials.

This stack is optional and should be deployed as a Docker Compose overlay:

```sh
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --env-file .env.production \
  --env-file .env.ai \
  up -d
```

## Services

### LocalAI

Role:

- OpenAI-compatible API endpoint for KeepTally.
- Best fit for keeping the existing `AI_INTEGRATIONS_OPENAI_BASE_URL` integration shape.

KeepTally points at:

```env
AI_INTEGRATIONS_OPENAI_BASE_URL=http://localai:8080/v1
AI_INTEGRATIONS_OPENAI_API_KEY=${LOCALAI_API_KEY}
```

Source: LocalAI publishes the `localai/localai` Docker image and supports an OpenAI-compatible API.

### Ollama

Role:

- Local model runner for model testing and admin experimentation.
- Paired with Open WebUI and n8n.

Source: Ollama provides the official `ollama/ollama` Docker image.

### Open WebUI

Role:

- Admin-only UI for testing local models and prompts.
- Connects to Ollama and LocalAI.

Default local port:

```text
127.0.0.1:8088
```

Do not expose Open WebUI publicly until authentication and reverse proxy rules are configured.

### n8n

Role:

- Optional automation/agent workflow service.
- Good for scheduled reports, CSV workflows, reorder checks, label-batch preparation, and later AI-assisted admin tasks.

Default local port:

```text
127.0.0.1:5678
```

Use the `automation` compose profile only when needed.

## Deployment Modes

### KeepTally + LocalAI Only

```sh
cp .env.ai.example .env.ai
# edit LOCALAI_API_KEY and model names
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --env-file .env.production \
  --env-file .env.ai \
  up -d keeptally localai
```

### Add Admin Model UI

```sh
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --env-file .env.production \
  --env-file .env.ai \
  --profile ai-ui \
  up -d
```

### Add Automation/Agent Workflows

```sh
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --env-file .env.production \
  --env-file .env.ai \
  --profile ai-ui \
  --profile automation \
  up -d
```

## Model Loading

LocalAI will need a model placed/configured in the `localai-models` volume. KeepTally should use the LocalAI model name through:

```env
LOCALAI_TEXT_MODEL=local-llm
LOCALAI_COMMAND_MODEL=local-llm
LOCALAI_VOICE_PARSE_MODEL=local-llm
```

For Ollama:

```sh
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --profile ai-ui \
  exec ollama ollama pull qwen2.5:3b
```

Small CPU-friendly candidates to test first:

- `qwen2.5:3b`
- `llama3.2:3b`
- `phi3:mini`

Use larger models only on a VPS with enough RAM or GPU support.

## Security Rules

Critical:

- Do not publish Ollama or LocalAI ports to the internet.
- Do not expose Open WebUI or n8n publicly without authentication and TLS.
- Keep Open WebUI and n8n bound to `127.0.0.1` by default.
- Use SSH tunnel, VPN, or a protected reverse proxy for admin access.
- Use a real `LOCALAI_API_KEY`.
- Replace `N8N_ENCRYPTION_KEY` before using n8n seriously.

Reason:

- Local model servers often have weak/no auth by default.
- Agent/workflow tools can call internal systems and should be treated as privileged admin surfaces.

## KeepTally Behavior

With the AI overlay enabled:

- `/api/ai/status` should report `configured: true` if LocalAI base URL and API key are set.
- Basic command parsing can target LocalAI.
- Voice custom mode can attempt LocalAI parsing, with local deterministic fallback still available.
- Realtime voice should remain disabled until we intentionally design a local realtime replacement.

Recommended env:

```env
AI_REALTIME_ENABLED=false
AI_SELF_HOSTED_ENABLED=true
```

## Expected Limits

CPU-only VPS:

- Good: item matching, command parsing, label cleanup, simple assistant prompts.
- Mixed: larger inventory reasoning or long reports.
- Poor: realtime voice, fast transcription, high-quality TTS.

GPU VPS:

- Better for larger models and voice workflows.
- Still keep fallbacks in place.

## Validation

Run preflight:

```sh
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  --env-file .env.production \
  --env-file .env.ai \
  run --rm keeptally corepack pnpm run deploy:preflight
```

Check service health:

```sh
docker compose -f docker-compose.vps.example.yml -f docker-compose.ai.example.yml ps
docker compose -f docker-compose.vps.example.yml -f docker-compose.ai.example.yml logs localai
```

Check from inside the app container:

```sh
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  exec keeptally node -e "fetch('http://localai:8080/v1/models',{headers:{authorization:'Bearer '+process.env.AI_INTEGRATIONS_OPENAI_API_KEY}}).then(r=>console.log(r.status)).catch(console.error)"
```

## Recommended First Test

Start with LocalAI only:

1. Bring up `keeptally` and `localai`.
2. Load one small CPU model into LocalAI.
3. Set `LOCALAI_TEXT_MODEL` to that model name.
4. Confirm `/api/ai/status` says configured.
5. Test `/api/command` with a harmless query.
6. Keep voice/TTS as fallback-only until model quality is proven.
