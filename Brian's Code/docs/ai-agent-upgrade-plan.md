# AI and Agent Upgrade Plan

## Purpose

KeepTally is an inventory operations app for route, store, and warehouse teams. The strongest AI use cases are not generic chat; they are focused operational agents that reduce counting time, prevent stockouts, catch shrinkage, and turn messy field input into safe database actions.

## Current AI Surface

- Voice inventory records speech in the browser, transcribes it on the API, parses the transcript, and writes count adjustments.
- Natural-language commands parse short inventory instructions like "set Coke Zero in Mesa Warehouse to 24".
- Text-to-speech reads prompts back to the operator.
- Local fallback parsing keeps simple count/reason flows usable when AI is unavailable.

## Current Model Defaults

The app now uses environment-configurable model defaults:

- `AI_TEXT_MODEL`: shared fallback for text parsing.
- `AI_COMMAND_MODEL`: natural-language inventory commands. Default: `gpt-5.4-mini`.
- `AI_VOICE_PARSE_MODEL`: voice transcript intent parsing. Default: `gpt-5.4-mini`.
- `AI_AGENT_MODEL`: deeper planning agents. Default: `gpt-5.5`.
- `AI_AUDIO_CHAT_MODEL`: audio-in/audio-out chat. Default: `gpt-audio-mini`.
- `AI_TTS_MODEL`: text-to-speech. Default: `gpt-4o-mini-tts`.
- `AI_TRANSCRIBE_MODEL`: speech-to-text. Default: `gpt-4o-mini-transcribe`.

OpenAI's current model docs recommend `gpt-5.5` for complex reasoning/coding and smaller variants like `gpt-5.4-mini`/`nano` for latency and cost-sensitive workloads. OpenAI's speech docs recommend `gpt-4o-mini-tts` for newer TTS and `gpt-4o-mini-transcribe`/`gpt-4o-transcribe` for speech-to-text. Realtime voice docs recommend the TypeScript Agents SDK with WebRTC for browser voice agents.

Official references:

- https://developers.openai.com/api/docs/models/model-archive
- https://platform.openai.com/docs/guides/text-to-speech
- https://platform.openai.com/docs/guides/speech-to-text
- https://platform.openai.com/docs/guides/realtime
- https://platform.openai.com/docs/guides/agents-sdk

## Speed and Cost Strategy

Use a tiered path:

1. Deterministic local parsing first for simple counts, confirmations, skips, stops, and shrinkage reasons.
2. Low-latency mini model for short structured parsing.
3. Frontier model only for multi-step planning, anomaly explanations, or agent workflows.
4. Realtime/WebRTC architecture for true hands-free counting after the current chained STT -> parse -> TTS flow is stable.

This keeps common field actions fast while preserving the option for deeper reasoning where it actually pays off.

## Recommended Agent Workflows

### Inventory Copilot

User asks: "Show everything below par in Tempe and make a restock list."

Agent steps:

1. Read accessible inventory.
2. Filter by location and par gap.
3. Draft a restock or pick list.
4. Ask for confirmation before writing.
5. Write order and audit history.

### Reorder Planner

Runs on demand or scheduled.

1. Read item history, current quantity, par, warehouse stock, and route sheets.
2. Predict near-term stockouts.
3. Recommend transfers or purchases.
4. Explain reasoning in plain language.
5. Let admin approve, edit, or reject.

### Shrinkage Watcher

1. Monitor adjustment history by item, location, and user.
2. Flag suspicious deltas or repeated low-count reasons.
3. Summarize likely causes.
4. Suggest follow-up tasks.

### Import Mapper

1. Read CSV headers and sample rows.
2. Map columns to item, barcode, location, quantity, sold, par, and cost.
3. Detect duplicates and likely item matches.
4. Preview changes before applying.

### Voice Count Agent

Next-generation version of current voice count:

1. Browser opens a Realtime WebRTC session.
2. Agent guides operator item by item.
3. Agent calls backend tools for lookup, count update, reason logging, and verification.
4. Backend enforces account, permission, and location scope for every tool call.

## Security Guardrails

- AI never writes directly to the database.
- All AI actions route through existing API endpoints and permission checks.
- Any bulk write, delete, user change, transfer, or order creation requires explicit confirmation.
- Prompts receive only account-scoped, location-allowed data.
- API should validate every AI-produced ID against the database before writes.
- Keep audit history for AI-assisted changes, including original transcript/command where practical.

## Implementation Phases

### Phase 1: Done in this pass

- Centralized model defaults for command, voice parse, planning, audio, TTS, and transcription.
- Added fast local parsing before AI for voice count/reason flows.
- Switched TTS to the current speech endpoint model default.
- Added transcription prompt context for inventory vocabulary.
- Added this design plan.

### Phase 2: Low-risk next steps

- Add `/api/ai/suggest-restock` for read-only AI recommendations.
- Add an AI preview panel on the Restock page.
- Add structured JSON schemas for every AI parse result.
- Add telemetry fields for parse latency and fallback rate.

### Phase 3: Agentic workflows

- Add approved backend tools: list inventory, draft order, draft transfer, explain shrinkage.
- Build confirmation UI for agent-proposed writes.
- Add scheduled reorder/shrinkage reports.
- Add Realtime voice agent proof of concept for one location.

### Phase 4: Production hardening

- Add eval fixtures for voice transcripts, CSV imports, and command parsing.
- Add rate limits per user/account, not only per IP.
- Add AI cost budget controls per account.
- Add redaction for sensitive prompts/logs.
- Add model snapshot pinning option for production consistency.
