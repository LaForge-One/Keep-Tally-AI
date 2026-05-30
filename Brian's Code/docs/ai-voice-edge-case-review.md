# AI Voice Edge Case Review

Date: 2026-05-29

## Current State

The app currently supports a fallback voice workflow:

1. Browser records microphone audio with `MediaRecorder`.
2. Browser uploads audio to `/api/voice/transcribe`.
3. Backend transcribes audio through OpenAI audio transcription.
4. Frontend sends transcript to `/api/voice/parse`.
5. Backend returns a structured action.
6. Frontend writes inventory changes through ordinary inventory endpoints.
7. Optional `/api/voice/speak` returns TTS audio.

Until OpenAI credentials are available, the app now exposes:

- `GET /api/ai/status`
- `configured: false`
- `apiKeyConfigured: false`
- `realtimeEnabled: false`
- `voiceFallbackEnabled: true`

This lets the UI distinguish between browser voice support and backend AI readiness.

## Edge Cases Covered Now

### Missing AI Credentials

Expected behavior:

- App still starts.
- Normal inventory workflows still work.
- `/api/ai/status` reports that AI is not configured.
- `/api/voice/parse` returns a controlled service error when model parsing is required.
- Quantity and reason parsing still use deterministic fallbacks where possible.

Verified:

- `corepack pnpm run smoke`: passed.
- `corepack pnpm run workflow:test`: 55/55 passed.
- `/api/ai/status` returns `configured: false` with local placeholder credentials.

### Missing Browser Microphone Permission

Current behavior:

- `useAIVoice.listen()` catches microphone access errors and returns an empty transcript.
- Voice session continues or skips depending on the workflow state.

Recommended improvement:

- Surface a visible message: "Microphone permission is blocked. Enable microphone access to use voice count."
- Offer a non-voice manual count fallback button in the same screen.

### TTS Failure

Current behavior:

- `speak()` fails silently so a session is not blocked by missing TTS.

Recommended improvement:

- Keep silent fallback for the main workflow.
- Add a small status indicator so operators know prompts are text/vibration-only.

### Transcription Failure

Current behavior:

- `/api/voice/transcribe` returns 502 with a request id.
- Frontend resolves an empty transcript and continues.

Recommended improvement:

- Count repeated failures in the session.
- After 2-3 failures, suggest switching to manual mode or checking connectivity.

### AI Parse Failure

Current behavior:

- Quantity mode falls back to local number parsing.
- Reason mode falls back to local reason parsing.
- Custom mode returns unknown when AI parse is unavailable.

Recommended improvement:

- Add local custom parsing fallback for item-name plus quantity, matching the existing frontend helper.
- Return `200 { action: "unknown", aiUnavailable: true }` for expected no-credential cases instead of 502 if the UI should treat it as a normal fallback state.

### Unauthorized Voice Writes

Issue found:

- Voice adjustment and verification writes did not explicitly include browser credentials.

Fix applied:

- `saveAdjustment()` and `logVerification()` now send `credentials: "include"`.
- They throw when the backend rejects the write.

Recommended improvement:

- Catch those write failures at call sites and show "Could not save count. Try again."

### Permission And Location Scope

Current behavior:

- Voice routes require authenticated account and active membership.
- The voice router is gated by `use_voice_mode`.
- Parse filters custom-mode item IDs by account/location access before sending item choices to the model.
- Actual item writes go through normal inventory endpoints and permission checks.

Recommended improvement:

- Add tests for stocker users with limited assigned locations.
- Add tests that attempt to parse or write inaccessible item IDs.

### Ambiguous Item Names

Risk:

- "Coke five" could match multiple Coke products.
- Realtime voice could call a write tool too eagerly.

Recommended improvement:

- If multiple matches are close, ask a clarification question.
- Do not write until the user confirms the item when confidence is low.
- Include location in prompts and tool calls.

### Quantity Edge Cases

Risk cases:

- Negative numbers.
- Very large numbers.
- Decimals.
- "A dozen", "case", "box", "half".
- "No change", "same as before", "empty".

Recommended improvement:

- Add deterministic parsing fixtures.
- Clamp or reject impossible counts.
- Ask confirmation for large deltas, for example changes above 2x par.

### Session Control

Risk cases:

- User says "stop" while TTS is playing.
- User navigates away mid-recording.
- App sleeps or loses wake lock.
- Browser tab reloads while a count is in progress.

Current behavior:

- `cancelAll()` stops speech/listening.
- Cleanup on unmount stops recording and releases wake lock.

Recommended improvement:

- Add session autosave so partial results survive reload.
- Add "resume last voice session" for interrupted sessions.

### Network Interruptions

Risk:

- Count is heard, but save request fails.
- Operator thinks count was saved because TTS said "Saved."

Recommended improvement:

- Only speak "Saved" after the write response is OK.
- Queue failed writes locally and show a retry banner.

## Recommended Pre-Credential Hardening Pass

1. Add frontend UI for `/api/ai/status`. Done.
2. Disable or label AI-only voice controls when `configured` is false. Done.
3. Add local custom parse fallback for item plus quantity. Done.
4. Add visible microphone-permission and transcription-failure states. Done.
5. Add tests for:
   - missing credentials
   - empty transcript
   - ambiguous item match
   - unauthorized item id
   - write failure
   - large quantity delta confirmation

## Implemented On 2026-05-29

- Added AI status messaging to the voice count setup flow.
- Relabeled custom voice mode as offline/local matching while credentials are missing.
- Added detailed microphone/transcription failure handling.
- Added local custom-mode item plus quantity parsing fallback.
- Added ambiguity detection for close item-name matches.
- Added large quantity delta confirmation before writes.
- Wrapped voice adjustment and verification writes so failures are visible and are not announced as saved.

## Recommended Post-Credential Test Pass

Once credentials are available:

1. Verify `/api/voice/transcribe` with a short real audio sample.
2. Verify `/api/voice/speak` returns playable audio.
3. Verify `/api/voice/parse` custom mode with real item names.
4. Run a full voice count session against seeded data.
5. Add a realtime proof of concept with backend-issued ephemeral sessions.

## Commands

Current offline checks:

```bash
corepack pnpm run smoke
corepack pnpm run workflow:test
curl http://localhost:3000/api/ai/status
```

Expected local AI status before credentials:

```json
{
  "configured": false,
  "apiKeyConfigured": false,
  "realtimeEnabled": false,
  "voiceFallbackEnabled": true
}
```
