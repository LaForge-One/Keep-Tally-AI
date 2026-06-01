import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { ensureCompatibleFormat, speechToText, textToSpeech } from "@workspace/integrations-openai-ai-server/audio";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  countSessionEventsTable,
  countSessionsTable,
  db,
  itemsTable,
  locationsTable,
  type ItemRow,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  canAccessLocation,
  canViewAllLocations,
  requireAccount,
  requireActiveMembership,
} from "../middleware/auth";
import { AI_LIMITS, AI_MODELS } from "../lib/ai-config";
import { getErrorMessage } from "../lib/http-errors";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(requireAccount, requireActiveMembership);

const VOICE_FORMAT_TIMEOUT_MS = Number.parseInt(process.env.VOICE_FORMAT_TIMEOUT_MS ?? "10000", 10);
const VOICE_TRANSCRIBE_TIMEOUT_MS = Number.parseInt(process.env.VOICE_TRANSCRIBE_TIMEOUT_MS ?? "25000", 10);
const VOICE_TTS_TIMEOUT_MS = Number.parseInt(process.env.VOICE_TTS_TIMEOUT_MS ?? "8000", 10);
const TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "marin",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "cedar",
] as const;
type TtsVoice = (typeof TTS_VOICES)[number];
const DEFAULT_TTS_VOICE: TtsVoice = TTS_VOICES.includes(process.env.AI_TTS_VOICE as TtsVoice)
  ? (process.env.AI_TTS_VOICE as TtsVoice)
  : "shimmer";

class VoiceTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VoiceTimeoutError(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function voiceErrorStatus(err: unknown) {
  return err instanceof VoiceTimeoutError ? 504 : 502;
}

function voiceErrorDetails(err: unknown) {
  if (process.env.NODE_ENV === "production") return undefined;
  return getErrorMessage(err);
}

const StartSessionSchema = z.object({
  locationId: z.number().int().positive().nullable().optional(),
  locationName: z.string().trim().min(1).max(120).nullable().optional(),
  mode: z.string().trim().min(1).max(40),
  itemCount: z.number().int().min(0).max(100000).default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const SessionEventSchema = z.object({
  eventType: z.string().trim().min(1).max(80),
  itemId: z.number().int().positive().nullable().optional(),
  itemName: z.string().trim().max(200).nullable().optional(),
  action: z.string().trim().max(80).nullable().optional(),
  status: z.string().trim().max(80).nullable().optional(),
  expectedQuantity: z.number().int().min(0).nullable().optional(),
  countedQuantity: z.number().int().min(0).nullable().optional(),
  reason: z.string().trim().max(200).nullable().optional(),
  transcript: z.string().trim().max(1000).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  message: z.string().trim().max(1000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CompleteSessionSchema = z.object({
  status: z.enum(["completed", "paused", "cancelled", "failed"]).default("completed"),
  verifiedCount: z.number().int().min(0).default(0),
  updatedCount: z.number().int().min(0).default(0),
  skippedCount: z.number().int().min(0).default(0),
  noResponseCount: z.number().int().min(0).default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

async function canUseLocationForSession(req: Request, locationId?: number | null, locationName?: string | null) {
  if (locationId) {
    const [location] = await db
      .select()
      .from(locationsTable)
      .where(and(eq(locationsTable.accountId, req.account!.id), eq(locationsTable.id, locationId)))
      .limit(1);
    if (!location || location.status !== "active") return false;
    if (canViewAllLocations(req)) return true;
    if ((req.allowedLocationIds ?? []).includes(location.id)) return true;
    return canAccessLocation(req, location.name);
  }

  if (!locationName) return true;
  if (canViewAllLocations(req)) return true;
  return canAccessLocation(req, locationName);
}

async function findAccountSession(req: Request, sessionId: number) {
  const [session] = await db
    .select()
    .from(countSessionsTable)
    .where(and(eq(countSessionsTable.accountId, req.account!.id), eq(countSessionsTable.id, sessionId)))
    .limit(1);
  return session ?? null;
}

router.post("/voice/sessions", async (req: Request, res: Response) => {
  const parsed = StartSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { locationId, locationName, mode, itemCount, metadata } = parsed.data;
  if (!(await canUseLocationForSession(req, locationId, locationName))) {
    res.status(403).json({ error: "Permission denied for this location" });
    return;
  }

  const [session] = await db
    .insert(countSessionsTable)
    .values({
      accountId: req.account!.id,
      userId: req.authUser?.id ?? null,
      locationId: locationId ?? null,
      locationName: locationName ?? null,
      mode,
      itemCount,
      metadata: metadata ?? {},
    })
    .returning();

  logger.info({ requestId: req.id, sessionId: session?.id, mode, itemCount }, "Voice count session started");
  res.status(201).json({ id: session!.id, status: session!.status });
});

router.post("/voice/sessions/:id/events", async (req: Request, res: Response) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  const parsed = SessionEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const session = await findAccountSession(req, sessionId);
  if (!session) {
    res.status(404).json({ error: "Voice count session not found" });
    return;
  }

  const event = parsed.data;
  const [row] = await db
    .insert(countSessionEventsTable)
    .values({
      accountId: req.account!.id,
      sessionId,
      userId: req.authUser?.id ?? null,
      locationId: session.locationId,
      itemId: event.itemId ?? null,
      itemName: event.itemName ?? null,
      eventType: event.eventType,
      action: event.action ?? null,
      status: event.status ?? null,
      expectedQuantity: event.expectedQuantity ?? null,
      countedQuantity: event.countedQuantity ?? null,
      reason: event.reason ?? null,
      transcript: event.transcript ?? null,
      confidence: event.confidence ?? null,
      message: event.message ?? null,
      metadata: event.metadata ?? {},
    })
    .returning({ id: countSessionEventsTable.id });

  logger.info({ requestId: req.id, sessionId, eventType: event.eventType }, "Voice count session event recorded");
  res.status(201).json({ id: row!.id });
});

router.patch("/voice/sessions/:id", async (req: Request, res: Response) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  const parsed = CompleteSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const session = await findAccountSession(req, sessionId);
  if (!session) {
    res.status(404).json({ error: "Voice count session not found" });
    return;
  }

  const { status, verifiedCount, updatedCount, skippedCount, noResponseCount, metadata } = parsed.data;
  const [updated] = await db
    .update(countSessionsTable)
    .set({
      status,
      verifiedCount,
      updatedCount,
      skippedCount,
      noResponseCount,
      metadata: metadata ?? session.metadata,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(countSessionsTable.accountId, req.account!.id), eq(countSessionsTable.id, sessionId)))
    .returning({ id: countSessionsTable.id, status: countSessionsTable.status });

  logger.info({ requestId: req.id, sessionId, status }, "Voice count session completed");
  res.json(updated);
});

/* ── POST /voice/transcribe ─────────────────────────────────────────
   Accepts audio file upload, returns transcript.
   Field name: "audio"
──────────────────────────────────────────────────────────────────── */
router.post(
  "/voice/transcribe",
  upload.single("audio"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No audio file provided (field: audio)" });
      return;
    }

    try {
      const audioBuffer = req.file.buffer;
      logger.info({
        requestId: req.id,
        bytes: audioBuffer.length,
        mimetype: req.file.mimetype,
        model: process.env.AI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
      }, "Voice transcription requested");
      const { buffer, format } = await withTimeout(
        ensureCompatibleFormat(audioBuffer),
        VOICE_FORMAT_TIMEOUT_MS,
        "Audio format conversion timed out",
      );
      logger.info({ requestId: req.id, bytes: buffer.length, format }, "Voice audio converted");
      const transcript = await withTimeout(
        speechToText(buffer, format),
        VOICE_TRANSCRIBE_TIMEOUT_MS,
        "Voice transcription timed out",
      );
      logger.info({ requestId: req.id, transcriptLength: transcript.length }, "Voice transcription completed");
      res.json({ transcript: transcript.trim() });
    } catch (err) {
      logger.error({ err, requestId: req.id }, "Voice transcription failed");
      res.status(voiceErrorStatus(err)).json({
        error: err instanceof VoiceTimeoutError ? err.message : "Transcription service failed",
        requestId: req.id,
        details: voiceErrorDetails(err),
      });
    }
  },
);

/* ── POST /voice/speak ──────────────────────────────────────────────
   Accepts { text }, returns audio/wav buffer.
──────────────────────────────────────────────────────────────────── */
const SpeakSchema = z.object({
  text: z.string().min(1).max(500),
  voice: z.enum(TTS_VOICES).optional(),
});

router.post("/voice/speak", async (req: Request, res: Response) => {
  const parsed = SpeakSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { text } = parsed.data;
  const voice = parsed.data.voice ?? DEFAULT_TTS_VOICE;

  try {
    logger.info({
      requestId: req.id,
      textLength: text.length,
      voice,
      model: process.env.AI_TTS_MODEL ?? "gpt-4o-mini-tts",
    }, "Voice text-to-speech requested");
    const audioBuffer = await withTimeout(
      textToSpeech(text, voice, "wav"),
      VOICE_TTS_TIMEOUT_MS,
      "Text-to-speech timed out",
    );
    logger.info({ requestId: req.id, bytes: audioBuffer.length }, "Voice text-to-speech completed");
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", audioBuffer.length);
    res.send(audioBuffer);
  } catch (err) {
    logger.error({ err, requestId: req.id }, "Voice text-to-speech failed");
    res.status(voiceErrorStatus(err)).json({
      error: err instanceof VoiceTimeoutError ? err.message : "Text-to-speech service failed",
      requestId: req.id,
      details: voiceErrorDetails(err),
    });
  }
});

/* ── POST /voice/parse ──────────────────────────────────────────────
   Accepts a transcript + list of items, returns structured action.
   mode: "quantity"  — user is answering "how many of [item] do you have?"
         "reason"    — user is giving a shrinkage reason
         "custom"    — user is naming item + quantity freely
──────────────────────────────────────────────────────────────────── */

type ParseMode = "quantity" | "reason" | "custom";

const ItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  parLevel: z.number(),
  minQuantity: z.number().optional(),
  maxQuantity: z.number().optional(),
});

const ParseSchema = z.object({
  transcript: z.string(),
  items: z.array(ItemSchema),
  mode: z.enum(["quantity", "reason", "custom"]).default("custom"),
  currentItemName: z.string().optional(),
  currentParLevel: z.number().optional(),
  currentMinQuantity: z.number().optional(),
  currentMaxQuantity: z.number().optional(),
});

type ParseResult =
  | { action: "verify" }
  | { action: "count"; quantity: number }
  | { action: "skip" }
  | { action: "done" }
  | { action: "reason"; reason: string }
  | { action: "custom"; itemId: number; itemName: string; quantity: number }
  | { action: "unknown" };

const WORD_MAP: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

function wordToNumber(text: string): number | null {
  const words = text.replace(/-/g, " ").split(/\s+/).filter(Boolean);
  for (let index = 0; index < words.length; index += 1) {
    const value = WORD_MAP[words[index]!];
    if (value === undefined) continue;
    const next = WORD_MAP[words[index + 1] ?? ""];
    if (next !== undefined && value >= 20 && next < 10) return value + next;
    return value;
  }
  return null;
}

function parseQuantityFast(transcript: string, expected: number | undefined): ParseResult | null {
  const text = transcript.toLowerCase().trim();
  if (!text) return { action: "unknown" };
  if (/\b(done|stop|finish|exit|complete)\b/.test(text)) return { action: "done" };
  if (/\b(skip|next|pass)\b/.test(text)) return { action: "skip" };
  if (
    expected !== undefined &&
    /\b(correct|right|yes|same|good|confirmed|verified|yep|yeah)\b/.test(text)
  ) {
    return { action: "verify" };
  }
  const digitMatch = text.match(/\b(\d+)\b/);
  if (digitMatch) return { action: "count", quantity: Number.parseInt(digitMatch[1]!, 10) };
  const spoken = wordToNumber(text);
  return spoken === null ? null : { action: "count", quantity: spoken };
}

function parseReasonFast(transcript: string): ParseResult {
  const text = transcript.toLowerCase();
  if (/theft|stolen|steal|rob|took/.test(text)) return { action: "reason", reason: "Theft" };
  if (/spoil|expired|bad|rotten|old/.test(text)) return { action: "reason", reason: "Spoilage" };
  if (/comp|compliment|complimentary|free|gift|gave/.test(text)) return { action: "reason", reason: "Comp" };
  if (/return|warehouse|send back|sent back/.test(text)) return { action: "reason", reason: "Return to Warehouse" };
  if (/damage|broken|cracked|crushed|damaged/.test(text)) return { action: "reason", reason: "Damaged" };
  if (/missing|not there|can't find|cant find|empty|bin/.test(text)) return { action: "reason", reason: "Missing from Bin" };
  return { action: "reason", reason: "Adjustment" };
}

function canAccessItem(req: Request, item: ItemRow): boolean {
  if (canViewAllLocations(req)) return true;
  if (item.locationId !== null && (req.allowedLocationIds ?? []).includes(item.locationId)) return true;
  return canAccessLocation(req, item.location);
}

async function filterAllowedVoiceItems(req: Request, items: z.infer<typeof ItemSchema>[]) {
  if (items.length === 0) return [];

  const itemIds = [...new Set(items.map((item) => item.id))];
  const rows = await db
    .select()
    .from(itemsTable)
    .where(and(eq(itemsTable.accountId, req.account!.id), inArray(itemsTable.id, itemIds)));
  const allowedIds = new Set(
    rows
      .filter((item) => canAccessItem(req, item))
      .map((item) => item.id),
  );

  return items.filter((item) => allowedIds.has(item.id));
}

function buildPrompt(
  transcript: string,
  mode: ParseMode,
  items: z.infer<typeof ItemSchema>[],
  currentItemName?: string,
  currentParLevel?: number,
  currentMinQuantity?: number,
  currentMaxQuantity?: number,
): string {
  if (mode === "quantity") {
    return `You are parsing a voice inventory response.
The operator was asked how many of "${currentItemName}" they see.
The stock range is minimum ${currentMinQuantity ?? currentParLevel ?? 0} and maximum ${currentMaxQuantity ?? currentParLevel ?? 0}.
Transcript: "${transcript}"

Return ONLY valid JSON, no other text.

Possible responses:
- {"action":"verify"} — user says correct/yes/same/right/good/confirmed
- {"action":"count","quantity":N} — user says a number (digit or word)
- {"action":"skip"} — user says skip/next/pass
- {"action":"done"} — user says done/stop/finish/exit
- {"action":"unknown"} — transcript unclear

Examples:
"yes" → {"action":"verify"}
"correct" → {"action":"verify"}
"five" → {"action":"count","quantity":5}
"it's 3" → {"action":"count","quantity":3}
"only 2" → {"action":"count","quantity":2}
"skip" → {"action":"skip"}
"done" → {"action":"done"}`;
  }

  if (mode === "reason") {
    return `You are parsing a voice inventory shrinkage reason.
The operator was asked why "${currentItemName}" count is low.
Transcript: "${transcript}"

Return ONLY valid JSON, no other text.

Map to one of: Theft, Spoilage, Comp, Return to Warehouse, Damaged, Missing from Bin, Adjustment.

Examples:
"theft" or "stolen" or "someone took it" → {"action":"reason","reason":"Theft"}
"expired" or "spoiled" or "bad" → {"action":"reason","reason":"Spoilage"}
"gave it away" or "complimentary" → {"action":"reason","reason":"Comp"}
"sent back" or "return" → {"action":"reason","reason":"Return to Warehouse"}
"broken" or "damaged" or "crushed" → {"action":"reason","reason":"Damaged"}
"missing" or "not there" or "empty bin" → {"action":"reason","reason":"Missing from Bin"}
anything else → {"action":"reason","reason":"Adjustment"}`;
  }

  // mode === "custom"
  const itemList = items.slice(0, 80).map((it) => {
    const min = it.minQuantity ?? it.parLevel;
    const max = it.maxQuantity ?? it.parLevel;
    return `${it.id}:"${it.name}" (range ${min}-${max})`;
  }).join(", ");
  return `You are an inventory assistant parsing a voice command.
The operator says an item name and a quantity count.
Transcript: "${transcript}"
Available items: [${itemList}]

Return ONLY valid JSON, no other text.

Rules:
- Match item by name (fuzzy, partial OK — "coke" matches "Coke Zero 20oz")
- Extract the quantity number
- If transcript says "done"/"stop"/"finish"/"exit" → {"action":"done"}
- If no item found or no quantity → {"action":"unknown"}

Examples:
"coke zero 5" → {"action":"custom","itemId":42,"itemName":"Coke Zero 20oz","quantity":5}
"red bull three" → {"action":"custom","itemId":7,"itemName":"Red Bull 8.4oz","quantity":3}
"done" → {"action":"done"}`;
}

router.post("/voice/parse", async (req: Request, res: Response) => {
  const parsed = ParseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const {
    transcript,
    items,
    mode,
    currentItemName,
    currentParLevel,
    currentMinQuantity,
    currentMaxQuantity,
  } = parsed.data;

  if (!transcript.trim()) {
    const result: ParseResult = { action: "unknown" };
    res.json(result);
    return;
  }

  try {
    logger.info({
      requestId: req.id,
      mode,
      itemCount: items.length,
      transcriptLength: transcript.length,
    }, "Voice parse requested");
    if (mode === "quantity") {
      const fastResult = parseQuantityFast(transcript, currentParLevel);
      if (fastResult) {
        logger.info({ requestId: req.id, mode, result: fastResult.action }, "Voice parse fast result");
        res.json(fastResult);
        return;
      }
    }

    if (mode === "reason") {
      const reasonResult = parseReasonFast(transcript);
      logger.info({ requestId: req.id, mode, result: reasonResult }, "Voice parse fast result");
      res.json(reasonResult);
      return;
    }

    const allowedItems = mode === "custom" ? await filterAllowedVoiceItems(req, items) : items;
    logger.info({ requestId: req.id, mode, allowedItemCount: allowedItems.length }, "Voice parse allowed items loaded");
    const prompt = buildPrompt(
      transcript,
      mode,
      allowedItems,
      currentItemName,
      currentParLevel,
      currentMinQuantity,
      currentMaxQuantity,
    );

    const response = await openai.chat.completions.create({
      model: AI_MODELS.voiceParser,
      max_completion_tokens: AI_LIMITS.voiceParserMaxOutputTokens,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "";

    let result: ParseResult;
    try {
      result = content ? (JSON.parse(content) as ParseResult) : { action: "unknown" };
    } catch {
      result = { action: "unknown" };
    }

    logger.info({ requestId: req.id, mode, result }, "Voice parse completed");
    res.json(result);
  } catch (err) {
    logger.error({ err, requestId: req.id }, "Voice parse failed");
    res.status(502).json({ error: "Voice parse service failed", requestId: req.id });
  }
});

export default router;
