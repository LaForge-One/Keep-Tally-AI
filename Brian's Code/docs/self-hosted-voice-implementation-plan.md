# Self-Hosted Voice Implementation Plan

Date: 2026-07-22

## Purpose

`self-hosted-ai-stack.md` and `ai-agent-upgrade-plan.md` already cover moving text/command AI off OpenAI (LocalAI or Ollama behind `AI_INTEGRATIONS_OPENAI_BASE_URL`). Voice was explicitly deferred there:

> Realtime voice should remain disabled until we intentionally design a local realtime replacement.
> CPU-only VPS ... Poor: realtime voice, fast transcription, high-quality TTS.
> Keep voice/TTS as fallback-only until model quality is proven.

This plan closes that gap for the existing push-to-talk voice count flow (`POST /voice/transcribe`, `POST /voice/speak`, `POST /voice/parse` in `artifacts/api-server/src/routes/voice.ts`). It does not attempt the Realtime/WebRTC voice agent from `ai-agent-upgrade-plan.md` Phase 3 — that's a separate, larger effort with different latency requirements.

## Current State (verified against code)

- `lib/integrations-openai-ai-server/src/audio/client.ts` builds one `OpenAI` client from `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY`, used for **both** chat completions (text/command/parse) and audio (`speechToText`, `textToSpeech`, `voiceChat`).
- The existing self-hosted overlays (`docker-compose.ai.example.yml`, `docker-compose.ollama-ai.example.yml`) repoint that single base URL at LocalAI or Ollama. Ollama has no audio endpoints, so enabling either overlay today leaves voice silently dependent on whichever base URL is active — if that's Ollama, voice breaks outright.
- `voice.ts` hardcodes accepted TTS voices to OpenAI's own set: `alloy, ash, ballad, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse, cedar` (`TTS_VOICES` const, `SpeakSchema`).
- Timeouts are tuned for OpenAI's cloud latency: `VOICE_TRANSCRIBE_TIMEOUT_MS=25000`, `VOICE_TTS_TIMEOUT_MS=8000`, `VOICE_FORMAT_TIMEOUT_MS=10000`.
- `speechToText` already sends a domain-vocabulary `prompt`: *"Inventory terms may include product names, counts, route names, warehouse names, par levels, theft, spoilage, comp, damaged, and missing from bin."* This is Whisper's prompt-biasing feature — needs to survive the swap.
- Failure behavior is already close to what we want: transcription failure → 502/504 with request id, frontend falls back to empty transcript and continues; TTS failure fails silently, session isn't blocked. No changes needed here, just confirm it still holds with a self-hosted backend.
- The voice count flow (`/voice/sessions`, `/voice/sessions/:id/events`) is already turn-based, one utterance at a time — this matches a push-to-talk design naturally; no session/state-machine changes needed.

## Decisions (carried over from design review)

