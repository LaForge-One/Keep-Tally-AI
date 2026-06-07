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
  warehouseItemsTable,
  type ItemRow,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  canAccessLocation,
  canViewAllLocations,
  requireAccount,
  requireActiveMembership,
  requirePermission,
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
  : "nova";

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
      const glossary = typeof req.body?.glossary === "string" ? req.body.glossary.slice(0, 3000) : "";
      const transcribePrompt = glossary
        ? `This is a KeepTally inventory voice count. Prefer exact spellings from these active location item names, categories, UPCs, and aliases when words sound similar: ${glossary}. Operators may say item names followed by counts, for example "Coke Zero five" or "three Red Bull". Also expect route names, warehouse names, minimum and maximum stock levels, theft, spoilage, comp, damaged, missing from bin, done, stop, finish, yes, and no.`
        : undefined;
      const requestedAt = Date.now();
      logger.info({
        requestId: req.id,
        bytes: audioBuffer.length,
        mimetype: req.file.mimetype,
        glossaryTerms: glossary ? glossary.split(",").length : 0,
        model: process.env.AI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
      }, "Voice transcription requested");
      const conversionStartedAt = Date.now();
      const { buffer, format, converted, detected } = await withTimeout(
        ensureCompatibleFormat(audioBuffer),
        VOICE_FORMAT_TIMEOUT_MS,
        "Audio format conversion timed out",
      );
      const conversionMs = Date.now() - conversionStartedAt;
      logger.info({ requestId: req.id, bytes: buffer.length, format, converted, detected, conversionMs }, "Voice audio prepared");
      const transcribeStartedAt = Date.now();
      const transcript = await withTimeout(
        speechToText(buffer, format, transcribePrompt),
        VOICE_TRANSCRIBE_TIMEOUT_MS,
        "Voice transcription timed out",
      );
      const transcribeMs = Date.now() - transcribeStartedAt;
      logger.info({ requestId: req.id, transcriptLength: transcript.length, transcribeMs }, "Voice transcription completed");
      res.json({
        transcript: transcript.trim(),
        diagnostics: {
          requestId: req.id,
          inputBytes: audioBuffer.length,
          outputBytes: buffer.length,
          inputMimeType: req.file.mimetype,
          detectedFormat: detected,
          transcribeFormat: format,
          converted,
          conversionMs,
          transcribeMs,
          totalMs: Date.now() - requestedAt,
        },
      });
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

