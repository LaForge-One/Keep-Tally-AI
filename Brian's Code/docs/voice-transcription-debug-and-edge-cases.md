# Voice Transcription Debug and Edge Cases

## Current Workflow

1. The user opens `/voice-check`, selects a location, and chooses a count mode.
2. For AI Voice mode, the app should move into the listening screen immediately after Start.
3. The browser records microphone audio with `MediaRecorder`.
4. The browser stops recording on a seven-second silence gap, timeout, Pause, Finish, Skip, or Repeat.
5. Normal silence creates no transcript and the session can continue.
6. Manual stops must discard the current partial recording.
7. The frontend uploads the audio blob to `POST /api/voice/transcribe`.
8. The API converts browser audio to WAV with `ffmpeg`.
9. The API sends the WAV file to the configured AI transcription endpoint.
10. The transcript is parsed into item, count, reason, skip, or done.
11. In AI Voice mode, the app repeats the parsed item and count for confirmation.
12. The result is saved only after the operator confirms with yes, correct, okay, save, or a similar phrase.

## Known Failure Points

- Stale frontend bundle: the browser shows old messages after code changes, which means the VPS image was not rebuilt or the browser cache has not refreshed.
- Missing `ffmpeg`: browser WebM audio cannot be converted, so transcription fails before it reaches the AI model.
- Unsupported LocalAI audio model: `/v1/audio/transcriptions` can fail even when `/v1/models` lists a model name.
- Slow TTS: Start feels delayed if the UI waits for speech playback before listening.
- TTS during listening: a prompt played while recording can be picked up by the microphone and transcribed as operator input.
- Manual stop upload: Pause, Finish, Skip, or Repeat can feel broken if a partial recording is uploaded after the user clicks.
- Permission delay: the first microphone prompt can take seconds and cannot be made sub-millisecond.
- Empty/silent audio: very short recordings should not be uploaded.
- Cloudflare timeout: slow audio requests can surface as a 502 unless the app fails fast first.

## Expected Performance

- UI transition after clicking Start: immediate.
- Microphone permission check: browser-dependent, usually under a few seconds after permission is already granted.
- Recording stop after silence: seven seconds by current design.
- Audio conversion: normally sub-second for short clips.
- AI transcription: model-dependent, not database-dependent. Local database speed does not control this step.
- Database save after a parsed count: should be fast because the database is on the VPS.

## Edge Cases To Test

- Start AI Voice with microphone permission already granted.
- Start AI Voice with microphone permission blocked.
- Start AI Voice with no microphone device.
- Start AI Voice on HTTP instead of HTTPS.
- Start AI Voice with no inventory at the selected location.
- Click Pause while recording.
- Click Finish while recording.
- Click Skip while recording in queue mode.
- Click Repeat while recording in queue mode.
- Say nothing and wait for the seven-second end-of-utterance timeout.
- Say `done` in custom mode.
- Say an item name without a quantity.
- Say a quantity without a recognizable item name.
- Say an ambiguous item name.
- Say a valid item and count, then say yes to confirm save.
- Say a valid item and count, then say no to prevent save.
- Say a valid item and count, then give an unclear confirmation.
- Say a count that is much higher than the system count.
- Say a count that is lower and provide a shrinkage reason.
- AI transcription endpoint returns 502.
- AI transcription endpoint times out.
- AI transcription endpoint returns JSON with no transcript.
- Browser uploads an unsupported audio format.
- `ffmpeg` exits non-zero.
- User refreshes while recording.

## Required VPS Checks

Run these inside the VPS project directory:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  exec keeptally which ffmpeg
```

Expected:

```bash
/usr/bin/ffmpeg
```

## Voice Quality Settings

Use these in `.env.vps-test` for a less robotic voice:

```bash
AI_TTS_VOICE=shimmer
AI_TTS_INSTRUCTIONS=Use a warm, polite, natural human voice. Keep prompts brief, calm, and easy to understand for an inventory operator.
VITE_VOICE_COUNT_TTS_ENABLED=false
VITE_VOICE_COUNT_CONFIRMATION_AUDIO_ENABLED=true
```

Recommended voice options:

- `shimmer`: friendly, polite, lighter voice.
- `nova`: clear, neutral, professional voice.
- `onyx`: deeper male voice.
- `echo`: lighter male voice.

If LocalAI does not support the selected voice for the active `AI_TTS_MODEL`, the API will return a TTS error and the browser will fall back to browser speech.

For transcription testing, keep `VITE_VOICE_COUNT_TTS_ENABLED=false`. This prevents the app from using the slower server TTS path while the microphone workflow is active. Keep `VITE_VOICE_COUNT_CONFIRMATION_AUDIO_ENABLED=true` so short browser-native confirmation prompts still play after the app hears an item and count.

Check whether the deployed frontend is current:

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  exec keeptally grep -R "Voice transcription failed on the VPS AI service" /app/artifacts/keep-tally/dist/public
```

If that returns nothing, the VPS is still serving an old frontend bundle.

## Debug Log Command

```bash
docker compose \
  -f docker-compose.vps.example.yml \
  -f docker-compose.ai.example.yml \
  -f docker-compose.vps-test.override.yml \
  --env-file .env.vps-test \
  --env-file .env.ai \
  logs --tail=200 keeptally | grep -iE "voice|transcri|ffmpeg|audio|timeout|error"
```

## Design Recommendation

The current workflow is still request/response transcription. That is acceptable for a test environment, but it will not feel instantaneous. For the fastest production-grade workflow, move AI Voice mode toward a streaming audio design:

- Keep Start, Pause, and Finish entirely local UI actions.
- Stream microphone audio to a dedicated voice service.
- Return partial transcripts as events.
- Parse commands incrementally.
- Save counts only after a confirmed parsed command.

## What Gets Recorded Today

- The browser records a temporary audio clip only long enough to request transcription.
- Raw audio is not saved to disk or PostgreSQL.
- The transcript is shown in the UI, but it is not stored in a dedicated transcript table.
- A database write happens only after the app has parsed and confirmed a count.
- Matching counts call `POST /api/items/:id/verify`, which writes a history record.
- Changed counts call `POST /api/items/:id/adjust`, which updates inventory and writes a history record.

## Current Accounting Gap

The current implementation records the final inventory action, not the full voice-count session. Accounting can see that an item was verified or adjusted, but cannot yet see a durable record of each spoken prompt, transcript, confirmation, skipped item, or failed transcription. The recommended upgrade is to add count session tables before production accounting use.
