import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { NoPermissionPage } from "@/components/permission-guard";
import { getListItemsQueryKey, useListItems } from "@workspace/api-client-react";
import { useSelectedLocation, LOCATIONS } from "@/contexts/location-context";
import { useAIVoice, getAIVoiceSupport, type ListenProgress, type ListenResult, type MicrophonePrecheckResult } from "@/hooks/use-ai-voice";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mic,
  MicOff,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  X,
  CheckCircle2,
  AlertCircle,
  MinusCircle,
  Volume2,
  ArrowLeft,
  PackageSearch,
  TrendingDown,
  Tag,
  Wand2,
  ChevronRight,
} from "lucide-react";
import type { Item } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LARGE_DELTA_MULTIPLIER = 2;
const LARGE_DELTA_MIN_UNITS = 20;
const VOICE_COUNT_TTS_ENABLED = import.meta.env.VITE_VOICE_COUNT_TTS_ENABLED === "true";
const VOICE_COUNT_CONFIRMATION_AUDIO_ENABLED =
  import.meta.env.VITE_VOICE_COUNT_CONFIRMATION_AUDIO_ENABLED !== "false";

type LocationOption = { id: number; name: string; slug: string };

/* ── Types ──────────────────────────────────────────────────────────── */

type Phase =
  | "setup"
  | "select-mode"
  | "speaking"
  | "listening"
  | "reason-speaking"
  | "reason-listening"
  | "custom-listening"
  | "paused"
  | "complete";

type CountMode = "all" | "low-stock" | "category" | "custom";

type ResultStatus = "verified" | "updated-lower" | "updated-higher" | "skipped" | "no-response";
type ConfirmationChoice = "yes" | "no";
type VoiceDebugEntry = { at: string; step: string; detail?: string };

interface SessionResult {
  item: Item;
  expected: number;
  counted: number | null;
  diff: number | null;
  status: ResultStatus;
  adjustmentType: string | null;
}

