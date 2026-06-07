import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { useVoice, getVoiceSupport } from "@/hooks/use-voice";
import {
  buildWarehouseItemCreatePayloadFromVoiceDraft,
  isCompleteWarehouseVoiceAddItemDraft,
  parseWarehouseVoiceAddItemConfirmation,
  warehouseVoiceAddItemDraftSummary,
  type WarehouseVoiceAddItemDraft,
  type WarehouseVoiceAddItemDraftResponse,
} from "@/lib/warehouse-voice-add-item";
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
  Warehouse,
  PackagePlus,
  Wand2,
  TrendingDown,
  Tag,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LIST_PAGE_SIZE = 50;

function listPageCount(total: number) {
  return Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
}

function ResultsPager({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= LIST_PAGE_SIZE) return null;
  const pages = listPageCount(total);
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * LIST_PAGE_SIZE + 1;
  const end = Math.min(total, safePage * LIST_PAGE_SIZE);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span>Showing {start}-{end} of {total}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 px-3" disabled={safePage <= 1} onClick={() => onPageChange(Math.max(1, safePage - 1))}>
          Previous
        </Button>
        <Button variant="outline" size="sm" className="h-8 px-3" disabled={safePage >= pages} onClick={() => onPageChange(Math.min(pages, safePage + 1))}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ── Types ──────────────────────────────────────────────────────── */

type Phase =
  | "setup"
  | "select-mode"
  | "speaking"
  | "listening"
  | "custom-listening"
  | "paused"
  | "complete";

type CountMode = "all" | "low-stock" | "category" | "ai";

type ResultStatus = "verified" | "updated" | "skipped" | "no-response";

interface WarehouseItem {
  id: number;
  name: string;
  barcode: string | null;
  category: string;
  quantity: number;
  minPar: number;
  maxPar: number;
  reorderPoint: number;
  status: "out" | "low" | "reorder" | "ok" | "overstock";
}

interface SessionResult {
  item: WarehouseItem;
  systemQty: number;
  counted: number | null;
  diff: number | null;
  status: ResultStatus;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

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

function findBestItemMatch(query: string, items: WarehouseItem[]): WarehouseItem | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const queryWords = q.split(/\s+/).filter((w) => w.length > 1);

  let bestScore = 0;
  let bestItem: WarehouseItem | null = null;

  for (const item of items) {
    const name = item.name.toLowerCase();
    if (name.includes(q) || q.includes(name)) {
      const score = (Math.min(name.length, q.length) / Math.max(name.length, q.length)) * 100;
      if (score > bestScore) { bestScore = score; bestItem = item; }
      continue;
    }
    const itemWords = name.split(/\s+/).filter((w) => w.length > 1);
    let matchCount = 0;
    for (const qw of queryWords) {
      if (itemWords.some((iw) => iw.includes(qw) || qw.includes(iw))) matchCount++;
    }
    const score = queryWords.length > 0 ? (matchCount / queryWords.length) * 100 : 0;
    if (score > bestScore && score >= 50) { bestScore = score; bestItem = item; }
  }

  return bestScore >= 40 ? bestItem : null;
}

function parseVoiceCommand(transcript: string, items: WarehouseItem[]): { item: WarehouseItem; quantity: number } | null {
  const t = transcript.toLowerCase().trim();
  let quantity: number | null = null;
  let nameText = t;

  const digitEnd = t.match(/^(.*?)\s+(\d+)\s*$/);
  if (digitEnd) { quantity = parseInt(digitEnd[2]!, 10); nameText = digitEnd[1]!.trim(); }

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

  if (quantity === null) {
    const digitStart = t.match(/^(\d+)\s+(.+)$/);
    if (digitStart) { quantity = parseInt(digitStart[1]!, 10); nameText = digitStart[2]!.trim(); }
  }

  if (quantity === null) return null;
  const item = findBestItemMatch(nameText, items);
  if (!item) return null;
  return { item, quantity };
}

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

async function saveWarehouseCount(itemId: number, quantity: number) {
  await fetch(`${BASE}/api/warehouse/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
}

const MODE_LABELS: Record<CountMode, string> = {
  "all": "All Items",
  "low-stock": "Low / Out of Stock",
  "category": "By Category",
  "ai": "AI Voice",
};

const MODE_DESCS: Record<CountMode, string> = {
  "all": "Tally every item in the warehouse",
  "low-stock": "Focus on items below min par or out of stock",
  "category": "Tally a single product category",
  "ai": "Say any item name and count freely",
};

const MODE_ICONS: Record<CountMode, React.ReactNode> = {
  "all": <Warehouse className="w-5 h-5" />,
  "low-stock": <TrendingDown className="w-5 h-5" />,
  "category": <Tag className="w-5 h-5" />,
  "ai": <Wand2 className="w-5 h-5" />,
};

/* ── Component ──────────────────────────────────────────────────────── */

export default function WarehouseVoice() {
  const [, navigate] = useLocation();
  const { hasPermission } = useAuth();
  const { speak, cancelSpeech, listen, stopListening, cancelAll } = useVoice();
  const voiceSupport = getVoiceSupport();

  const [phase, setPhase] = useState<Phase>("setup");
  const [countMode, setCountMode] = useState<CountMode | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [currentIndex, setCurrentIndex] = useState(0);
  const [queuedItems, setQueuedItems] = useState<WarehouseItem[]>([]);
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([]);
  const [resultsPage, setResultsPage] = useState(1);
  const [statusMessage, setStatusMessage] = useState("");
  const [lastHeard, setLastHeard] = useState("");

  const [aiMatchedItem, setAiMatchedItem] = useState<WarehouseItem | null>(null);
  const [aiSpokenQty, setAiSpokenQty] = useState<number | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState("default");
  const [warehouseAddItemDraft, setWarehouseAddItemDraft] = useState<WarehouseVoiceAddItemDraftResponse | null>(null);
  const [warehouseAddItemBusy, setWarehouseAddItemBusy] = useState(false);

  const controlRef = useRef({ shouldStop: false, shouldSkip: false, shouldRepeat: false, shouldPause: false });
  const currentIndexRef = useRef(0);
  const sessionResultsRef = useRef<SessionResult[]>([]);
  const isRunningRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef = useRef<any>(null);

  const { data: warehouseData, refetch: refetchWarehouse } = useQuery({
    queryKey: ["warehouse-voice-items"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/warehouse`);
      return res.json() as Promise<{ items: WarehouseItem[]; categories: string[] }>;
    },
  });

  const items: WarehouseItem[] = warehouseData?.items ?? [];
  const categories: string[] = useMemo(() => {
    const cats = new Set(items.map((i) => i.category).filter(Boolean));
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

  /* ── Voice helpers ── */
  const safeSpeak = useCallback(async (text: string): Promise<boolean> => {
    if (controlRef.current.shouldStop || controlRef.current.shouldPause) return false;
    setStatusMessage(text);
    vibrate(30);
    await speak(text);
    return !controlRef.current.shouldStop && !controlRef.current.shouldPause;
  }, [speak]);

  const safeListen = useCallback(async (timeoutMs: number): Promise<string | null> => {
    if (controlRef.current.shouldStop || controlRef.current.shouldPause) return null;
    vibrate([50, 30, 50]);
    const transcript = await listen(timeoutMs);
    if (controlRef.current.shouldStop || controlRef.current.shouldPause) return null;
    setLastHeard(transcript || "");
    return transcript;
  }, [listen]);

  /* ── QUEUE-BASED session ── */
  const runSession = useCallback(async (queue: WarehouseItem[], startIndex: number) => {
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
        const ok = await safeSpeak(`${item.name}. System shows ${item.quantity}.`);
        if (!ok) break itemLoop;

        setPhase("listening");
        setLastHeard("");
        const transcript = await safeListen(9000);
        if (transcript === null) break itemLoop;

        if (controlRef.current.shouldSkip) {
          addResult({ item, systemQty: item.quantity, counted: null, diff: null, status: "skipped" });
          break itemLoop;
        }
        if (controlRef.current.shouldRepeat) continue itemLoop;

        const { isVerified, quantity } = parseQuantity(transcript, item.quantity);

        if (quantity === null && !isVerified) {
          await safeSpeak("Didn't catch that. Skipping.");
          addResult({ item, systemQty: item.quantity, counted: null, diff: null, status: "no-response" });
          break itemLoop;
        }

        const counted = quantity!;

        if (isVerified || counted === item.quantity) {
          vibrate(100);
          await safeSpeak("Verified.");
          addResult({ item, systemQty: item.quantity, counted: item.quantity, diff: 0, status: "verified" });
          break itemLoop;
        }

        const diff = counted - item.quantity;
        await saveWarehouseCount(item.id, counted);
        addResult({ item, systemQty: item.quantity, counted, diff, status: "updated" });
        vibrate([50, 50, 100]);
        await safeSpeak(`Got ${counted}. ${diff > 0 ? "Plus" : "Minus"} ${Math.abs(diff)}. Saved.`);
        break itemLoop;
      }
    }

    isRunningRef.current = false;
    releaseWakeLock();

    if (controlRef.current.shouldStop) {
      setPhase("complete");
    } else if (controlRef.current.shouldPause) {
      setPhase("paused");
    } else {
      await speak("Warehouse tally complete.");
      setPhase("complete");
    }
  }, [safeSpeak, safeListen, addResult, speak, acquireWakeLock, releaseWakeLock]);

  /* ── AI VOICE session ── */
  const runAiSession = useCallback(async (sessionItems: WarehouseItem[]) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    controlRef.current = { shouldStop: false, shouldSkip: false, shouldRepeat: false, shouldPause: false };
    await acquireWakeLock();

    await safeSpeak("Ready. Say an item name and count.");

    while (!controlRef.current.shouldStop && !controlRef.current.shouldPause) {
      setPhase("custom-listening");
      setLastHeard("");
      setAiMatchedItem(null);
      setAiSpokenQty(null);

      const transcript = await safeListen(20000);
      if (transcript === null) break;
      if (!transcript.trim()) continue;

      if (/\b(done|stop|finish|exit|end|quit)\b/.test(transcript)) break;

      const parsed = parseVoiceCommand(transcript, sessionItems);

      if (!parsed) {
        await safeSpeak("Didn't recognize that. Try again.");
        continue;
      }

      const { item, quantity } = parsed;
      setAiMatchedItem(item);
      setAiSpokenQty(quantity);

      if (quantity === item.quantity) {
        vibrate(100);
        addResult({ item, systemQty: item.quantity, counted: quantity, diff: 0, status: "verified" });
        await safeSpeak("Verified.");
      } else {
        const diff = quantity - item.quantity;
        await saveWarehouseCount(item.id, quantity);
        addResult({ item, systemQty: item.quantity, counted: quantity, diff, status: "updated" });
        vibrate([50, 50, 100]);
        await safeSpeak(`${item.name}: saved ${quantity}. ${diff > 0 ? "Plus" : "Minus"} ${Math.abs(diff)}.`);
      }
    }

    isRunningRef.current = false;
    releaseWakeLock();

    if (controlRef.current.shouldPause) {
      setPhase("paused");
    } else {
      await speak("Tally complete.");
      setPhase("complete");
    }
  }, [safeSpeak, safeListen, addResult, speak, acquireWakeLock, releaseWakeLock]);

  const createWarehouseItemFromVoiceDraft = useCallback(async (draft: WarehouseVoiceAddItemDraft): Promise<WarehouseItem> => {
    const res = await fetch(`${BASE}/api/warehouse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWarehouseItemCreatePayloadFromVoiceDraft(draft)),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<WarehouseItem>;
  }, []);

  const handleWarehouseVoiceAddItem = useCallback(async () => {
    if (isRunningRef.current || warehouseAddItemBusy) return;

    if (!hasPermission("edit_warehouse")) {
      setStatusMessage("You do not have permission to add warehouse items.");
      return;
    }

    isRunningRef.current = true;
    setWarehouseAddItemBusy(true);
    setWarehouseAddItemDraft(null);
    setLastHeard("");
    controlRef.current = { shouldStop: false, shouldSkip: false, shouldRepeat: false, shouldPause: false };

    try {
      await acquireWakeLock();
      setPhase("custom-listening");
      await safeSpeak("Tell me the new warehouse item name, category, quantity, minimum, maximum, and optional barcode.");

      const transcript = await safeListen(22000);
      if (transcript === null || !transcript.trim()) {
        await safeSpeak("I did not catch the new warehouse item details. Try add item by voice again.");
        setPhase("setup");
        return;
      }

      setStatusMessage("Building warehouse item draft...");
      const draftRes = await fetch(`${BASE}/api/voice/warehouse/add-item/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!draftRes.ok) throw new Error(await draftRes.text());

      const draftData = (await draftRes.json()) as WarehouseVoiceAddItemDraftResponse;
      setWarehouseAddItemDraft(draftData);

      if (draftData.status !== "draft" || !isCompleteWarehouseVoiceAddItemDraft(draftData.draft)) {
        const message = draftData.nextQuestion ?? "The warehouse item draft is missing required details. Please try again with name, category, quantity, minimum, and maximum.";
        setStatusMessage(message);
        await safeSpeak(message);
        setPhase("setup");
        return;
      }

      const summary = warehouseVoiceAddItemDraftSummary(draftData.draft);
      const confirmMessage = `I heard ${summary}. Say confirm to create it in warehouse inventory, or no to cancel.`;
      setStatusMessage(confirmMessage);
      await safeSpeak(confirmMessage);

      const confirmationTranscript = await safeListen(12000);
      const confirmation = confirmationTranscript ? parseWarehouseVoiceAddItemConfirmation(confirmationTranscript) : "unknown";
      if (confirmation !== "yes") {
        const message = confirmation === "no"
          ? "Okay, warehouse item was not created."
          : "I could not confirm that, so I did not create the warehouse item.";
        setStatusMessage(message);
        await safeSpeak(message);
        setPhase("setup");
        return;
      }

      const created = await createWarehouseItemFromVoiceDraft(draftData.draft);
      await refetchWarehouse();
      const successMessage = `Created ${created.name} in warehouse inventory with quantity ${created.quantity}.`;
      setStatusMessage(successMessage);
      await safeSpeak(successMessage);
      setPhase("setup");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not add that warehouse item by voice.";
      setStatusMessage(`Voice add item failed. ${message}`);
      await safeSpeak("Could not add that warehouse item by voice. Check the details and try again.");
      setPhase("setup");
    } finally {
      isRunningRef.current = false;
      setWarehouseAddItemBusy(false);
      releaseWakeLock();
    }
  }, [
    warehouseAddItemBusy,
    hasPermission,
    acquireWakeLock,
    safeSpeak,
    safeListen,
    createWarehouseItemFromVoiceDraft,
    refetchWarehouse,
    releaseWakeLock,
  ]);

  /* ── Build queue & start ── */
  const buildQueue = useCallback((): WarehouseItem[] => {
    if (!countMode) return [];
    switch (countMode) {
      case "all": return [...items];
      case "low-stock": return items.filter((i) => i.quantity < i.minPar || i.quantity <= 0);
      case "category": return items.filter((i) => i.category === selectedCategory);
      case "ai": return [];
    }
  }, [countMode, items, selectedCategory]);

  const handleStart = useCallback(() => {
    sessionResultsRef.current = [];
    setSessionResults([]);
    setResultsPage(1);
    setCurrentIndex(0);
    setLastHeard("");
    setStatusMessage("");
    setAiMatchedItem(null);
    setAiSpokenQty(null);

    if (countMode === "ai") {
      setQueuedItems([]);
      runAiSession(items);
    } else {
      const queue = buildQueue();
      if (queue.length === 0) return;
      setQueuedItems(queue);
      runSession(queue, 0);
    }
  }, [countMode, buildQueue, runSession, runAiSession, items]);

  const handlePause = useCallback(() => {
    controlRef.current.shouldPause = true;
    cancelAll();
    releaseWakeLock();
  }, [cancelAll, releaseWakeLock]);

  const handleResume = useCallback(() => {
    if (countMode === "ai") {
      runAiSession(items);
    } else {
      runSession(queuedItems, currentIndexRef.current);
    }
  }, [countMode, runAiSession, runSession, items, queuedItems]);

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

  const handleFinish = useCallback(() => {
    controlRef.current.shouldStop = true;
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
    setResultsPage(1);
    setCurrentIndex(0);
    setQueuedItems([]);
    setAiMatchedItem(null);
    setAiSpokenQty(null);
    refetchWarehouse();
  }, [refetchWarehouse]);

  /* ── Derived state ── */
  const isAiMode = countMode === "ai";
  const isActive = ["speaking", "listening", "custom-listening"].includes(phase);
  const isListening = phase === "listening" || phase === "custom-listening";
  const isSpeaking = phase === "speaking";
  const currentItem = queuedItems[currentIndex];
  const showOverlay = (isActive || phase === "paused") && (isAiMode || !!currentItem);

  const summaryVerified = sessionResults.filter((r) => r.status === "verified").length;
  const summaryUpdated = sessionResults.filter((r) => r.status === "updated").length;
  const summarySkipped = sessionResults.filter((r) => r.status === "skipped" || r.status === "no-response").length;
  const safeResultsPage = Math.min(resultsPage, listPageCount(sessionResults.length));
  const resultsPageStart = (safeResultsPage - 1) * LIST_PAGE_SIZE;
  const visibleSessionResults = sessionResults.slice(resultsPageStart, resultsPageStart + LIST_PAGE_SIZE);

  const queueSize = buildQueue().length;

  /* ── ACTIVE / PAUSED OVERLAY ──────────────────────────────────── */
  if (showOverlay) {
    const isAiListening = phase === "custom-listening";
    const displayItem = isAiMode ? aiMatchedItem : currentItem;
    const progress = isAiMode
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
                {isAiMode ? (
                  <span className="text-primary/80 flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> AI Voice · Warehouse
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
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <Warehouse className="w-3 h-3" /> Warehouse
              </span>
            </div>
            {!isAiMode && progress !== null && (
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary rounded-full h-1.5 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {isAiMode && (
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

          {/* AI Voice mode UI */}
          {isAiMode && (
            <>
              <div className="space-y-1 pt-2 min-h-[100px]">
                {displayItem ? (
                  <>
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      {displayItem.category}
                    </p>
                    <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight break-words">
                      {displayItem.name}
                    </h2>
                    {aiSpokenQty !== null && (
                      <div className="flex items-end gap-6 mt-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Counted</p>
                          <p className={`text-5xl font-black tabular-nums ${
                            aiSpokenQty === displayItem.quantity
                              ? "text-emerald-500"
                              : aiSpokenQty > displayItem.quantity
                              ? "text-blue-500"
                              : "text-amber-500"
                          }`}>
                            {aiSpokenQty}
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
                    <p className="text-sm text-muted-foreground mt-1">e.g. <em>"Coke Zero 48"</em> or <em>"twenty four Red Bull"</em></p>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center justify-center gap-3 py-4">
                {phase === "paused" ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <div className="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center">
                      <Pause className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-semibold">Session paused</p>
                  </div>
                ) : isAiListening ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative flex items-center justify-center">
                      <span className="absolute w-28 h-28 rounded-full bg-primary/15 animate-ping" />
                      <span className="absolute w-22 h-22 rounded-full bg-primary/12 animate-pulse" />
                      <div className="relative w-24 h-24 rounded-full bg-primary flex items-center justify-center shadow-xl">
                        <Mic className="w-11 h-11 text-primary-foreground" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-black text-primary">Listening…</p>
                      {lastHeard ? (
                        <p className="text-sm text-muted-foreground mt-1 italic">"{lastHeard}"</p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">Say <em>"done"</em> to finish</p>
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

          {/* Queue mode UI */}
          {!isAiMode && currentItem && (
            <>
              <div className="space-y-1 pt-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {currentItem.category}
                </p>
                <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight break-words">
                  {currentItem.name}
                </h2>
              </div>

              <div className="flex items-end gap-8 py-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">System qty</p>
                  <p className="text-7xl font-black text-primary tabular-nums leading-none">
                    {currentItem.quantity}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Min par</p>
                  <p className="text-4xl font-black text-muted-foreground/50 tabular-nums leading-none">
                    {currentItem.minPar}
                  </p>
                </div>
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
                          Say the count or <em>"correct"</em>
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

          {/* Recent results */}
          {sessionResults.length > 0 && (
            <div className="space-y-1">
              {[...sessionResults].reverse().slice(0, 3).map((r, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30">
                  {r.status === "verified" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  {r.status === "updated" && <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  {(r.status === "skipped" || r.status === "no-response") && (
                    <MinusCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <p className="text-xs font-medium truncate flex-1">{r.item.name}</p>
                  {r.counted !== null && r.diff !== null && r.diff !== 0 && (
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
                {!isAiMode && (
                  <button
                    onClick={handleSkip}
                    className="h-14 rounded-xl border-2 border-border bg-card font-semibold flex items-center justify-center gap-2 text-foreground active:scale-[0.97] transition-transform"
                  >
                    <SkipForward className="w-5 h-5" /> Skip
                  </button>
                )}
                <button
                  onClick={handleFinish}
                  className={`h-14 rounded-xl border-2 border-destructive/40 bg-destructive/5 text-destructive font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform ${isAiMode ? "col-span-2" : ""}`}
                >
                  <X className="w-5 h-5" /> Finish
                </button>
              </div>
            </>
          ) : isAiMode ? (
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

  /* ── SETUP / COMPLETE — inside Layout ────────────────────────── */
  return (
    <Layout>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (phase === "select-mode") { setPhase("setup"); setCountMode(null); }
              else { navigate("/warehouse"); }
            }}
            className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
              <Mic className="w-7 h-7 text-primary" />
              Tally
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {phase === "setup" && "Use AI voice to tally warehouse inventory or add new warehouse items."}
              {phase === "select-mode" && !countMode && "Choose how you want to tally existing inventory."}
              {phase === "select-mode" && countMode && "Review and start your tally."}
              {phase === "complete" && "Tally session complete."}
            </p>
          </div>
        </div>

        {/* Browser support warning */}
        {!voiceSupport.stt && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300">
            <MicOff className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Voice input not supported.</strong> Use Chrome on Android or Safari on iOS for full voice support.
            </span>
          </div>
        )}

        {/* ── STEP 1: Mode select ── */}
        {phase === "setup" && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-6 max-w-2xl mx-auto">
            <div className="text-center space-y-1">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Warehouse className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-xl font-bold mt-3">Tally</h2>
              <p className="text-sm text-muted-foreground">
                Pick a voice workflow. Tally counts existing warehouse stock, while Add Item creates new warehouse inventory only.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setCountMode(null);
                  setSelectedCategory("");
                  setPhase("select-mode");
                }}
                className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-5 text-left transition-all hover:border-primary/60 hover:bg-primary/10 active:scale-[0.98]"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                    <Mic className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-extrabold text-base">Start Tally</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Speak item names and counts. KeepTally verifies matching counts or updates warehouse quantities after confirmation.
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between text-sm font-bold text-primary">
                  <span>Choose tally mode</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>

              <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <PackagePlus className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm">Add Warehouse Item by Voice</p>
                    <p className="text-xs text-muted-foreground">
                      Create new inventory in the warehouse first. Store locations receive it later by transfer.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Warehouse</label>
                  <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Select warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Main Warehouse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {warehouseAddItemDraft && (
                  <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold uppercase tracking-wide text-foreground">Latest warehouse draft</span>
                      <span className={warehouseAddItemDraft.status === "draft" ? "text-emerald-600" : "text-amber-600"}>
                        {warehouseAddItemDraft.status === "draft" ? "Ready" : "Needs details"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                      <span>Name: <strong className="text-foreground">{warehouseAddItemDraft.draft.name ?? "Missing"}</strong></span>
                      <span>Category: <strong className="text-foreground">{warehouseAddItemDraft.draft.category ?? "Missing"}</strong></span>
                      <span>Qty: <strong className="text-foreground">{warehouseAddItemDraft.draft.quantity ?? "Missing"}</strong></span>
                      <span>Min/Max: <strong className="text-foreground">{warehouseAddItemDraft.draft.minQuantity ?? "?"}/{warehouseAddItemDraft.draft.maxQuantity ?? "?"}</strong></span>
                      <span className="col-span-2">Barcode: <strong className="text-foreground">{warehouseAddItemDraft.draft.barcode ?? "Optional"}</strong></span>
                    </div>
                    {warehouseAddItemDraft.warnings.length > 0 && (
                      <p className="text-amber-700 dark:text-amber-300">{warehouseAddItemDraft.warnings.join(" ")}</p>
                    )}
                  </div>
                )}

                {statusMessage && !isActive && phase === "setup" && (
                  <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{statusMessage}</p>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 rounded-xl font-bold"
                  disabled={warehouseAddItemBusy || !hasPermission("edit_warehouse") || selectedWarehouse !== "default"}
                  onClick={handleWarehouseVoiceAddItem}
                >
                  <PackagePlus className="w-4 h-4 mr-2" />
                  {warehouseAddItemBusy ? "Listening for Warehouse Item..." : "Add Warehouse Item by Voice"}
                </Button>
                {!hasPermission("edit_warehouse") && (
                  <p className="text-xs text-muted-foreground">You need warehouse edit permission to create warehouse items.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2A: Count mode select ── */}
        {phase === "select-mode" && !countMode && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-5 max-w-md mx-auto">
            <div className="text-center space-y-1">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
                <Mic className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold mt-2">Start Tally</h2>
              <p className="text-sm text-muted-foreground">Choose how KeepTally should guide the warehouse count.</p>
            </div>

            <div className="space-y-3">
              {(["all", "low-stock", "category", "ai"] as CountMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setCountMode(mode);
                    setPhase("select-mode");
                  }}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                    countMode === mode
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:border-primary/40 hover:bg-muted/20"
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    {MODE_ICONS[mode]}
                  </div>
                  <div>
                    <p className="font-bold text-sm">{MODE_LABELS[mode]}</p>
                    <p className="text-xs text-muted-foreground">{MODE_DESCS[mode]}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 ml-auto shrink-0" />
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full h-12 rounded-xl font-bold"
              onClick={() => setPhase("setup")}
            >
              Back to Tally
            </Button>
          </div>
        )}

        {/* ── STEP 2B: Confirm / Category select ── */}
        {phase === "select-mode" && countMode && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-5 max-w-md mx-auto">
            <div className="text-center space-y-1">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
                {MODE_ICONS[countMode]}
              </div>
              <h2 className="text-xl font-bold mt-2">{MODE_LABELS[countMode]}</h2>
              <p className="text-sm text-muted-foreground">{MODE_DESCS[countMode]}</p>
            </div>

            {countMode === "category" && (
              <div className="space-y-2">
                <label className="text-sm font-semibold">Select category</label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Pick a category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Queue size info */}
            {countMode !== "ai" && (
              <div className="text-center py-3 bg-muted/30 rounded-xl">
                <p className="text-4xl font-black text-primary tabular-nums">{queueSize}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {queueSize === 1 ? "item" : "items"} in this tally
                </p>
              </div>
            )}

            {countMode === "ai" && (
              <div className="bg-muted/30 rounded-xl px-4 py-3 text-sm text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">How AI Voice works</p>
                <p>Say any item name + count in one phrase:</p>
                <p className="italic">"Coke Zero forty-eight"</p>
                <p className="italic">"Red Bull 24"</p>
                <p className="mt-1">Say "done" when finished.</p>
              </div>
            )}

            <Button
              onClick={handleStart}
              disabled={countMode === "category" && !selectedCategory}
              className="w-full h-14 rounded-2xl text-base font-bold"
            >
              <Mic className="w-5 h-5 mr-2" />
              Start Tally
            </Button>
          </div>
        )}

        {/* ── COMPLETE ── */}
        {phase === "complete" && (
          <div className="space-y-6 max-w-md mx-auto">
            {/* Summary */}
            <div className="bg-card border border-border rounded-2xl shadow-sm p-6 text-center space-y-4">
              <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold">Tally Complete</h2>
                <p className="text-muted-foreground text-sm mt-1">{sessionResults.length} items processed</p>
              </div>
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-xl py-3 px-2">
                  <p className="text-2xl font-black text-emerald-700">{summaryVerified}</p>
                  <p className="text-xs font-semibold text-emerald-700 mt-0.5">Verified</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl py-3 px-2">
                  <p className="text-2xl font-black text-amber-700">{summaryUpdated}</p>
                  <p className="text-xs font-semibold text-amber-700 mt-0.5">Updated</p>
                </div>
                <div className="bg-muted/50 rounded-xl py-3 px-2">
                  <p className="text-2xl font-black text-muted-foreground">{summarySkipped}</p>
                  <p className="text-xs font-semibold text-muted-foreground mt-0.5">Skipped</p>
                </div>
              </div>
            </div>

            {/* Per-item results */}
            {sessionResults.length > 0 && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
                <div className="px-4 py-3 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold">Count Details</span>
                </div>
                {visibleSessionResults.map((r, idx) => (
                  <div key={resultsPageStart + idx} className="flex items-center gap-3 px-4 py-3">
                    {r.status === "verified" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    {r.status === "updated" && <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
                    {(r.status === "skipped" || r.status === "no-response") && (
                      <MinusCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.item.name}</p>
                      <p className="text-xs text-muted-foreground">{r.item.category}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {r.counted !== null ? (
                        <>
                          <p className="text-sm font-bold tabular-nums">{r.counted}</p>
                          {r.diff !== null && r.diff !== 0 && (
                            <p className={`text-xs font-semibold tabular-nums ${r.diff < 0 ? "text-red-500" : "text-emerald-500"}`}>
                              {r.diff > 0 ? "+" : ""}{r.diff} vs system
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">—</p>
                      )}
                    </div>
                  </div>
                ))}
                <ResultsPager page={resultsPage} total={sessionResults.length} onPageChange={setResultsPage} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-14 rounded-2xl font-bold" onClick={resetSession}>
                <RotateCcw className="w-4 h-4 mr-2" /> Tally Again
              </Button>
              <Button className="h-14 rounded-2xl font-bold" onClick={() => navigate("/warehouse")}>
                <Warehouse className="w-4 h-4 mr-2" /> Warehouse
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