- **Interaction style:** push-to-talk, one utterance per call — already how the app works, no change needed.
- **Hardware:** CPU-only for now, same box as the rest of the staging stack.
- **STT model:** `faster-whisper-small` to start. Watch accuracy specifically on domain terms (SKU codes, warehouse location names) — that's the known failure mode for a small checkpoint. Bump to `medium` if testing shows it's a real problem.
- **TTS model/voice:** Kokoro, voice `af_bella` (Kokoro's own quality grade: A-).
- **Audio transport:** plain HTTP request/response — already what `/voice/transcribe` and `/voice/speak` do, no change needed.
- **Failure behavior:** fall back to text — already the existing behavior, confirm it holds.
- **GPU contention:** deferred, not relevant until a GPU box exists.

## Required Code Changes

### 1. Split the audio client onto its own base URL

Text (chat completions) needs to keep pointing at Ollama/LocalAI. Audio needs to point at a Speaches container instead, since Ollama can't serve `/v1/audio/*`. These can't share one client anymore.

In `lib/integrations-openai-ai-server/src/audio/client.ts`, change:

```ts
export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
```

to read a dedicated audio base URL, falling back to the existing shared one so nothing breaks for accounts still on OpenAI for everything:

```ts
const AUDIO_BASE_URL =
  process.env.AI_AUDIO_INTEGRATIONS_OPENAI_BASE_URL ??
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const AUDIO_API_KEY =
  process.env.AI_AUDIO_INTEGRATIONS_OPENAI_API_KEY ??
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

export const openai = new OpenAI({
  apiKey: AUDIO_API_KEY,
  baseURL: AUDIO_BASE_URL,
});
```

The existing top-of-file checks for missing base URL/key should validate against the resolved `AUDIO_BASE_URL`/`AUDIO_API_KEY`, not the raw env vars, so the fallback actually works.

### 2. Widen the TTS voice type to accept Kokoro voices

In `voice.ts`, `TTS_VOICES` is a strict literal union matched to OpenAI's voice catalog. Add the Kokoro voices we intend to use:

```ts
const TTS_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "marin",
  "nova", "onyx", "sage", "shimmer", "verse", "cedar",
  "af_bella", "af_heart", "af_nicole", // Kokoro voices
] as const;
```

Set `AI_TTS_VOICE=af_bella` in the self-hosted env file so `DEFAULT_TTS_VOICE` resolves correctly without a frontend change.

### 3. Raise voice timeouts for CPU inference

`VOICE_TTS_TIMEOUT_MS=8000` and `VOICE_TRANSCRIBE_TIMEOUT_MS=25000` were tuned for OpenAI's cloud latency. CPU-hosted `faster-whisper-small` + Kokoro will likely need more headroom, especially for longer utterances. Don't guess a number — measure real latency during validation (below) and set these explicitly in the self-hosted env file rather than relying on the defaults.

### 4. Verify prompt-biasing compatibility

Confirm Speaches passes the OpenAI-style `prompt` field through to faster-whisper's `initial_prompt` (this is what the existing inventory-vocabulary prompt in `speechToText` relies on). If it doesn't forward automatically, this needs a small adapter — check during validation, don't assume.

## New Infrastructure

### `docker-compose.voice-ai.example.yml`

New overlay, composable on top of the existing Ollama overlay, following the same pattern as `docker-compose.ollama-ai.example.yml`:

```yaml
# Voice overlay for KeepTally VPS — self-hosted STT/TTS via Speaches.
# Usage (on top of the existing Ollama text overlay):
#   docker compose \
#     -f docker-compose.vps.example.yml \
#     -f docker-compose.ollama-ai.example.yml \
#     -f docker-compose.voice-ai.example.yml \
#     --env-file .env.production --env-file .env.ai --env-file .env.voice-ai \
#     up -d

services:
  keeptally:
    environment:
      AI_AUDIO_INTEGRATIONS_OPENAI_BASE_URL: http://speaches:8000/v1
      AI_AUDIO_INTEGRATIONS_OPENAI_API_KEY: ${SPEACHES_API_KEY:-keeptally-local-voice}
      AI_TRANSCRIBE_MODEL: ${SPEACHES_STT_MODEL:-Systran/faster-whisper-small}
      AI_TTS_MODEL: ${SPEACHES_TTS_MODEL:-kokoro}
      AI_TTS_VOICE: ${SPEACHES_TTS_VOICE:-af_bella}
      VOICE_TRANSCRIBE_TIMEOUT_MS: ${VOICE_TRANSCRIBE_TIMEOUT_MS:-25000}
      VOICE_TTS_TIMEOUT_MS: ${VOICE_TTS_TIMEOUT_MS:-8000}
    depends_on:
      speaches:
        condition: service_started

  speaches:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
    container_name: keeptally-voice
    restart: unless-stopped
    volumes:
      - speaches-models:/home/ubuntu/.cache/huggingface
    environment:
      WHISPER__MODEL: ${SPEACHES_STT_MODEL:-Systran/faster-whisper-small}
      TTS__MODEL: ${SPEACHES_TTS_MODEL:-kokoro}
    expose:
      - "8000"

volumes:
  speaches-models:
```

Values (timeout defaults, model names) are placeholders to confirm against the Speaches version pinned at build time — same caveat as the existing example overlays.

### `.env.voice-ai.example`

```env
# Self-hosted voice overlay values for docker-compose.voice-ai.example.yml
SPEACHES_API_KEY=replace-with-a-local-random-secret
SPEACHES_STT_MODEL=Systran/faster-whisper-small
SPEACHES_TTS_MODEL=kokoro
SPEACHES_TTS_VOICE=af_bella

# Raise if CPU latency testing shows the OpenAI-tuned defaults are too tight.
VOICE_TRANSCRIBE_TIMEOUT_MS=25000
VOICE_TTS_TIMEOUT_MS=8000
```

## Validation Checklist

Following the pattern in `self-hosted-ai-stack.md` (Recommended First Test) and `ai-voice-edge-case-review.md` (Recommended Post-Credential Test Pass):

1. Bring up the Ollama text overlay + new voice overlay together.
2. Confirm `speaches` container is healthy and `/v1/models` responds.
3. Hit `POST /voice/transcribe` with a short real audio sample containing at least one SKU code or warehouse name — check transcription accuracy specifically on those domain terms, not just plain speech.
4. Hit `POST /voice/speak` with `af_bella` on a handful of real KeepTally-style sentences (quantities, SKU codes, location names) — confirm it sounds acceptable, not just that it returns audio.
5. Measure actual round-trip latency for both calls under CPU load; adjust `VOICE_TRANSCRIBE_TIMEOUT_MS`/`VOICE_TTS_TIMEOUT_MS` in `.env.voice-ai` based on real numbers, not the OpenAI-tuned defaults.
6. If transcription accuracy on domain terms is poor, swap `SPEACHES_STT_MODEL` to a `medium` checkpoint and re-test before accepting the latency cost.
7. Confirm the existing failure-fallback behavior still holds: kill the `speaches` container mid-session and verify `/voice/transcribe` returns 502/504 cleanly and the frontend degrades to text, matching `ai-voice-edge-case-review.md`.
8. Run the existing regression suite to confirm no unrelated breakage:
   ```bash
   corepack pnpm run smoke
   corepack pnpm run workflow:test
   ```
9. Confirm `GET /api/ai/status` still reports correctly with the split base URLs in place.

## Explicitly Out of Scope for This Pass

- GPU contention between the Voice Service and the Ollama/LocalAI inference container — deferred until a GPU box is actually provisioned.
- The Realtime/WebRTC Voice Count Agent from `ai-agent-upgrade-plan.md` Phase 3 — different architecture, different latency budget, separate effort.

## Related Docs

- `self-hosted-ai-stack.md` — text/command AI overlay this plan extends.
- `ai-agent-upgrade-plan.md` — broader AI roadmap; this plan is the voice piece of the "Current AI Surface" section.
- `ai-voice-edge-case-review.md` — existing voice failure-handling behavior this plan relies on and should not regress.
- `mobile-voice-api-performance-design.md`, `voice-transcription-debug-and-edge-cases.md` — not yet cross-checked against this plan; worth a pass before implementation starts.
