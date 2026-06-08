import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ElementType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  Boxes,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PackageCheck,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Trash2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LIST_PAGE_SIZE = 50;

type RecommendationSeverity = "critical" | "warning" | "info";
type RecommendationType = "store_restock" | "store_overstock" | "warehouse_reorder";

type AgentRecommendation = {
  type: RecommendationType;
  severity: RecommendationSeverity;
  itemId: number;
  itemName: string;
  location?: string;
  quantity: number;
  minQuantity?: number;
  maxQuantity?: number;
  minPar?: number;
  maxPar?: number;
  recommendedTransferQty?: number;
  recommendedPurchaseQty?: number;
  message: string;
};

type HousekeepingResponse = {
  generatedAt: string;
  mode: "read_only";
  summary: {
    belowMinimumCount: number;
    overstockCount: number;
    warehouseReorderCount: number;
    recentChangeCount: number;
  };
  recommendations: AgentRecommendation[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "ai" | "deterministic" | "deterministic-fallback";
  generatedAt?: string;
  recommendationCount?: number;
};

type ConversationResponse = {
  answer: string;
  source: "ai" | "deterministic" | "deterministic-fallback";
  generatedAt?: string;
  context?: {
    summary: HousekeepingResponse["summary"];
    recommendationCount: number;
  };
};

type RestockReviewResponse = {
  storeItem: {
    id: number;
    name: string;
    category: string;
    location: string;
    quantity: number;
    minQuantity: number;
    maxQuantity: number;
    barcode: string | null;
    productId: number | null;
    status: string;
  };
  recommendation: {
    recommendedTransferQty: number;
    canTransfer: boolean;
    reason: string;
  };
  warehouseItem: {
    id: number;
    name: string;
    category: string;
    quantity: number;
    barcode: string | null;
    productId: number | null;
  } | null;
};

const GROUPS: Record<RecommendationType, { title: string; label: string; icon: ElementType }> = {
  store_restock: {
    title: "Store Restock",
    label: "Below minimum",
    icon: TrendingDown,
  },
  store_overstock: {
    title: "Store Overstock",
    label: "Above maximum",
    icon: Boxes,
  },
  warehouse_reorder: {
    title: "Warehouse Reorder",
    label: "Warehouse range",
    icon: ArrowRightLeft,
  },
};

const SUGGESTED_PROMPTS = [
  "What needs restocking first?",
  "Any overstock problems?",
  "What warehouse items need reordering?",
  "Give me today's quick housekeeping summary.",
  "What should I handle before a route leaves?",
  "Summarize risk by store location.",
];

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Ask me about restock priorities, overstock, warehouse reorders, recent changes, or what needs attention first.",
  source: "deterministic",
};

function severityClass(severity: RecommendationSeverity) {
  if (severity === "critical") return "bg-red-100 text-red-700 border-red-200";
  if (severity === "warning") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-sky-100 text-sky-700 border-sky-200";
}

function typeLabel(type: RecommendationType) {
  return GROUPS[type]?.label ?? type;
}

function recommendationQty(rec: AgentRecommendation) {
  if (rec.type === "store_restock") return rec.recommendedTransferQty ?? 0;
  if (rec.type === "warehouse_reorder") return rec.recommendedPurchaseQty ?? 0;
  return Math.max(0, rec.quantity - (rec.maxQuantity ?? rec.quantity));
}

function hasUsableConversation(data: HousekeepingResponse | undefined, error: unknown) {
  return Boolean(data && !error);
}