interface AIStatus {
  configured: boolean;
  apiKeyConfigured: boolean;
  realtimeEnabled: boolean;
  voiceFallbackEnabled: boolean;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const WORD_MAP: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

function wordToNumber(text: string): number | null {
  const words = text.replace(/-/g, " ").split(/\s+/);
  for (const w of words) {
    if (WORD_MAP[w] !== undefined) {
      const idx = words.indexOf(w);
      const next = words[idx + 1];
      if (next && WORD_MAP[next] !== undefined && WORD_MAP[w]! >= 20 && WORD_MAP[next]! < 10) {
        return WORD_MAP[w]! + WORD_MAP[next]!;
      }
      return WORD_MAP[w]!;
    }
  }
  return null;
}

function parseQuantity(transcript: string, expected: number): { isVerified: boolean; quantity: number | null } {
  const t = transcript.toLowerCase().trim();
  if (!t) return { isVerified: false, quantity: null };
  if (/\b(correct|right|yes|same|good|confirmed|verified|check|yep|yeah|that'?s (right|correct))\b/.test(t)) {
    return { isVerified: true, quantity: expected };
  }
  const digitMatch = t.match(/\b(\d+)\b/);
  if (digitMatch) return { isVerified: false, quantity: parseInt(digitMatch[1]!, 10) };
  const wordNum = wordToNumber(t);
  if (wordNum !== null) return { isVerified: false, quantity: wordNum };
  return { isVerified: false, quantity: null };
}

function parseReason(transcript: string): string {
  const t = transcript.toLowerCase();
  if (/theft|stolen|steal|rob|took/.test(t)) return "Theft";
  if (/spoil|expired|bad|rotten|old/.test(t)) return "Spoilage";
  if (/comp|compliment|complimentary|free|gift|gave/.test(t)) return "Comp";
  if (/return|warehouse|send back|sent back/.test(t)) return "Return to Warehouse";
  if (/damage|broken|cracked|crushed|damaged/.test(t)) return "Damaged";
  if (/missing|not there|can't find|cant find|empty|bin/.test(t)) return "Missing from Bin";
  return "Adjustment";
}

function parseConfirmation(transcript: string): "yes" | "no" | "unknown" {
  const t = transcript.toLowerCase().trim();
  if (!t) return "unknown";
  if (/\b(yes|yeah|yep|correct|right|confirmed|confirm|ok|okay|save|proceed|do it|that's right|that is right)\b/.test(t)) {
    return "yes";
  }
  if (/\b(no|nope|cancel|wrong|incorrect|retry|try again|don't save|do not save|skip)\b/.test(t)) {
    return "no";
  }
  return "unknown";
}

/* ── Item name + quantity parser for voice-driven custom mode ─────── */

type ItemMatch =
  | { status: "match"; item: Item; score: number }
  | { status: "ambiguous"; candidates: Item[] }
  | { status: "none" };

function rankItemMatches(query: string, items: Item[]): Array<{ item: Item; score: number }> {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const queryWords = q.split(/\s+/).filter((w) => w.length > 1);
  const ranked: Array<{ item: Item; score: number }> = [];

  for (const item of items) {
    const name = item.name.toLowerCase();
    let score = 0;

    if (name.includes(q) || q.includes(name)) {
      score = (Math.min(name.length, q.length) / Math.max(name.length, q.length)) * 100;
    } else {
      const itemWords = name.split(/\s+/).filter((w) => w.length > 1);
      const matchCount = queryWords.filter((qw) =>
        itemWords.some((iw) => iw.includes(qw) || qw.includes(iw))
      ).length;
      score = queryWords.length > 0 ? (matchCount / queryWords.length) * 100 : 0;
    }

    if (score >= 40) {
      ranked.push({ item, score });
    }
  }

  return ranked.sort((a, b) => b.score - a.score);
}

function findBestItemMatch(query: string, items: Item[]): ItemMatch {
  const ranked = rankItemMatches(query, items);
  const [best, second] = ranked;
  if (!best) return { status: "none" };

  const closeSecond = second && second.score >= Math.max(40, best.score - 12);
  if (closeSecond && best.score < 90) {
    return { status: "ambiguous", candidates: ranked.slice(0, 3).map((match) => match.item) };
  }

  return { status: "match", item: best.item, score: best.score };
}

function parseVoiceCommand(transcript: string, items: Item[]): { item: Item; quantity: number } | { ambiguous: Item[] } | null {
  const t = transcript.toLowerCase().trim();

  let quantity: number | null = null;
  let nameText = t;

  // Number at end: "coke zero 5"
  const digitEnd = t.match(/^(.*?)\s+(\d+)\s*$/);
  if (digitEnd) {
    quantity = parseInt(digitEnd[2]!, 10);
    nameText = digitEnd[1]!.trim();
  }

  // Word number at end: "coke zero five"
  if (quantity === null) {
    const words = t.split(/\s+/);
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i]!;
      if (WORD_MAP[w] !== undefined) {
        quantity = WORD_MAP[w]!;
        nameText = [...words.slice(0, i), ...words.slice(i + 1)].join(" ").trim();
        break;
      }
    }
  }

  // Number at start: "5 coke zero"
  if (quantity === null) {
    const digitStart = t.match(/^(\d+)\s+(.+)$/);
    if (digitStart) {
      quantity = parseInt(digitStart[1]!, 10);
      nameText = digitStart[2]!.trim();
    }
  }

  if (quantity === null) return null;

  const match = findBestItemMatch(nameText, items);
  if (match.status === "none") return null;
  if (match.status === "ambiguous") return { ambiguous: match.candidates };

  return { item: match.item, quantity };
}

function voiceCandidateItems(transcript: string, items: Item[]): Item[] {
  const withoutNumbers = transcript
    .toLowerCase()
    .replace(/\b\d+\b/g, " ")
    .replace(new RegExp(`\\b(${Object.keys(WORD_MAP).join("|")})\\b`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  const ranked = rankItemMatches(withoutNumbers || transcript, items).slice(0, 80).map((match) => match.item);
  return ranked.length > 0 ? ranked : items.slice(0, 80);
}

function isLargeQuantityChange(item: Item, quantity: number): boolean {
  const unitDelta = Math.abs(quantity - item.quantity);
  return unitDelta >= LARGE_DELTA_MIN_UNITS || quantity >= Math.max(1, item.quantity) * LARGE_DELTA_MULTIPLIER;
}

function listenMessage(result: ListenResult): string {
  if (result.ok) return "";
  switch (result.reason) {
    case "microphone-denied":
      return "Microphone access is blocked. Allow mic access in the browser, then try again.";
    case "unsupported":
      return "This browser does not support voice input for this screen.";
    case "silent":
      return "No voice was detected. Try again a little closer to the mic.";
    case "transcription-failed":
      return "Voice transcription failed on the VPS AI service. The session is paused so you can retry after checking the AI audio model.";
    case "microphone-timeout":
      return "The browser did not return microphone access in time. Check the permission prompt or selected input device.";
    case "aborted":
      return "";
  }
}

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

/* ── AI (GPT) parsing — calls backend /api/voice/parse ────────────── */

type GPTParseResult =
  | { action: "verify" }
  | { action: "count"; quantity: number }
  | { action: "skip" }
  | { action: "done" }
  | { action: "reason"; reason: string }
  | { action: "custom"; itemId: number; itemName: string; quantity: number }
  | { action: "unknown" };

async function parseWithAI(
  transcript: string,
  mode: "quantity" | "reason" | "custom",
  items: Item[],
  opts?: { currentItemName?: string; currentParLevel?: number; currentMinQuantity?: number; currentMaxQuantity?: number },
): Promise<GPTParseResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(`${BASE}/api/voice/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({
        transcript,
        mode,
        items: items.slice(0, 80).map((it) => ({
          id: it.id,
          name: it.name,
          parLevel: it.parLevel,
          minQuantity: it.minQuantity,
          maxQuantity: it.maxQuantity,
        })),
        currentItemName: opts?.currentItemName,
        currentParLevel: opts?.currentParLevel,
        currentMinQuantity: opts?.currentMinQuantity,
        currentMaxQuantity: opts?.currentMaxQuantity,
      }),
    });
    if (!res.ok) throw new Error("parse failed");
    return (await res.json()) as GPTParseResult;
  } catch {
    // Fall back to local parsing if the API is unreachable
    if (mode === "quantity") {
      const fallback = parseQuantity(transcript, opts?.currentParLevel ?? 0);
      if (fallback.isVerified) return { action: "verify" };
      if (fallback.quantity !== null) return { action: "count", quantity: fallback.quantity };
      return { action: "unknown" };
    }
    if (mode === "reason") {
      return { action: "reason", reason: parseReason(transcript) };
    }
    if (mode === "custom") {
      const fallback = parseVoiceCommand(transcript, items);
      if (fallback && "item" in fallback) {
        return {
          action: "custom",
          itemId: fallback.item.id,
          itemName: fallback.item.name,
          quantity: fallback.quantity,
        };
      }
    }
    return { action: "unknown" };
  } finally {
    window.clearTimeout(timer);
  }
}

async function saveAdjustment(itemId: number, quantity: number, adjustmentType: string, verified: boolean) {
  const res = await fetch(`${BASE}/api/items/${itemId}/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ quantity, adjustmentType, verified }),
  });
  if (!res.ok) throw new Error("Failed to save voice adjustment");
}

async function logVerification(item: Item) {
  const res = await fetch(`${BASE}/api/items/${item.id}/verify`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to save voice verification");
}

const MODE_LABELS: Record<CountMode, string> = {
  "all": "All Items",
  "low-stock": "Low Stock",
  "category": "By Category",
  "custom": "AI Voice",
};

/* ── Component ──────────────────────────────────────────────────────── */

export default function VoiceCheck() {
  const { hasPermission } = useAuth();
  const [, navigate] = useLocation();
  const { selectedLocation } = useSelectedLocation();
  const [sessionLocation, setSessionLocation] = useState<string | null>(selectedLocation);
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState("");
  const listItemsParams = sessionLocation ? { location: sessionLocation } : undefined;
  const {
    data: allItems,
    isLoading: itemsLoading,
    isError: itemsError,
    error: itemsLoadError,
  } = useListItems(
    listItemsParams,
    { query: { queryKey: getListItemsQueryKey(listItemsParams), retry: false } },
  );
  const {
    speak,
    speakBrowser,
    cancelSpeech,
    listenDetailed,
    precheckMicrophone,
    stopListening,
    cancelAll,
    resetVoiceSession,
  } = useAIVoice();
  const voiceSupport = getAIVoiceSupport();

  const [phase, setPhase] = useState<Phase>("setup");
  const [countMode, setCountMode] = useState<CountMode | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [currentIndex, setCurrentIndex] = useState(0);
  const [queuedItems, setQueuedItems] = useState<Item[]>([]);
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [voiceDebugEntries, setVoiceDebugEntries] = useState<VoiceDebugEntry[]>([]);
  const [voiceCapture, setVoiceCapture] = useState<ListenProgress | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ item: Item; quantity: number } | null>(null);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [pendingCounted, setPendingCounted] = useState<number | null>(null);
  const [micPrecheck, setMicPrecheck] = useState<MicrophonePrecheckResult | null>(null);
  const [micChecking, setMicChecking] = useState(false);

  // Custom (AI voice) mode state
  const [customMatchedItem, setCustomMatchedItem] = useState<Item | null>(null);
  const [customSpokenQty, setCustomSpokenQty] = useState<number | null>(null);

  const controlRef = useRef({ shouldStop: false, shouldSkip: false, shouldRepeat: false, shouldPause: false });
  const currentIndexRef = useRef(0);
  const sessionResultsRef = useRef<SessionResult[]>([]);
  const isRunningRef = useRef(false);
  const lastVoiceLevelLogAtRef = useRef(0);
  const confirmationResolverRef = useRef<((choice: ConfirmationChoice) => void) | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef = useRef<any>(null);

  const items = allItems ?? [];
  const hasItems = items.length > 0;
  const selectableLocations = locationOptions.length > 0 ? locationOptions.map((location) => location.name) : [...LOCATIONS];
  const itemsErrorMessage =
    itemsLoadError instanceof Error
      ? itemsLoadError.message
      : "The item request failed.";

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/ai/status`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("AI status unavailable");
        return await res.json() as AIStatus;
      })
      .then((status) => {
        if (!cancelled) setAiStatus(status);
      })
      .catch(() => {
        if (!cancelled) setAiStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLocationsLoading(true);
    setLocationsError("");

    fetch(`${BASE}/api/locations`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("locations unavailable");
        return await res.json() as LocationOption[];
      })
      .then((locations) => {
        if (cancelled) return;
        setLocationOptions(locations);
        setSessionLocation((current) => {
          if (selectedLocation && locations.some((location) => location.name === selectedLocation)) return selectedLocation;
          if (current && locations.some((location) => location.name === current)) return current;
          if (locations.length === 1) return locations[0]!.name;
          return null;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLocationOptions([]);
          setLocationsError("Could not load locations from the database.");
        }
      })
      .finally(() => {
        if (!cancelled) setLocationsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLocation]);

  const categories = useMemo(() => {
    const cats = new Set(items.map((it) => it.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [items]);

  /* ── Wake Lock ── */
  const acquireWakeLock = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ("wakeLock" in navigator) { wakeLockRef.current = await (navigator as any).wakeLock.request("screen"); }
    } catch {}
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  /* ── Result helpers ── */
  const addResult = useCallback((result: SessionResult) => {
    sessionResultsRef.current = [...sessionResultsRef.current, result];
    setSessionResults([...sessionResultsRef.current]);
  }, []);

  const logVoiceStep = useCallback((step: string, detail?: string | Record<string, unknown>) => {
    const detailText =
      typeof detail === "string"
        ? detail
        : detail
          ? JSON.stringify(detail)
          : undefined;
    const entry = {
      at: new Date().toLocaleTimeString(),
      step,
      detail: detailText,
    };
    console.info("[KeepTally voice workflow]", step, detail ?? {});
    setVoiceDebugEntries((current) => [entry, ...current].slice(0, 12));
  }, []);

  /* ── Voice helpers ── */
  const safeSpeak = useCallback(async (text: string, opts: { audible?: boolean } = {}): Promise<boolean> => {
    if (controlRef.current.shouldStop || controlRef.current.shouldPause) return false;
    const shouldPlayAudio = opts.audible ?? true;
    setStatusMessage(text);
    vibrate(30);
    logVoiceStep("speak.request", { text, openAiTts: VOICE_COUNT_TTS_ENABLED, audible: shouldPlayAudio });
    if (VOICE_COUNT_TTS_ENABLED) {
      await speak(text);
    } else if (shouldPlayAudio && VOICE_COUNT_CONFIRMATION_AUDIO_ENABLED) {
      await speakBrowser(text);
    }
    logVoiceStep("speak.complete", { text });
    return !controlRef.current.shouldStop && !controlRef.current.shouldPause;
  }, [logVoiceStep, speak, speakBrowser]);

  const safeListen = useCallback(async (timeoutMs: number): Promise<string | null> => {
    if (controlRef.current.shouldStop || controlRef.current.shouldPause) return null;
    vibrate([50, 30, 50]);
    setVoiceCapture({ state: "requesting-microphone" });
    setStatusMessage("Opening microphone...");
    logVoiceStep("listen.start", { timeoutMs });
    const result = await listenDetailed(timeoutMs, (progress) => {
      setVoiceCapture(progress);
      if (progress.state === "requesting-microphone") {
        setStatusMessage("Opening microphone...");
        logVoiceStep("listen.microphone-opening");
      } else if (progress.state === "recording") {
        setStatusMessage("Recording voice...");
        const now = Date.now();
        if (progress.level > 0 && now - lastVoiceLevelLogAtRef.current > 1500) {
          lastVoiceLevelLogAtRef.current = now;
          logVoiceStep("listen.recording", { level: progress.level });
        }
      } else if (progress.state === "transcribing") {
        setStatusMessage("Transcribing audio...");
        logVoiceStep("transcribe.start");
      }
    });
    setVoiceCapture(null);
    if (controlRef.current.shouldStop || controlRef.current.shouldPause) return null;
    if (controlRef.current.shouldSkip || controlRef.current.shouldRepeat) return "";
    if (!result.ok) {
      const message = listenMessage(result);
      logVoiceStep("listen.failed", { reason: result.reason, message });
      if (message) {
        setVoiceNotice(message);
        setStatusMessage(message);
        toast({
          title: "Voice input issue",
          description: message,
          variant: "destructive",
        });
      }
      setLastHeard("");
      if (result.reason !== "silent") {
        controlRef.current.shouldPause = true;
        setPhase("paused");
        return null;
      }
      return "";
    }
    const transcript = result.transcript;
    setVoiceNotice("");
    setLastHeard(transcript || "");
    setStatusMessage(transcript ? `Heard "${transcript}".` : "No speech was transcribed.");
    logVoiceStep("transcribe.success", { transcript });
    return transcript;
  }, [listenDetailed, logVoiceStep]);

  const runMicPrecheck = useCallback(async () => {
    setMicChecking(true);
    setVoiceNotice("");
    logVoiceStep("mic-precheck.start");
    try {
      const result = await precheckMicrophone();
      logVoiceStep("mic-precheck.complete", { ok: result.ok, message: result.message, details: result.details });
      setMicPrecheck(result);
      toast({
        title: result.ok ? "Microphone ready" : "Microphone check failed",
        description: result.message,
        variant: result.ok ? "default" : "destructive",
      });
      if (!result.ok) setVoiceNotice(result.message);
      return result.ok;
    } finally {
      setMicChecking(false);
    }
  }, [logVoiceStep, precheckMicrophone]);

  const notifySaveFailed = useCallback(async () => {
    const message = "Could not save that count. Check the connection, then try again.";
    setVoiceNotice(message);
    toast({
      title: "Voice save failed",
      description: message,
      variant: "destructive",
    });
    await safeSpeak("Could not save. Try again.", { audible: true });
  }, [safeSpeak]);

  const notifyCountSaved = useCallback(async (message: string) => {
    setVoiceNotice(message);
    setStatusMessage(message);
    toast({
      title: "Count saved",
      description: message,
    });
    await safeSpeak(message, { audible: true });
  }, [safeSpeak]);

  const confirmLargeChange = useCallback(async (item: Item, quantity: number) => {
    if (!isLargeQuantityChange(item, quantity)) return true;
    const message = `Large change for ${item.name}: system count ${item.quantity}, heard ${quantity}.`;
    setVoiceNotice(message);
    await safeSpeak(message, { audible: true });
    return window.confirm(`${message}\n\nSave this count?`);
  }, [safeSpeak]);

  const confirmSpokenCount = useCallback(async (item: Item, quantity: number) => {
    const message = `I heard ${item.name}, count ${quantity}. Say yes to save, or no to try again.`;
    logVoiceStep("confirm.prompt", { item: item.name, quantity });
    setVoiceNotice(message);
    setStatusMessage(message);
    setPendingConfirmation({ item, quantity });
    await safeSpeak(message, { audible: true });

    setPhase("custom-listening");
    setLastHeard("");
    setStatusMessage("Listening for yes or no. You can also tap Confirm Save.");
    const manualConfirmation = new Promise<ConfirmationChoice>((resolve) => {
      confirmationResolverRef.current = resolve;
    });
    try {
      const confirmation = await Promise.race<ConfirmationChoice | "unknown">([
        manualConfirmation,
        safeListen(10000).then((confirmationTranscript) => {
          if (confirmationTranscript === null) return "unknown";
          return parseConfirmation(confirmationTranscript);
        }),
      ]);

      if (confirmation === "yes") {
        logVoiceStep("confirm.accepted", { item: item.name, quantity });
        setVoiceNotice("");
        return true;
      }
      if (confirmation === "no") {
        logVoiceStep("confirm.rejected", { item: item.name, quantity });
        const retryMessage = "Okay, not saved. Try that item again.";
        setVoiceNotice(retryMessage);
        await safeSpeak(retryMessage, { audible: true });
        return false;
      }

      const unclearMessage = "I could not confirm that, so I did not save it. Use Confirm Save or try again.";
      logVoiceStep("confirm.unknown", { item: item.name, quantity });
      setVoiceNotice(unclearMessage);
      await safeSpeak(unclearMessage, { audible: true });
      return false;
    } finally {
      confirmationResolverRef.current = null;
      setPendingConfirmation(null);
    }
  }, [logVoiceStep, safeListen, safeSpeak]);

  /* ── QUEUE-BASED session (All / Low-Stock / Category) ── */
  const runSession = useCallback(async (queue: Item[], startIndex: number) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    controlRef.current = { shouldStop: false, shouldSkip: false, shouldRepeat: false, shouldPause: false };
    await acquireWakeLock();

    for (let i = startIndex; i < queue.length; i++) {
      if (controlRef.current.shouldStop || controlRef.current.shouldPause) break;

      currentIndexRef.current = i;
      setCurrentIndex(i);
      const item = queue[i]!;

      itemLoop: while (true) {
        controlRef.current.shouldRepeat = false;
        controlRef.current.shouldSkip = false;

        setPhase("speaking");
        setLastHeard("");
        const ok = await safeSpeak(`${item.name}. System count ${item.quantity}. Range ${item.minQuantity} to ${item.maxQuantity}.`);
        if (!ok) break itemLoop;

        setPhase("listening");
        setLastHeard("");
        const transcript = await safeListen(9000);
        if (transcript === null) break itemLoop;

        if (controlRef.current.shouldSkip) {
          addResult({ item, expected: item.quantity, counted: null, diff: null, status: "skipped", adjustmentType: null });
          break itemLoop;
        }
        if (controlRef.current.shouldRepeat) continue itemLoop;

        const aiQty = await parseWithAI(transcript, "quantity", items, {
          currentItemName: item.name,
          currentParLevel: item.quantity,
          currentMinQuantity: item.minQuantity,
          currentMaxQuantity: item.maxQuantity,
        });

        if (aiQty.action === "skip") {
          addResult({ item, expected: item.quantity, counted: null, diff: null, status: "skipped", adjustmentType: null });
          break itemLoop;
        }
        if (aiQty.action === "done") {
          controlRef.current.shouldStop = true;
          break itemLoop;
        }
        if (aiQty.action === "unknown") {
          await safeSpeak("Didn't catch that. Skipping.");
          addResult({ item, expected: item.quantity, counted: null, diff: null, status: "no-response", adjustmentType: null });
          break itemLoop;
        }

        const counted = aiQty.action === "verify" ? item.quantity : (aiQty as { action: "count"; quantity: number }).quantity;

        if (aiQty.action === "verify" || counted === item.quantity) {
          vibrate(100);
          try {
            await logVerification(item);
          } catch {
            await notifySaveFailed();
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "no-response", adjustmentType: null });
            break itemLoop;
          }
          await safeSpeak("Got it.");
          addResult({ item, expected: item.quantity, counted: item.quantity, diff: 0, status: "verified", adjustmentType: null });
          break itemLoop;
        }

        if (counted > item.quantity) {
          if (!(await confirmLargeChange(item, counted))) {
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "skipped", adjustmentType: null });
            break itemLoop;
          }
          try {
            await saveAdjustment(item.id, counted, "Adjustment", false);
          } catch {
            await notifySaveFailed();
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "no-response", adjustmentType: null });
            break itemLoop;
          }
          addResult({ item, expected: item.quantity, counted, diff: counted - item.quantity, status: "updated-higher", adjustmentType: "Adjustment" });
          await safeSpeak(`Got ${counted}. Saved.`);
          break itemLoop;
        }

        if (counted < item.quantity) {
          setPendingCounted(counted);
          setPhase("reason-speaking");
          const reasonOk = await safeSpeak(
            `Got ${counted}. Why is it lower? Say: theft, spoilage, comp, return to warehouse, damaged, or missing from bin.`
          );
          if (!reasonOk) break itemLoop;

          setPhase("reason-listening");
          setLastHeard("");
          const reasonTranscript = await safeListen(12000);
          if (reasonTranscript === null) break itemLoop;

          const aiReason = await parseWithAI(reasonTranscript || "", "reason", items);
          const reason = aiReason.action === "reason" ? aiReason.reason : parseReason(reasonTranscript || "");
          if (!(await confirmLargeChange(item, counted))) {
            setPendingCounted(null);
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "skipped", adjustmentType: null });
            break itemLoop;
          }
          try {
            await saveAdjustment(item.id, counted, reason, false);
          } catch {
            setPendingCounted(null);
            await notifySaveFailed();
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "no-response", adjustmentType: null });
            break itemLoop;
          }
          addResult({ item, expected: item.quantity, counted, diff: counted - item.quantity, status: "updated-lower", adjustmentType: reason });
          vibrate([50, 50, 100]);
          await safeSpeak(`Saved as ${reason}.`);
          setPendingCounted(null);
          break itemLoop;
        }
      }
    }

    isRunningRef.current = false;
    releaseWakeLock();

    if (controlRef.current.shouldStop) {
      setPhase("complete");
    } else if (controlRef.current.shouldPause) {
      setPhase("paused");
    } else {
      await safeSpeak("Count mode complete.");
      setPhase("complete");
    }
  }, [safeSpeak, safeListen, addResult, acquireWakeLock, releaseWakeLock, items, notifySaveFailed, confirmLargeChange]);

  /* ── AI VOICE session (Custom mode) ── */
  const runCustomSession = useCallback(async (sessionItems: Item[]) => {
    if (isRunningRef.current) {
      logVoiceStep("custom.start.ignored", "Session is already running.");
      return;
    }
    isRunningRef.current = true;
    controlRef.current = { shouldStop: false, shouldSkip: false, shouldRepeat: false, shouldPause: false };
    try {
      logVoiceStep("custom.start", { items: sessionItems.length, location: sessionLocation });
      setVoiceNotice("");
      setStatusMessage("Starting AI voice listener...");
      setPhase("custom-listening");
      await acquireWakeLock();

      setStatusMessage("Ready. Say an item name and count.");

      while (!controlRef.current.shouldStop && !controlRef.current.shouldPause) {
        setPhase("custom-listening");
        setLastHeard("");
        setCustomMatchedItem(null);
        setCustomSpokenQty(null);

        // Long listen window — user initiates each entry
        const transcript = await safeListen(20000);

        if (transcript === null) {
          logVoiceStep("custom.listen.returned-null");
          break;
        }

        // Silence / timeout → stay listening
        if (!transcript.trim()) {
          logVoiceStep("custom.listen.empty-transcript");
          continue;
        }

        // Stop commands
        if (/\b(done|stop|finish|exit|end|quit)\b/.test(transcript)) {
          logVoiceStep("custom.stop-command", { transcript });
          break;
        }

        setStatusMessage(`Heard "${transcript}". Matching item...`);
        logVoiceStep("custom.match.start", { transcript, itemCount: sessionItems.length });

        // Try deterministic database-backed matching first; use AI only as a fallback.
        const localParse = parseVoiceCommand(transcript, sessionItems);
        let aiCustom: GPTParseResult = { action: "unknown" };
        if (localParse && "ambiguous" in localParse) {
          const candidates = localParse.ambiguous.map((item) => item.name).join(", ");
          logVoiceStep("custom.match.ambiguous", { transcript, candidates });
          const message = `I heard "${transcript}", but that could be ${candidates}. Please say a more specific item name.`;
          setVoiceNotice(message);
          setStatusMessage(message);
          await safeSpeak(message);
          continue;
        }
        if (localParse && "item" in localParse) {
          logVoiceStep("custom.match.local", {
            transcript,
            item: localParse.item.name,
            quantity: localParse.quantity,
          });
          aiCustom = {
            action: "custom",
            itemId: localParse.item.id,
            itemName: localParse.item.name,
            quantity: localParse.quantity,
          };
        } else {
          logVoiceStep("custom.match.ai-request", { transcript });
          aiCustom = await parseWithAI(transcript, "custom", voiceCandidateItems(transcript, sessionItems));
          logVoiceStep("custom.match.ai-response", aiCustom);
        }

        if (aiCustom.action === "done") {
          logVoiceStep("custom.done-action");
          break;
        }

        if (aiCustom.action !== "custom") {
          logVoiceStep("custom.match.failed", { transcript, action: aiCustom.action });
          const message = `I heard "${transcript}", but I could not match that to an item and count in ${sessionLocation ?? "this location"}. Try the full item name plus a number.`;
          setVoiceNotice(message);
          setStatusMessage(message);
          await safeSpeak(message);
          continue;
        }

        const item = sessionItems.find((it) => it.id === aiCustom.itemId) ?? null;
        if (!item) {
          logVoiceStep("custom.match.item-not-in-location", aiCustom);
          const message = `I matched ${aiCustom.itemName}, but it is not available in ${sessionLocation ?? "this location"}. Try another item name.`;
          setVoiceNotice(message);
          setStatusMessage(message);
          await safeSpeak(message);
          continue;
        }

        const quantity = aiCustom.quantity;
        logVoiceStep("custom.match.confirmed", { item: item.name, quantity, systemQuantity: item.quantity });
        setCustomMatchedItem(item);
        setCustomSpokenQty(quantity);
        setStatusMessage(`Matched ${item.name}, count ${quantity}. Waiting for confirmation.`);

        if (!(await confirmSpokenCount(item, quantity))) {
          logVoiceStep("custom.save.skipped-after-confirmation", { item: item.name, quantity });
          addResult({ item, expected: item.quantity, counted: null, diff: null, status: "skipped", adjustmentType: null });
          continue;
        }

        setStatusMessage(`Saving ${item.name}, count ${quantity}...`);
        logVoiceStep("custom.save.start", { item: item.name, quantity, systemQuantity: item.quantity });
        if (quantity === item.quantity) {
          vibrate(100);
          try {
            await logVerification(item);
          } catch {
            logVoiceStep("custom.save.failed", { item: item.name, quantity, operation: "verify" });
            await notifySaveFailed();
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "no-response", adjustmentType: null });
            continue;
          }
          await safeSpeak("OK");
          addResult({ item, expected: item.quantity, counted: quantity, diff: 0, status: "verified", adjustmentType: null });
          logVoiceStep("custom.save.verified", { item: item.name, quantity });
          await notifyCountSaved(`${item.name}: count ${quantity} verified and written to inventory history.`);

        } else if (quantity > item.quantity) {
          if (!(await confirmLargeChange(item, quantity))) {
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "skipped", adjustmentType: null });
            continue;
          }
          setStatusMessage(`Saving ${item.name}, count ${quantity} as an adjustment...`);
          try {
            await saveAdjustment(item.id, quantity, "Adjustment", false);
          } catch {
            logVoiceStep("custom.save.failed", { item: item.name, quantity, operation: "adjust-higher" });
            await notifySaveFailed();
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "no-response", adjustmentType: null });
            continue;
          }
          addResult({ item, expected: item.quantity, counted: quantity, diff: quantity - item.quantity, status: "updated-higher", adjustmentType: "Adjustment" });
          logVoiceStep("custom.save.updated-higher", { item: item.name, quantity });
          await notifyCountSaved(`${item.name}: count updated to ${quantity} and written to inventory history.`);

        } else {
          setPendingCounted(quantity);
          setPhase("reason-speaking");
          setStatusMessage(`${item.name} is below system count. Waiting for shortage reason.`);
          const reasonOk = await safeSpeak(
            `${item.name}: got ${quantity}, system count is ${item.quantity}. Why the shortage? Say: theft, spoilage, comp, return to warehouse, damaged, or missing from bin.`
          );
          if (!reasonOk) break;

          setPhase("reason-listening");
          setLastHeard("");
          const reasonTranscript = await safeListen(12000);
          if (reasonTranscript === null) break;

          const aiReason = await parseWithAI(reasonTranscript || "", "reason", sessionItems);
          const reason = aiReason.action === "reason" ? aiReason.reason : parseReason(reasonTranscript || "");
          if (!(await confirmLargeChange(item, quantity))) {
            setPendingCounted(null);
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "skipped", adjustmentType: null });
            continue;
          }
          setStatusMessage(`Saving ${item.name}, count ${quantity}, reason ${reason}...`);
          try {
            await saveAdjustment(item.id, quantity, reason, false);
          } catch {
            logVoiceStep("custom.save.failed", { item: item.name, quantity, reason, operation: "adjust-lower" });
            setPendingCounted(null);
            await notifySaveFailed();
            addResult({ item, expected: item.quantity, counted: null, diff: null, status: "no-response", adjustmentType: null });
            continue;
          }
          addResult({ item, expected: item.quantity, counted: quantity, diff: quantity - item.quantity, status: "updated-lower", adjustmentType: reason });
          logVoiceStep("custom.save.updated-lower", { item: item.name, quantity, reason });
          await notifyCountSaved(`${item.name}: count updated to ${quantity} with reason ${reason} and written to inventory history.`);
          vibrate([50, 50, 100]);
          setPendingCounted(null);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown voice workflow error";
      logVoiceStep("custom.error", { message });
      const notice = `AI voice count could not start: ${message}`;
      setVoiceNotice(notice);
      setStatusMessage(notice);
      toast({
        title: "Voice workflow stopped",
        description: notice,
        variant: "destructive",
      });
    }

    isRunningRef.current = false;
    logVoiceStep("custom.end", { paused: controlRef.current.shouldPause, stopped: controlRef.current.shouldStop });
    releaseWakeLock();

    if (controlRef.current.shouldPause) {
      setPhase("paused");
    } else {
      await safeSpeak("Count complete.");
      setPhase("complete");
    }
  }, [safeSpeak, safeListen, addResult, acquireWakeLock, releaseWakeLock, notifySaveFailed, confirmLargeChange, confirmSpokenCount, notifyCountSaved, logVoiceStep, sessionLocation]);

  /* ── Build queue & start ── */
  const buildQueue = useCallback((): Item[] => {
    if (!countMode) return [];
    switch (countMode) {
      case "all": return [...items];
      case "low-stock": return items.filter((it) => it.quantity < it.minQuantity);
      case "category": return items.filter((it) => it.category === selectedCategory);
      case "custom": return [];
    }
  }, [countMode, items, selectedCategory]);

  const handleStart = useCallback(async () => {
    if (!countMode) {
      logVoiceStep("start.ignored", "No count mode selected.");
      return;
    }
    if (isRunningRef.current) {
      logVoiceStep("start.ignored", "Session is already running.");
      return;
    }

    resetVoiceSession();
    sessionResultsRef.current = [];
    setSessionResults([]);
    setVoiceDebugEntries([]);
    logVoiceStep("start.clicked", {
      countMode,
      location: sessionLocation,
      items: items.length,
      micPrecheckOk: Boolean(micPrecheck?.ok),
    });
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setLastHeard("");
    setVoiceNotice("");
    setStatusMessage("Starting voice session...");
    setPendingCounted(null);
    setCustomMatchedItem(null);
    setCustomSpokenQty(null);

    const queue = countMode === "custom" ? [] : buildQueue();
    if (countMode !== "custom" && queue.length === 0) {
      logVoiceStep("start.blocked", "No items are queued for this count mode.");
      setVoiceNotice("No items are queued for this count mode.");
      return;
    }

    setQueuedItems(queue);
    setPhase("speaking");

    if (!micPrecheck?.ok) {
      const ready = await runMicPrecheck();
      if (!ready) {
        logVoiceStep("start.blocked", "Microphone precheck failed.");
        setPhase("select-mode");
        setStatusMessage("");
        return;
      }
    }

    if (countMode === "custom") {
      logVoiceStep("start.custom-session", { items: items.length });
      runCustomSession(items);
    } else {
      logVoiceStep("start.queue-session", { queue: queue.length });
      runSession(queue, 0);
    }
  }, [
    countMode,
    buildQueue,
    runSession,
    runCustomSession,
    items,
    micPrecheck,
    runMicPrecheck,
    resetVoiceSession,
    logVoiceStep,
    sessionLocation,
  ]);

  const handlePause = useCallback(() => {
    controlRef.current.shouldPause = true;
    setPhase("paused");
    setVoiceCapture(null);
    confirmationResolverRef.current?.("no");
    confirmationResolverRef.current = null;
    cancelAll();
    releaseWakeLock();
  }, [cancelAll, releaseWakeLock]);

  const handleResume = useCallback(() => {
    resetVoiceSession();
    if (countMode === "custom") {
      runCustomSession(items);
    } else {
      runSession(queuedItems, currentIndexRef.current);
    }
  }, [countMode, runCustomSession, runSession, items, queuedItems, resetVoiceSession]);

  const handleSkip = useCallback(() => {
    controlRef.current.shouldSkip = true;
    cancelSpeech();
    stopListening();
  }, [cancelSpeech, stopListening]);

  const handleRepeat = useCallback(() => {
    controlRef.current.shouldRepeat = true;
    cancelSpeech();
    stopListening();
  }, [cancelSpeech, stopListening]);

  const handleManualConfirmation = useCallback((choice: ConfirmationChoice) => {
    confirmationResolverRef.current?.(choice);
    stopListening();
    setVoiceCapture(null);
  }, [stopListening]);

  const handleFinish = useCallback(() => {
    controlRef.current.shouldStop = true;
    setPhase("complete");
    setVoiceCapture(null);
    confirmationResolverRef.current?.("no");
    confirmationResolverRef.current = null;
    cancelAll();
    releaseWakeLock();
  }, [cancelAll, releaseWakeLock]);

  useEffect(() => {
    return () => {
      controlRef.current.shouldStop = true;
      cancelAll();
      releaseWakeLock();
    };
  }, [cancelAll, releaseWakeLock]);

  const resetSession = useCallback(() => {
    setPhase("setup");
    setCountMode(null);
    setSelectedCategory("");
    setSessionResults([]);
    sessionResultsRef.current = [];
    setCurrentIndex(0);
    setPendingCounted(null);
    setQueuedItems([]);
    setCustomMatchedItem(null);
    setCustomSpokenQty(null);
    setVoiceNotice("");
    setVoiceCapture(null);
    setPendingConfirmation(null);
    confirmationResolverRef.current?.("no");
    confirmationResolverRef.current = null;
  }, []);

  /* ── Derived state ── */
  const isCustomMode = countMode === "custom";
  const isActive = ["speaking", "listening", "reason-speaking", "reason-listening", "custom-listening"].includes(phase);
  const isListening = phase === "listening" || phase === "reason-listening" || phase === "custom-listening";
  const isSpeaking = phase === "speaking" || phase === "reason-speaking";
  const isReasonPhase = phase === "reason-speaking" || phase === "reason-listening";
  const currentItem = queuedItems[currentIndex];

  const summaryVerified = sessionResults.filter((r) => r.status === "verified").length;
  const summaryUpdated = sessionResults.filter((r) => r.status === "updated-lower" || r.status === "updated-higher").length;
  const summarySkipped = sessionResults.filter((r) => r.status === "skipped" || r.status === "no-response").length;

  const queueSize = buildQueue().length;
  const voiceCaptureLabel =
    voiceCapture?.state === "requesting-microphone"
      ? "Opening microphone..."
      : voiceCapture?.state === "recording"
      ? "Recording voice..."
      : voiceCapture?.state === "transcribing"
      ? "Transcribing audio..."
      : "";
  const voiceCaptureLevel = voiceCapture?.state === "recording" ? voiceCapture.level : 0;

  const showOverlay = (isActive || phase === "paused") && (isCustomMode || !!currentItem);

  /* ── ACTIVE / PAUSED: full-screen overlay ────────────────────────── */
  if (showOverlay) {
    const isCustomListening = phase === "custom-listening";
    const displayItem = isCustomMode ? customMatchedItem : currentItem;
    const progress = isCustomMode
      ? null
      : Math.round(((currentIndex + 1) / queuedItems.length) * 100);

    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-background"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/80 backdrop-blur shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-muted-foreground tabular-nums">
                {isCustomMode ? (
                  <span className="text-primary/80 flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> AI Voice Mode
                  </span>
                ) : (
                  <>
                    {currentIndex + 1} / {queuedItems.length}
                    {countMode && (
                      <span className="ml-1.5 text-primary/70">&middot; {MODE_LABELS[countMode]}</span>
                    )}
                  </>
                )}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">{sessionLocation}</span>
            </div>
            {!isCustomMode && progress !== null && (
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary rounded-full h-1.5 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {isCustomMode && (
              <div className="text-xs text-muted-foreground">
                {summaryVerified + summaryUpdated + summarySkipped} items logged
              </div>
            )}
          </div>

          <button
            onClick={handleFinish}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors active:scale-95 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col justify-between px-6 py-4 overflow-hidden min-h-0">
          {voiceNotice && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{voiceNotice}</span>
            </div>
          )}

          {voiceDebugEntries.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold uppercase tracking-wide text-foreground">Voice diagnostic log</span>
                <span>{voiceDebugEntries.length} events</span>
              </div>
              <div className="max-h-28 space-y-1 overflow-auto">
                {voiceDebugEntries.slice(0, 6).map((entry, index) => (
                  <div key={`${entry.at}-${entry.step}-${index}`} className="grid grid-cols-[4.8rem_1fr] gap-2">
                    <span className="tabular-nums">{entry.at}</span>
                    <span className="truncate">
                      <span className="font-semibold text-foreground">{entry.step}</span>
                      {entry.detail ? <span> - {entry.detail}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Custom mode: AI Voice UI ── */}
          {isCustomMode && (
            <>
              {/* Matched item display */}
              <div className="space-y-1 pt-2 min-h-[100px]">
                {displayItem ? (
                  <>
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      {displayItem.category}
                      {isReasonPhase && (
                        <span className="ml-2 text-amber-500 normal-case tracking-normal font-bold">
                          &middot; Shrinkage reason?
                        </span>
                      )}
                    </p>
                    <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight break-words">
                      {displayItem.name}
                    </h2>
                    {customSpokenQty !== null && (
                      <div className="flex items-end gap-6 mt-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">You said</p>
                          <p className={`text-5xl font-black tabular-nums ${
                            customSpokenQty === displayItem.quantity
                              ? "text-emerald-500"
                              : customSpokenQty < displayItem.quantity
                              ? "text-amber-500"
                              : "text-blue-500"
                          }`}>
                            {customSpokenQty}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">System</p>
                          <p className="text-5xl font-black text-primary tabular-nums">{displayItem.quantity}</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="pt-4">
                    <p className="text-lg font-bold text-muted-foreground">Say any item name + count</p>
                    <p className="text-sm text-muted-foreground mt-1">e.g. <em>"Coke Zero 5"</em> or <em>"three Red Bull"</em></p>
                  </div>
                )}
              </div>

              {/* Listening / speaking indicator */}
              <div className="flex flex-col items-center justify-center gap-3 py-4">
                {phase === "paused" ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <div className="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center">
                      <Pause className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-semibold">Session paused</p>
                  </div>
                ) : isCustomListening ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative flex items-center justify-center">
                      <span className="absolute w-28 h-28 rounded-full bg-primary/15 animate-ping" />
                      <span className="absolute w-22 h-22 rounded-full bg-primary/12 animate-pulse" />
                      <div className={`relative w-24 h-24 rounded-full flex items-center justify-center shadow-xl transition-colors ${
                        voiceCapture?.state === "transcribing" ? "bg-amber-500" : "bg-primary"
                      }`}>
                        <Mic className="w-11 h-11 text-primary-foreground" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-black text-primary">{voiceCaptureLabel || "Listening..."}</p>
                      {voiceCapture?.state === "recording" && (
                        <div className="mt-2 w-48 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-100"
                            style={{ width: `${Math.max(6, voiceCaptureLevel)}%` }}
                          />
                        </div>
                      )}
                      {lastHeard ? (
                        <p className="text-sm text-muted-foreground mt-1 italic">"{lastHeard}"</p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">
                          {voiceCapture?.state === "transcribing"
                            ? "Processing what you said"
                            : "Say an item name and count, or say \"done\" to finish"}
                        </p>
                      )}
                    </div>
                  </div>
                ) : isReasonPhase ? (
                  <div className="flex flex-col items-center gap-3">
                    {phase === "reason-listening" ? (
                      <div className="relative flex items-center justify-center">
                        <span className="absolute w-24 h-24 rounded-full bg-amber-400/20 animate-ping" />
                        <div className="relative w-20 h-20 rounded-full bg-amber-500 flex items-center justify-center shadow-lg">
                          <Mic className="w-9 h-9 text-white" />
                        </div>
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
                        <Volume2 className="w-9 h-9 text-amber-600 animate-pulse" />
                      </div>
                    )}
                    <div className="text-center">
                      <p className="text-sm font-bold text-amber-600">
                        {phase === "reason-listening" ? "Listening for reason…" : statusMessage}
                      </p>
                      {lastHeard && phase === "reason-listening" && (
                        <p className="text-sm text-muted-foreground mt-0.5 italic">"{lastHeard}"</p>
                      )}
                      {phase === "reason-listening" && !lastHeard && (
                        <p className="text-xs text-muted-foreground mt-0.5">theft · spoilage · comp · return · damaged · missing</p>
                      )}
                    </div>
                  </div>
                ) : isSpeaking ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-20 h-20 rounded-full bg-muted/40 border-2 border-border flex items-center justify-center">
                      <Volume2 className="w-9 h-9 text-muted-foreground animate-pulse" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground text-center max-w-xs">{statusMessage}</p>
                  </div>
                ) : null}
              </div>
            </>
          )}

          {/* ── Queue-based mode: existing UI ── */}
          {!isCustomMode && currentItem && (
            <>
              <div className="space-y-1 pt-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {currentItem.category}
                  {isReasonPhase && (
                    <span className="ml-2 text-amber-500 normal-case tracking-normal font-bold">
                      &middot; Why is it lower?
                    </span>
                  )}
                </p>
                <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight break-words">
                  {currentItem.name}
                </h2>
              </div>

              <div className="flex items-end gap-8 py-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">System Count</p>
                  <p className="text-7xl font-black text-primary tabular-nums leading-none">
                    {currentItem.quantity}
                  </p>
                </div>
                {pendingCounted !== null ? (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-500 mb-1">Counted</p>
                    <p className="text-7xl font-black text-amber-500 tabular-nums leading-none">
                      {pendingCounted}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">On shelf</p>
                    <p className="text-7xl font-black text-muted-foreground/50 tabular-nums leading-none">
                      {currentItem.quantity}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center justify-center gap-3 py-2">
                {phase === "paused" ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <div className="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center">
                      <Pause className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-semibold">Session paused</p>
                  </div>
                ) : isListening ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative flex items-center justify-center">
                      <span className="absolute w-24 h-24 rounded-full bg-primary/20 animate-ping" />
                      <span className="absolute w-20 h-20 rounded-full bg-primary/15 animate-pulse" />
                      <div className="relative w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-lg">
                        <Mic className="w-9 h-9 text-primary-foreground" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-bold text-primary">Listening…</p>
                      {lastHeard ? (
                        <p className="text-sm text-muted-foreground mt-0.5 italic">"{lastHeard}"</p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isReasonPhase
                            ? "Say: theft · spoilage · comp · return · damaged · missing"
                            : <span>Say the count or <em>"correct"</em></span>}
                        </p>
                      )}
                    </div>
                  </div>
                ) : isSpeaking ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-20 h-20 rounded-full bg-muted/40 border-2 border-border flex items-center justify-center">
                      <Volume2 className="w-9 h-9 text-muted-foreground animate-pulse" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground text-center max-w-xs">
                      {statusMessage}
                    </p>
                  </div>
                ) : null}
              </div>
            </>
          )}

          {isCustomMode && pendingConfirmation && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-primary">Confirm count</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Save <span className="font-semibold text-foreground">{pendingConfirmation.item.name}</span> as count{" "}
                  <span className="font-black text-foreground tabular-nums">{pendingConfirmation.quantity}</span>?
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleManualConfirmation("no")}
                  className="h-12 rounded-xl border border-border bg-card text-sm font-semibold text-foreground active:scale-[0.98] transition-transform"
                >
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={() => handleManualConfirmation("yes")}
                  className="h-12 rounded-xl bg-primary text-primary-foreground text-sm font-bold active:scale-[0.98] transition-transform"
                >
                  Confirm Save
                </button>
              </div>
            </div>
          )}

          {/* Last 3 results — shown in both modes */}
          {sessionResults.length > 0 && (
            <div className="space-y-1">
              {[...sessionResults].reverse().slice(0, 3).map((r, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30">
                  {r.status === "verified" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  {(r.status === "updated-lower" || r.status === "updated-higher") && (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                  {(r.status === "skipped" || r.status === "no-response") && (
                    <MinusCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <p className="text-xs font-medium truncate flex-1">{r.item.name}</p>
                  {r.adjustmentType && (
                    <span className="text-xs text-muted-foreground shrink-0">{r.adjustmentType}</span>
                  )}
                  {r.counted !== null && r.diff !== 0 && r.diff !== null && (
                    <span className={`text-xs font-bold tabular-nums shrink-0 ${r.diff < 0 ? "text-red-500" : "text-emerald-500"}`}>
                      {r.diff > 0 ? "+" : ""}{r.diff}
                    </span>
                  )}
                  {r.counted !== null && r.diff === 0 && (
                    <span className="text-xs font-bold text-emerald-500 shrink-0">✓</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div
          className="shrink-0 px-4 pt-3 pb-3 border-t border-border bg-card/80 backdrop-blur space-y-2"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))" }}
        >
          <div className="flex justify-center gap-4 text-xs font-semibold pb-1">
            <span className="text-emerald-600">✓ {summaryVerified} verified</span>
            <span className="text-amber-600">↕ {summaryUpdated} updated</span>
            <span className="text-muted-foreground">⊘ {summarySkipped} skipped</span>
          </div>

          {phase === "paused" ? (
            <>
              <button
                onClick={handleResume}
                className="w-full h-16 rounded-2xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-transform shadow"
              >
                <Play className="w-6 h-6" /> Resume
              </button>
              <div className="grid grid-cols-2 gap-3">
                {!isCustomMode && (
                  <button
                    onClick={handleSkip}
                    className="h-14 rounded-xl border-2 border-border bg-card font-semibold flex items-center justify-center gap-2 text-foreground active:scale-[0.97] transition-transform"
                  >
                    <SkipForward className="w-5 h-5" /> Skip
                  </button>
                )}
                <button
                  onClick={handleFinish}
                  className={`h-14 rounded-xl border-2 border-destructive/40 bg-destructive/5 text-destructive font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform ${isCustomMode ? "col-span-2" : ""}`}
                >
                  <X className="w-5 h-5" /> Finish
                </button>
              </div>
            </>
          ) : isCustomMode ? (
            /* Custom mode — only Pause + Finish */
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handlePause}
                className="h-16 rounded-2xl border-2 border-border bg-card font-semibold flex flex-col items-center justify-center gap-1 text-foreground active:scale-[0.97] transition-transform"
              >
                <Pause className="w-5 h-5" />
                <span className="text-xs">Pause</span>
              </button>
              <button
                onClick={handleFinish}
                className="h-16 rounded-2xl border-2 border-destructive/40 bg-destructive/5 text-destructive font-semibold flex flex-col items-center justify-center gap-1 active:scale-[0.97] transition-transform"
              >
                <X className="w-5 h-5" />
                <span className="text-xs">Finish</span>
              </button>
            </div>
          ) : (
            /* Queue modes — Pause / Skip / Repeat */
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handlePause}
                className="h-16 rounded-2xl border-2 border-border bg-card font-semibold flex flex-col items-center justify-center gap-1 text-foreground active:scale-[0.97] transition-transform"
              >
                <Pause className="w-5 h-5" />
                <span className="text-xs">Pause</span>
              </button>
              <button
                onClick={handleSkip}
                className="h-16 rounded-2xl border-2 border-border bg-card font-semibold flex flex-col items-center justify-center gap-1 text-foreground active:scale-[0.97] transition-transform"
              >
                <SkipForward className="w-5 h-5" />
                <span className="text-xs">Skip</span>
              </button>
              <button
                onClick={handleRepeat}
                className="h-16 rounded-2xl border-2 border-border bg-card font-semibold flex flex-col items-center justify-center gap-1 text-foreground active:scale-[0.97] transition-transform"
              >
                <RotateCcw className="w-5 h-5" />
                <span className="text-xs">Repeat</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── SETUP / SELECT-MODE / COMPLETE: inside Layout ─── */
  return (
    <Layout>
      {!hasPermission("use_voice_mode") ? (
        <NoPermissionPage message="You do not have permission to use voice mode." />
      ) : (
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (phase === "select-mode") { setPhase("setup"); setCountMode(null); }
              else { navigate("/inventory"); }
            }}
            className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
              <Mic className="w-7 h-7 text-primary" />
              Count Mode
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {phase === "setup" && "Pick a location to begin."}
              {phase === "select-mode" && "Choose how you want to count."}
              {phase === "complete" && "Session complete."}
            </p>
          </div>
        </div>

        {/* Browser support warning */}
        {!voiceSupport.hasSpeechRecognition && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300">
            <MicOff className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Voice input not ready.</strong>{" "}
              {!voiceSupport.isSecureContext
                ? "Open the app through HTTPS for microphone access."
                : "Use Chrome on Android or Safari on iOS for full voice support."}
            </span>
          </div>
        )}

        <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
          micPrecheck?.ok
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
            : micPrecheck
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
              : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
        }`}>
          <div className="flex items-start gap-3">
            {micPrecheck?.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <Mic className="w-4 h-4 mt-0.5 shrink-0" />}
            <div>
              <p className="font-semibold">Microphone precheck</p>
              <p className="mt-0.5">
                {micPrecheck?.message ?? "Run this before AI translation testing to confirm browser permission and recording support."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runMicPrecheck}
            disabled={micChecking}
            className="shrink-0 bg-background/80"
          >
            {micChecking ? "Checking..." : micPrecheck?.ok ? "Check Again" : "Check Mic"}
          </Button>
        </div>