/* ── POST /voice/warehouse/add-item/draft ────────────────────────────
   Accepts a transcript, returns a structured warehouse item draft.
   This route never writes inventory; confirmed creation uses POST /warehouse.
──────────────────────────────────────────────────────────────────── */
router.post(
  "/voice/warehouse/add-item/draft",
  requirePermission("edit_warehouse"),
  async (req: Request, res: Response) => {
    if (!canViewAllLocations(req)) {
      res.status(403).json({ error: "Permission denied for warehouse inventory" });
      return;
    }

    const parsed = AddItemDraftSchema.omit({ location: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const { transcript } = parsed.data;
    const location = "Warehouse";

    try {
      logger.info({
        requestId: req.id,
        transcriptLength: transcript.length,
      }, "Voice warehouse add-item draft requested");

      const prompt = buildAddItemDraftPrompt(transcript, location);
      const response = await openai.chat.completions.create({
        model: AI_MODELS.voiceParser,
        max_completion_tokens: AI_LIMITS.voiceParserMaxOutputTokens,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });
      const content = response.choices[0]?.message?.content?.trim() ?? "";
      const raw = content ? JSON.parse(content) as Record<string, unknown> : {};
      const draft: AddItemDraft = {
        name: normalizeDraftString(raw.name),
        category: normalizeDraftString(raw.category),
        quantity: normalizeDraftNumber(raw.quantity),
        minQuantity: normalizeDraftNumber(raw.minQuantity),
        maxQuantity: normalizeDraftNumber(raw.maxQuantity),
        barcode: normalizeDraftBarcode(raw.barcode),
        location,
      };
      const warnings = Array.isArray(raw.warnings)
        ? raw.warnings.filter((warning): warning is string => typeof warning === "string")
        : [];
      const result = finalizeAddItemDraft(draft, warnings, clampConfidence(raw.confidence));

      if (result.draft.name) {
        const duplicateRows = await db
          .select({ id: warehouseItemsTable.id, name: warehouseItemsTable.name })
          .from(warehouseItemsTable)
          .where(
            and(
              eq(warehouseItemsTable.accountId, req.account!.id),
              eq(warehouseItemsTable.name, result.draft.name),
            ),
          )
          .limit(1);
        if (duplicateRows.length > 0) {
          result.warnings.push("A matching warehouse item already exists.");
        }
      }

      logger.info({
        requestId: req.id,
        status: result.status,
        missingFields: result.missingFields,
        warnings: result.warnings,
      }, "Voice warehouse add-item draft completed");
      res.json(result);
    } catch (err) {
      logger.warn({ err, requestId: req.id }, "Voice warehouse add-item AI draft failed; using local parser");
      const result = parseAddItemDraftFast(transcript, location);
      res.json({
        ...result,
        warnings: [
          ...result.warnings,
          "AI draft parsing was unavailable, so KeepTally used local parsing.",
        ],
      });
    }
  },
);

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
  category: z.string().optional(),
  barcode: z.string().nullish(),
  aliases: z.array(z.string()).optional(),
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
  | { action: "custom"; itemId: number; itemName: string; quantity: number; confidence?: number; alternates?: Array<{ itemId: number; itemName: string; confidence: number }> }
  | { action: "clarify"; candidates: Array<{ itemId: number; itemName: string; confidence: number }> }
  | { action: "unknown" };

const AddItemDraftSchema = z.object({
  transcript: z.string().trim().min(1).max(1000),
  location: z.string().trim().min(1).max(120),
});

type AddItemDraft = {
  name: string | null;
  category: string | null;
  quantity: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  barcode: string | null;
  location: string;
};

type AddItemDraftResult = {
  status: "draft" | "need_more_info";
  draft: AddItemDraft;
  missingFields: string[];
  warnings: string[];
  confidence: number;
  nextQuestion: string | null;
};

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

const NUMBER_FILLER_WORDS = new Set([
  "a",
  "an",
  "about",
  "around",
  "approximately",
  "approx",
  "only",
  "just",
  "left",
  "remaining",
  "total",
]);

function wordToNumber(text: string): number | null {
  const words = text.replace(/-/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let found = false;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (NUMBER_FILLER_WORDS.has(word)) continue;

    if (word === "couple") {
      total += 2;
      found = true;
      continue;
    }

    if (word === "dozen") {
      total = total === 0 ? 12 : total * 12;
      found = true;
      continue;
    }

    if (word === "half" && words[index + 1] === "dozen") {
      total += 6;
      found = true;
      index += 1;
      continue;
    }

    const value = WORD_MAP[word];
    if (value === undefined) continue;
    found = true;

    if (value === 100 && total > 0) {
      total *= 100;
      continue;
    }

    const next = WORD_MAP[words[index + 1] ?? ""];
    if (next !== undefined && value >= 20 && next < 10) {
      total += value + next;
      index += 1;
      continue;
    }

    total += value;
  }
  return found ? total : null;
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

function clampConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeDraftString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDraftNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function normalizeDraftBarcode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^0-9a-z]/gi, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseDraftNumberAfter(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`\\b${escaped}\\s+(\\d+)\\b`, "i"));
    if (match) return Number.parseInt(match[1]!, 10);
    const phrase = text.match(new RegExp(`\\b${escaped}\\s+([a-z\\s-]{1,40})(?:,|\\b(?:minimum|min|max|maximum|barcode|upc|category|quantity)\\b|$)`, "i"));
    if (phrase) {
      const spoken = wordToNumber(phrase[1] ?? "");
      if (spoken !== null) return spoken;
    }
  }
  return null;
}