function RecommendationRow({
  rec,
  canReviewRestock,
  onReviewRestock,
}: {
  rec: AgentRecommendation;
  canReviewRestock: boolean;
  onReviewRestock: (rec: AgentRecommendation) => void;
}) {
  const qty = recommendationQty(rec);
  const range =
    rec.type === "warehouse_reorder"
      ? `${rec.minPar ?? 0}-${rec.maxPar ?? 0}`
      : `${rec.minQuantity ?? 0}-${rec.maxQuantity ?? 0}`;

  return (
    <div className="grid grid-cols-1 gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{rec.itemName}</p>
          <Badge variant="outline" className={`text-[11px] font-semibold ${severityClass(rec.severity)}`}>
            {rec.severity}
          </Badge>
          <Badge variant="secondary" className="text-[11px] font-medium">
            {typeLabel(rec.type)}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{rec.message}</p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-right text-xs sm:min-w-[220px]">
        <div>
          <p className="font-bold tabular-nums text-foreground">{rec.quantity}</p>
          <p className="text-muted-foreground">Current</p>
        </div>
        <div>
          <p className="font-bold tabular-nums text-foreground">{range}</p>
          <p className="text-muted-foreground">Range</p>
        </div>
        <div>
          <p className="font-bold tabular-nums text-primary">{qty}</p>
          <p className="text-muted-foreground">{rec.type === "warehouse_reorder" ? "Buy" : "Move"}</p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={rec.type !== "store_restock" || !canReviewRestock}
        title={
          rec.type !== "store_restock"
            ? "Review actions are currently available for store restock recommendations"
            : canReviewRestock
              ? "Review warehouse transfer details"
              : "Transfer permission is required to review restock actions"
        }
        onClick={() => onReviewRestock(rec)}
      >
        Review
      </Button>
    </div>
  );
}