        {aiStatus?.configured === false && (
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-900 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-200">
            <Wand2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>AI credentials are not connected.</strong> Custom voice mode will use local item matching until the API key is added.
            </span>
          </div>
        )}

        {locationsError && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{locationsError} Showing fallback location names.</span>
          </div>
        )}

        {voiceDebugEntries.length > 0 && phase !== "setup" && (
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold uppercase tracking-wide text-foreground">Voice diagnostic log</span>
              <span>{voiceDebugEntries.length} events</span>
            </div>
            <div className="space-y-1">
              {voiceDebugEntries.slice(0, 6).map((entry, index) => (
                <div key={`${entry.at}-${entry.step}-page-${index}`} className="grid grid-cols-[5rem_1fr] gap-2">
                  <span className="tabular-nums">{entry.at}</span>
                  <span>
                    <span className="font-semibold text-foreground">{entry.step}</span>
                    {entry.detail ? <span> - {entry.detail}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 1: Location ── */}
        {phase === "setup" && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-6 max-w-md mx-auto">
            <div className="text-center space-y-1">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Mic className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-xl font-bold mt-3">Select Location</h2>
              <p className="text-sm text-muted-foreground">
                Pick a location, then choose your count mode.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">Location</label>
              <Select
                value={sessionLocation ?? ""}
                onValueChange={(val) => {
                  setSessionLocation(val);
                  setCountMode(null);
                  setSelectedCategory("");
                }}
              >
                <SelectTrigger className="w-full h-12 text-base">
                  <SelectValue placeholder="Choose a location…" />
                </SelectTrigger>
                <SelectContent>
                  {selectableLocations.map((loc) => (
                    <SelectItem key={loc} value={loc} className="text-base py-3">{loc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sessionLocation && (
              <div className="text-sm text-muted-foreground bg-muted/40 rounded-xl px-4 py-3 text-center">
                {itemsLoading ? (
                  <span>Loading items at {sessionLocation}…</span>
                ) : itemsError ? (
                  <span className="text-destructive">
                    Could not load items for {sessionLocation}. {itemsErrorMessage}
                  </span>
                ) : hasItems ? (
                  <>
                    <span className="text-2xl font-black text-foreground">{items.length}</span>
                    <span className="ml-1">items at {sessionLocation}</span>
                  </>
                ) : (
                  <span>No items found at {sessionLocation}. You can still continue to review count options.</span>
                )}
              </div>
            )}

            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={!sessionLocation || locationsLoading || itemsLoading}
              onClick={() => setPhase("select-mode")}
            >
              Next
              <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
          </div>
        )}

        {/* ── STEP 2: Count Mode Selection ── */}
        {phase === "select-mode" && (
          <div className="space-y-4 max-w-md mx-auto">
            {!hasItems && !itemsLoading && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  No countable inventory is loaded for {sessionLocation}. Add items or choose another location before starting a voice count.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">

              {/* All items */}
              <button
                disabled={!hasItems}
                onClick={() => setCountMode("all")}
                className={`flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all active:scale-[0.97] text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  countMode === "all" ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${countMode === "all" ? "bg-primary/15" : "bg-muted/60"}`}>
                  <PackageSearch className={`w-6 h-6 ${countMode === "all" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="font-bold text-sm">All Items</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{items.length} items</p>
                </div>
              </button>

              {/* Low stock */}
              <button
                disabled={!hasItems}
                onClick={() => setCountMode("low-stock")}
                className={`flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all active:scale-[0.97] text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  countMode === "low-stock" ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${countMode === "low-stock" ? "bg-primary/15" : "bg-muted/60"}`}>
                  <TrendingDown className={`w-6 h-6 ${countMode === "low-stock" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="font-bold text-sm">Low Stock</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {items.filter((it) => it.quantity < it.minQuantity).length} below minimum
                  </p>
                </div>
              </button>

              {/* By category */}
              <button
                disabled={!hasItems}
                onClick={() => setCountMode("category")}
                className={`flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all active:scale-[0.97] text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  countMode === "category" ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${countMode === "category" ? "bg-primary/15" : "bg-muted/60"}`}>
                  <Tag className={`w-6 h-6 ${countMode === "category" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="font-bold text-sm">By Category</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{categories.length} categories</p>
                </div>
              </button>

              {/* AI Voice (Custom) */}
              <button
                disabled={!hasItems}
                onClick={() => setCountMode("custom")}
                className={`flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all active:scale-[0.97] text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  countMode === "custom" ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${countMode === "custom" ? "bg-primary/15" : "bg-muted/60"}`}>
                  <Wand2 className={`w-6 h-6 ${countMode === "custom" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="font-bold text-sm">{aiStatus?.configured === false ? "Offline Voice" : "AI Voice"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {aiStatus?.configured === false ? "Local item match" : "You name the item"}
                  </p>
                </div>
              </button>
            </div>

            {/* Category sub-selector */}
            {countMode === "category" && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-2">
                <label className="text-sm font-semibold">Category</label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-full h-11">
                    <SelectValue placeholder="Choose a category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat} ({items.filter((it) => it.category === cat).length} items)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* AI Voice explanation card */}
            {countMode === "custom" && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
                <p className="text-sm font-bold text-primary flex items-center gap-1.5">
                  <Wand2 className="w-4 h-4" /> How it works
                </p>
                <ol className="text-sm text-muted-foreground space-y-1.5 list-none pl-0">
                  <li className="flex items-start gap-2"><span className="text-primary font-bold shrink-0">1.</span> App listens — you speak the item name + count</li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold shrink-0">2.</span> {aiStatus?.configured === false ? "Local matching finds the inventory item" : "AI matches the item from your inventory"}</li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold shrink-0">3.</span> Count matches par → <strong className="text-emerald-600">"OK"</strong></li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold shrink-0">4.</span> Short → prompted for shrinkage category</li>
                </ol>
                <p className="text-xs text-muted-foreground border-t pt-2 mt-2">
                  Example: say <em className="font-semibold">"Coke Zero 5"</em> or <em className="font-semibold">"Red Bull three"</em> &mdash; say <em>"done"</em> to finish.
                </p>
                {aiStatus?.configured === false && (
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    API credentials are pending, so this mode avoids remote AI calls and uses stricter local matching.
                  </p>
                )}
              </div>
            )}

            {/* Queue preview (non-custom modes) */}
            {countMode && countMode !== "custom" && (
              <div className="text-sm text-muted-foreground bg-muted/40 rounded-xl px-4 py-3 text-center">
                <span className="text-2xl font-black text-foreground">{queueSize}</span>
                <span className="ml-1">items queued</span>
              </div>
            )}

            {/* Start button */}
            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={
                !countMode ||
                (countMode !== "custom" && queueSize === 0) ||
                (countMode === "custom" && !hasItems) ||
                (countMode === "category" && !selectedCategory)
              }
              onClick={handleStart}
            >
              {countMode === "custom" ? (
                <><Wand2 className="w-5 h-5 mr-2" /> {aiStatus?.configured === false ? "Start Offline Voice Count" : "Start AI Voice Count"}</>
              ) : (
                <><Play className="w-5 h-5 mr-2" /> Start Count</>
              )}
            </Button>

            {/* Voice commands reference (queue modes only) */}
            {countMode && countMode !== "custom" && (
              <div className="text-xs text-muted-foreground space-y-1.5 border-t pt-4">
                <p className="font-bold text-foreground">Voice commands</p>
                <p><span className="font-semibold">"correct"</span> or <span className="font-semibold">"yes"</span> → verified, no change</p>
                <p><span className="font-semibold">"it's 4"</span> / <span className="font-semibold">"only four"</span> → sets quantity</p>
                <p className="text-muted-foreground/70">If lower: theft · spoilage · comp · return to warehouse · damaged · missing from bin</p>
              </div>
            )}
          </div>
        )}

        {/* ── COMPLETE ── */}
        {phase === "complete" && (
          <div className="space-y-5 max-w-md mx-auto">
            <div className="bg-card border border-border rounded-2xl shadow-sm p-6 text-center space-y-5">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto dark:bg-emerald-950/40">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold">Count Complete</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  {sessionLocation}
                  {countMode && <span className="ml-1.5">&middot; {MODE_LABELS[countMode]}</span>}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl p-4">
                  <p className="text-3xl font-black text-emerald-600">{summaryVerified}</p>
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">Verified</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4">
                  <p className="text-3xl font-black text-amber-600">{summaryUpdated}</p>
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mt-0.5">Updated</p>
                </div>
                <div className="bg-muted/60 rounded-xl p-4">
                  <p className="text-3xl font-black text-muted-foreground">{summarySkipped}</p>
                  <p className="text-xs font-bold text-muted-foreground mt-0.5">Skipped</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-12 rounded-xl font-semibold" onClick={resetSession}>
                  New Count
                </Button>
                <Button className="flex-1 h-12 rounded-xl font-semibold" onClick={() => navigate("/inventory")}>
                  View Inventory
                </Button>
              </div>
            </div>

            {/* Full results list */}
            {sessionResults.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <p className="text-sm font-bold">All Results</p>
                </div>
                <div className="divide-y divide-border">
                  {sessionResults.map((r, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-4 py-3">
                      {r.status === "verified" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                      {(r.status === "updated-lower" || r.status === "updated-higher") && (
                        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                      )}
                      {(r.status === "skipped" || r.status === "no-response") && (
                        <MinusCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{r.item.name}</p>
                        {r.adjustmentType && (
                          <p className="text-xs text-muted-foreground">{r.adjustmentType}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {r.counted !== null ? (
                          <>
                            <p className="text-sm font-bold tabular-nums">
                              {r.counted} <span className="text-muted-foreground font-normal text-xs">/ {r.expected}</span>
                            </p>
                            {r.diff !== null && r.diff !== 0 && (
                              <p className={`text-xs font-bold ${r.diff < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                {r.diff > 0 ? "+" : ""}{r.diff}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">skipped</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </Layout>
  );
}