function parseAddItemDraftFast(transcript: string, location: string): AddItemDraftResult {
  const text = transcript.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const quantity = parseDraftNumberAfter(text, ["quantity", "count", "starting quantity", "starting count"]);
  const minQuantity = parseDraftNumberAfter(text, ["minimum", "min", "minimum quantity", "minimum count"]);
  const maxQuantity = parseDraftNumberAfter(text, ["maximum", "max", "maximum quantity", "maximum count"]);
  const categoryMatch = text.match(/\bcategory\s+([a-z0-9 &/-]{2,40}?)(?:\s+\b(?:quantity|count|minimum|min|maximum|max|barcode|upc)\b|$)/i);
  const barcodeMatch = text.match(/\b(?:barcode|upc|code)\s+([a-z0-9\s-]{4,40})/i);
  const category = categoryMatch?.[1]?.trim() ?? null;
  const barcode = barcodeMatch ? normalizeDraftBarcode(barcodeMatch[1]) : null;
  let nameText = text
    .replace(/\b(add|create|new|item|inventory|product)\b/g, " ")
    .replace(/\bcategory\s+[a-z0-9 &/-]{2,40}?(\s+\b(?:quantity|count|minimum|min|maximum|max|barcode|upc)\b|$)/i, " ")
    .replace(/\b(?:quantity|count|starting quantity|starting count)\s+(\d+|[a-z\s-]{1,40})/gi, " ")
    .replace(/\b(?:minimum|min|minimum quantity|minimum count)\s+(\d+|[a-z\s-]{1,40})/gi, " ")
    .replace(/\b(?:maximum|max|maximum quantity|maximum count)\s+(\d+|[a-z\s-]{1,40})/gi, " ")
    .replace(/\b(?:barcode|upc|code)\s+[a-z0-9\s-]{4,40}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (nameText.length > 80) nameText = nameText.slice(0, 80).trim();
  const draft: AddItemDraft = {
    name: nameText || null,
    category: category ? category.replace(/\b\w/g, (char) => char.toUpperCase()) : null,
    quantity,
    minQuantity,
    maxQuantity,
    barcode,
    location,
  };
  return finalizeAddItemDraft(draft, [], 45);
}

function finalizeAddItemDraft(draft: AddItemDraft, warnings: string[], confidence: number): AddItemDraftResult {
  const missingFields: string[] = [];
  if (!draft.name) missingFields.push("name");
  if (!draft.category) missingFields.push("category");
  if (draft.quantity === null) missingFields.push("quantity");
  if (draft.minQuantity === null) missingFields.push("minQuantity");
  if (draft.maxQuantity === null) missingFields.push("maxQuantity");
  if (
    draft.minQuantity !== null &&
    draft.maxQuantity !== null &&
    draft.minQuantity > draft.maxQuantity
  ) {
    warnings.push("Minimum quantity is greater than maximum quantity.");
    missingFields.push("stockRange");
  }
  const status = missingFields.length === 0 ? "draft" : "need_more_info";
  return {
    status,
    draft,
    missingFields: [...new Set(missingFields)],
    warnings: [...new Set(warnings)],
    confidence,
    nextQuestion:
      status === "draft"
        ? null
        : `Please provide ${[...new Set(missingFields)].join(", ")} for ${draft.name ?? "the new item"}.`,
  };
}

function buildAddItemDraftPrompt(transcript: string, location: string): string {
  return `You are parsing a spoken inventory item creation request for KeepTally.
The selected app location is "${location}". Do not choose another location.
Transcript: "${transcript}"

Return ONLY valid JSON, no markdown.

Shape:
{
  "action": "create_item_draft" | "need_more_info",
  "name": string | null,
  "category": string | null,
  "quantity": number | null,
  "minQuantity": number | null,
  "maxQuantity": number | null,
  "barcode": string | null,
  "confidence": number,
  "warnings": string[],
  "missingFields": string[],
  "nextQuestion": string | null
}

Rules:
- Required: name, category, quantity, minQuantity, maxQuantity.
- Barcode/UPC is optional.
- Convert spoken numbers into integers.
- Normalize package size in the name when obvious, e.g. "twenty ounce" -> "20 oz".
- Do not invent missing quantity, minimum, maximum, category, or barcode.
- If minimum is greater than maximum, return need_more_info with a warning.
- Keep names short and business-readable.`;
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
  const itemList = items.slice(0, 40).map((it) => {
    const min = it.minQuantity ?? it.parLevel;
    const max = it.maxQuantity ?? it.parLevel;
    return {
      id: it.id,
      name: it.name,
      category: it.category ?? null,
      barcode: it.barcode ?? null,
      aliases: it.aliases ?? [],
      range: `${min}-${max}`,
    };
  });
  return `You are an inventory assistant parsing a voice command.
The operator says an item name and a quantity count.
Transcript: "${transcript}"
Available items JSON: ${JSON.stringify(itemList)}

Return ONLY valid JSON, no other text.

Rules:
- Choose only from Available items JSON.
- Match by name, barcode, alias, category, package size, and common spoken variants.
- Extract the quantity number
- If transcript says "done"/"stop"/"finish"/"exit" → {"action":"done"}
- If no item found or no quantity → {"action":"unknown"}
- If the best match is uncertain or multiple candidates are close → {"action":"clarify","candidates":[{"itemId":N,"itemName":"...","confidence":N}]}
- Use "custom" only when confidence is 80 or higher.

Examples:
"coke zero 5" → {"action":"custom","itemId":42,"itemName":"Coke Zero 20oz","quantity":5,"confidence":91,"alternates":[]}
"red bull three" → {"action":"custom","itemId":7,"itemName":"Red Bull 8.4oz","quantity":3,"confidence":88,"alternates":[]}
"done" → {"action":"done"}`;
}

function normalizeCustomParseResult(result: ParseResult, allowedItems: z.infer<typeof ItemSchema>[]): ParseResult {
  if (result.action !== "custom") {
    if (result.action === "clarify") {
      return {
        action: "clarify",
        candidates: result.candidates
          .filter((candidate) => allowedItems.some((item) => item.id === candidate.itemId))
          .slice(0, 3),
      };
    }
    return result;
  }

  const allowedItem = allowedItems.find((item) => item.id === result.itemId);
  if (!allowedItem) return { action: "unknown" };

  const confidence = clampConfidence(result.confidence ?? 0);
  const alternates = (result.alternates ?? [])
    .filter((candidate) => allowedItems.some((item) => item.id === candidate.itemId))
    .map((candidate) => ({
      ...candidate,
      confidence: clampConfidence(candidate.confidence),
    }))
    .slice(0, 3);

  if (confidence > 0 && confidence < 80) {
    return {
      action: "clarify",
      candidates: [
        { itemId: allowedItem.id, itemName: allowedItem.name, confidence },
        ...alternates,
      ].slice(0, 3),
    };
  }

  return {
    ...result,
    itemName: allowedItem.name,
    confidence: confidence || undefined,
    alternates,
  };
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

    if (mode === "custom") {
      result = normalizeCustomParseResult(result, allowedItems);
    }

    logger.info({ requestId: req.id, mode, result }, "Voice parse completed");
    res.json(result);
  } catch (err) {
    logger.error({ err, requestId: req.id }, "Voice parse failed");
    res.status(502).json({ error: "Voice parse service failed", requestId: req.id });
  }
});

export default router;