export default function AgentInsightsPage() {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [page, setPage] = useState(1);
  const [selectedRestock, setSelectedRestock] = useState<AgentRecommendation | null>(null);
  const [transferQty, setTransferQty] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const canReviewRestock = hasPermission("transfer_inventory");

  const { data, isLoading, isFetching, refetch, error } = useQuery<HousekeepingResponse>({
    queryKey: ["agent-housekeeping"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/agents/housekeeping`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load agent recommendations");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const reviewQuery = useQuery<RestockReviewResponse>({
    queryKey: ["agent-restock-review", selectedRestock?.itemId],
    queryFn: async () => {
      if (!selectedRestock) throw new Error("No restock recommendation selected");
      const res = await fetch(`${BASE}/api/agents/restock-review/${selectedRestock.itemId}`, {
        credentials: "include",
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to load restock review");
      return payload;
    },
    enabled: Boolean(selectedRestock),
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      const review = reviewQuery.data;
      if (!review?.warehouseItem) throw new Error("No matching warehouse item is available");
      const unitsTransferred = Number.parseInt(transferQty, 10);
      if (!Number.isInteger(unitsTransferred) || unitsTransferred < 1) throw new Error("Enter a transfer quantity greater than zero");

      const res = await fetch(`${BASE}/api/warehouse/${review.warehouseItem.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeLocation: review.storeItem.location,
          storeItemId: review.storeItem.id,
          unitsTransferred,
          notes: `Agent Insights restock review for ${review.storeItem.name}`,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to create transfer");
      return payload as { newWarehouseQty: number };
    },
    onSuccess: (payload) => {
      toast({
        title: "Transfer posted",
        description: `Restock transfer saved. Warehouse quantity is now ${payload.newWarehouseQty}.`,
      });
      setSelectedRestock(null);
      setTransferQty("");
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["agent-housekeeping"] });
    },
    onError: (err) => {
      toast({
        title: "Transfer not posted",
        description: err instanceof Error ? err.message : "Review the recommendation and try again.",
        variant: "destructive",
      });
    },
  });

  const totalRecommendations = data?.recommendations.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecommendations / LIST_PAGE_SIZE));
  const pageStart = (page - 1) * LIST_PAGE_SIZE;
  const pageRecommendations = useMemo(
    () => (data?.recommendations ?? []).slice(pageStart, pageStart + LIST_PAGE_SIZE),
    [data?.recommendations, pageStart],
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!reviewQuery.data) return;
    setTransferQty(String(Math.max(1, reviewQuery.data.recommendation.recommendedTransferQty)));
  }, [reviewQuery.data]);

  const grouped = useMemo(() => {
    const map = new Map<RecommendationType, AgentRecommendation[]>();
    for (const rec of pageRecommendations) {
      if (!map.has(rec.type)) map.set(rec.type, []);
      map.get(rec.type)!.push(rec);
    }
    return Array.from(map.entries()).map(([type, recs]) => ({ type, recs }));
  }, [pageRecommendations]);

  const agentConnected = Boolean(data && !error);

  const sendMessage = async (event?: FormEvent, overrideMessage?: string) => {
    event?.preventDefault();
    const message = (overrideMessage ?? chatInput).trim();
    if (!message || chatLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
    };
    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatError("");
    setChatLoading(true);

    try {
      const res = await fetch(`${BASE}/api/agents/conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message,
          messages: nextMessages
            .filter((entry) => entry.id !== "welcome")
            .slice(-8)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const payload = (await res.json()) as ConversationResponse | { error?: string; answer?: string; source?: ConversationResponse["source"] };
      if (!res.ok && !payload.answer) {
        throw new Error(payload.error ?? "Agent conversation failed");
      }
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: payload.answer ?? "I could not generate an answer from the current agent context.",
          source: payload.source ?? "deterministic-fallback",
          generatedAt: payload.generatedAt,
          recommendationCount: payload.context?.recommendationCount,
        },
      ]);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Agent conversation failed";
      setChatError(messageText);
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: "I could not reach the conversation service. The recommendation cards below still show the current read-only checks.",
          source: "deterministic-fallback",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const clearConversation = () => {
    setChatMessages([WELCOME_MESSAGE]);
    setChatError("");
    setChatInput("");
  };

  const openRestockReview = (rec: AgentRecommendation) => {
    if (rec.type !== "store_restock") return;
    setSelectedRestock(rec);
    setTransferQty(String(Math.max(1, rec.recommendedTransferQty ?? 1)));
  };

  const closeRestockReview = (open: boolean) => {
    if (open) return;
    setSelectedRestock(null);
    setTransferQty("");
    transferMutation.reset();
  };

  const review = reviewQuery.data;
  const requestedQty = Math.max(0, Number.parseInt(transferQty, 10) || 0);
  const warehouseAvailable = review?.warehouseItem?.quantity ?? 0;
  const canSubmitTransfer =
    Boolean(review?.warehouseItem) &&
    requestedQty > 0 &&
    requestedQty <= warehouseAvailable &&
    !reviewQuery.isLoading &&
    !transferMutation.isPending;

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          title="Agent Insights"
          description="Read-only operational recommendations from the KeepTally middleware layer"
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
        />

        <Dialog open={Boolean(selectedRestock)} onOpenChange={closeRestockReview}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PackageCheck className="h-5 w-5 text-primary" />
                Review Store Restock
              </DialogTitle>
              <DialogDescription>
                Confirm the warehouse-to-store transfer before writing inventory changes.
              </DialogDescription>
            </DialogHeader>

            {reviewQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-28 w-full rounded-lg" />
              </div>
            ) : reviewQuery.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Could not load restock review.
                </div>
                <p className="mt-1">{reviewQuery.error instanceof Error ? reviewQuery.error.message : "Try refreshing Agent Insights."}</p>
              </div>
            ) : review ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Store</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{review.storeItem.location}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{review.storeItem.quantity}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target Range</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{review.storeItem.minQuantity}-{review.storeItem.maxQuantity}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">{review.storeItem.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{review.recommendation.reason}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        review.warehouseItem && review.warehouseItem.quantity > 0
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      }
                    >
                      {review.warehouseItem && review.warehouseItem.quantity > 0 ? "Warehouse match" : "Blocked"}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md bg-muted/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended Move</p>
                      <p className="mt-1 text-2xl font-black text-primary">{review.recommendation.recommendedTransferQty}</p>
                    </div>
                    <div className="rounded-md bg-muted/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Warehouse Available</p>
                      <p className="mt-1 text-2xl font-black text-foreground">{warehouseAvailable}</p>
                    </div>
                  </div>

                  {review.warehouseItem && (
                    <div className="mt-4 rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                      <p className="font-semibold text-foreground">{review.warehouseItem.name}</p>
                      <p className="mt-1">
                        {review.warehouseItem.category}
                        {review.warehouseItem.barcode ? ` · UPC ${review.warehouseItem.barcode}` : ""}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="agent-restock-transfer-qty" className="text-sm font-semibold text-foreground">
                    Transfer quantity
                  </label>
                  <Input
                    id="agent-restock-transfer-qty"
                    type="number"
                    min={1}
                    max={warehouseAvailable || undefined}
                    value={transferQty}
                    onChange={(event) => setTransferQty(event.target.value)}
                    disabled={!review.warehouseItem || transferMutation.isPending}
                  />
                  {requestedQty > warehouseAvailable && (
                    <p className="text-xs font-medium text-red-600">Transfer quantity cannot exceed warehouse availability.</p>
                  )}
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => closeRestockReview(false)} disabled={transferMutation.isPending}>
                Cancel
              </Button>
              <Button onClick={() => transferMutation.mutate()} disabled={!canSubmitTransfer}>
                {transferMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
                Post Transfer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent Mode</p>
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-2xl font-black capitalize text-foreground">{data?.mode.replace("_", " ") ?? "Read only"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Recommendations require human review.</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Below Minimum</p>
            <p className="mt-2 text-3xl font-black text-amber-500">{data?.summary.belowMinimumCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overstock</p>
            <p className="mt-2 text-3xl font-black text-sky-500">{data?.summary.overstockCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Warehouse Reorders</p>
            <p className="mt-2 text-3xl font-black text-red-500">{data?.summary.warehouseReorderCount ?? 0}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Housekeeping Agent</p>
                <p className="text-xs text-muted-foreground">
                  {data?.generatedAt ? `Last run ${new Date(data.generatedAt).toLocaleString()}` : "Waiting for first run"}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                agentConnected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }
            >
              {agentConnected ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
              {agentConnected ? "Connected" : "Waiting"}
            </Badge>
          </div>
        </div>

        <section className="grid gap-4 rounded-lg border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <MessageSquareText className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Live Insights Conversation</h2>
                  <p className="text-xs text-muted-foreground">
                    Ask operational questions against the latest read-only inventory snapshot.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    hasUsableConversation(data, error)
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }
                >
                  {hasUsableConversation(data, error) ? "Live" : "Snapshot pending"}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearConversation}
                  disabled={chatLoading || chatMessages.length <= 1}
                  title="Clear conversation"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="h-[22rem] space-y-3 overflow-auto rounded-md border border-border bg-muted/20 p-3">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[82%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                        : "max-w-[82%] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    }
                  >
                    <p className="whitespace-pre-line">{message.content}</p>
                    {message.role === "assistant" && message.source && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <span>{message.source === "ai" ? "AI assisted" : "Rule-based fallback"}</span>
                        {typeof message.recommendationCount === "number" && (
                          <span>{message.recommendationCount} recs in context</span>
                        )}
                        {message.generatedAt && (
                          <span>{new Date(message.generatedAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Thinking through the current snapshot...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {chatError && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {chatError}
              </div>
            )}

            <form onSubmit={sendMessage} className="flex gap-2">
              <Textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(undefined);
                  }
                }}
                placeholder="Ask: What should we restock first?"
                className="min-h-12 resize-none"
                disabled={chatLoading}
              />
              <Button type="submit" className="h-12 px-4" disabled={chatLoading || !chatInput.trim()}>
                {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="font-bold uppercase tracking-wide text-foreground">Ask Live</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-md border border-border bg-background p-2">
                <p className="text-base font-black text-foreground">{data?.summary.belowMinimumCount ?? 0}</p>
                <p>below min</p>
              </div>
              <div className="rounded-md border border-border bg-background p-2">
                <p className="text-base font-black text-foreground">{data?.summary.warehouseReorderCount ?? 0}</p>
                <p>reorders</p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessage(undefined, prompt)}
                  disabled={chatLoading}
                  className="block w-full rounded-md border border-border bg-background px-3 py-2 text-left font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-800">
              Conversation is read-only. It can summarize, prioritize, and explain recommendations, but it cannot write database changes.
            </p>
          </div>
        </section>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Could not load agent recommendations.
            </div>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : totalRecommendations === 0 ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
            <h2 className="text-lg font-bold text-foreground">No agent recommendations right now</h2>
            <p className="mt-1 text-sm text-muted-foreground">Inventory ranges look healthy based on the current middleware checks.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ type, recs }) => {
              const Icon = GROUPS[type].icon;
              return (
                <section key={type} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                  <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <h2 className="text-sm font-bold text-foreground">{GROUPS[type].title}</h2>
                    </div>
                    <Badge variant="secondary" className="text-xs font-semibold">{recs.length}</Badge>
                  </div>
                  <div>
                    {recs.map((rec) => (
                      <RecommendationRow
                        key={`${rec.type}-${rec.itemId}-${rec.location ?? "warehouse"}`}
                        rec={rec}
                        canReviewRestock={canReviewRestock}
                        onReviewRestock={openRestockReview}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {pageStart + 1}-{Math.min(pageStart + LIST_PAGE_SIZE, totalRecommendations)} of {totalRecommendations} recommendations
              </p>
              {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
                    Previous
                  </Button>
                  <span className="text-xs font-medium text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
