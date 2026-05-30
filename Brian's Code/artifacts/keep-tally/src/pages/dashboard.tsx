import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useSelectedLocation } from "@/contexts/location-context";
import { useAuth } from "@/contexts/auth-context";
import { useLocation as useWouterLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { Mic } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VoiceData = {
  missingValue: number;
  belowParCount: number;
  outOfStockCount: number;
  belowParItems: Array<{
    id: number;
    name: string;
    category: string;
    location: string;
    quantity: number;
    parLevel: number;
    missing: number;
    missingValue: number;
    status: "out" | "critical" | "low";
  }>;
  recentSessions: Array<{
    date: string;
    performedBy: string;
    location: string;
    itemCount: number;
    missingValue: number;
  }>;
  lastCountAt: string | null;
};

function sessionLabel(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return `Today, ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

function lastCountLabel(dateStr: string | null) {
  if (!dateStr) return "No voice counts yet";
  const d = new Date(dateStr);
  if (isToday(d)) return "Last count: today";
  return `Last count: ${formatDistanceToNow(d, { addSuffix: true })}`;
}

function statusDot(status: "out" | "critical" | "low") {
  if (status === "out") return "bg-red-500";
  if (status === "critical") return "bg-orange-500";
  return "bg-amber-400";
}

function sessionIcon(idx: number) {
  if (idx === 0) return { bg: "bg-amber-50 border-amber-200", icon: "⚠" };
  if (idx === 1) return { bg: "bg-emerald-50 border-emerald-200", icon: "✓" };
  return { bg: "bg-red-50 border-red-200", icon: "●" };
}

export default function Dashboard() {
  const { hasPermission } = useAuth();
  const [, navigate] = useWouterLocation();
  const { selectedLocation } = useSelectedLocation();

  const { data, isLoading } = useQuery<VoiceData>({
    queryKey: ["voice-dashboard", selectedLocation],
    queryFn: async () => {
      const params = selectedLocation ? `?location=${encodeURIComponent(selectedLocation)}` : "";
      const res = await fetch(`${BASE}/api/dashboard/voice${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const canVoice = hasPermission("use_voice_mode");

  const lastCount = data?.lastCountAt ?? null;
  const isWarning = lastCount
    ? Date.now() - new Date(lastCount).getTime() > 2 * 24 * 60 * 60 * 1000
    : true;

  return (
    <Layout>
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.35s ease forwards; }
        .fade-up-2 { animation: fadeUp 0.35s ease 0.07s forwards; opacity: 0; }
        .fade-up-3 { animation: fadeUp 0.35s ease 0.14s forwards; opacity: 0; }
      `}</style>

      <div className="space-y-6 pb-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap fade-up">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Voice Inventory</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {format(new Date(), "EEEE, MMMM d")}
              {selectedLocation && ` · ${selectedLocation}`}
            </p>
          </div>
          {!isLoading && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                isWarning
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              }`}
            >
              <span>{isWarning ? "⚠" : "✓"}</span>
              <span>{lastCountLabel(lastCount)}</span>
            </div>
          )}
        </div>

        {/* START SESSION — Hero CTA */}
        <div
          className="rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center md:justify-between gap-6 fade-up"
          style={{
            background: "linear-gradient(135deg, #1e1b4b, #312e81)",
            boxShadow: "0 16px 48px rgba(99,102,241,0.2)",
          }}
        >
          <div className="text-center md:text-left">
            <p className="text-indigo-300 text-[11px] font-bold tracking-widest mb-2">VOICE-FIRST COUNTING</p>
            <h2 className="text-2xl md:text-3xl font-black text-white mb-2">Start Inventory Session</h2>
            <p className="text-indigo-200 text-sm max-w-sm leading-relaxed">
              Speak your counts, detect shrinkage instantly, and see the financial impact in real time.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 shrink-0">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(99,102,241,0.5)", animation: "pulse-ring 2s ease-out infinite" }}
              />
              <button
                onClick={() => navigate("/voice-check")}
                className="relative w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-transform active:scale-95 hover:scale-105"
                style={{
                  background: "linear-gradient(135deg, #6366f1, #818cf8)",
                  boxShadow: "0 8px 24px rgba(99,102,241,0.5)",
                }}
              >
                <Mic className="w-7 h-7 md:w-8 md:h-8 text-white" />
              </button>
            </div>
            <p className="text-indigo-300 text-xs font-semibold">Tap to count</p>
          </div>
        </div>

        {/* 3 metric cards */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 fade-up-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 fade-up-2">
            {/* Missing Value */}
            <div
              className="rounded-2xl p-5 border"
              style={{
                background: "linear-gradient(135deg, #fef2f2, #fff)",
                borderColor: "#fecaca",
                boxShadow: "0 2px 12px rgba(239,68,68,0.06)",
              }}
            >
              <p className="text-xs font-bold text-red-400 mb-1 tracking-wide">MISSING VALUE</p>
              <p className="text-3xl font-black text-red-500">
                {data ? `$${data.missingValue.toFixed(2)}` : "$—"}
              </p>
              <p className="text-xs text-slate-400 mt-1">across all items below par</p>
            </div>

            {/* Below Par */}
            <div
              className="rounded-2xl p-5 border"
              style={{
                background: "linear-gradient(135deg, #fff7ed, #fff)",
                borderColor: "#fed7aa",
                boxShadow: "0 2px 12px rgba(249,115,22,0.06)",
              }}
            >
              <p className="text-xs font-bold text-orange-400 mb-1 tracking-wide">BELOW PAR</p>
              <p className="text-3xl font-black text-orange-500">{data?.belowParCount ?? "—"}</p>
              <p className="text-xs text-slate-400 mt-1">items need restocking</p>
            </div>

            {/* Out of Stock */}
            <div
              className="rounded-2xl p-5 border"
              style={{
                background: "linear-gradient(135deg, #fef2f2, #fff)",
                borderColor: "#fecaca",
                boxShadow: "0 2px 12px rgba(239,68,68,0.06)",
              }}
            >
              <p className="text-xs font-bold text-red-400 mb-1 tracking-wide">OUT OF STOCK</p>
              <p className="text-3xl font-black text-red-600">{data?.outOfStockCount ?? "—"}</p>
              <p className="text-xs text-slate-400 mt-1">items completely empty</p>
            </div>
          </div>
        )}

        {/* Two-column lower section */}
        <div className="grid md:grid-cols-2 gap-6 fade-up-3">

          {/* Items Needing Attention */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">Items Needing Attention</h3>
              <button
                onClick={() => navigate("/inventory")}
                className="text-xs text-indigo-500 font-semibold hover:underline"
              >
                View all
              </button>
            </div>
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
              </div>
            ) : !data || data.belowParItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <span className="text-3xl mb-2">✓</span>
                <p className="text-sm font-semibold text-slate-600">All items at par</p>
                <p className="text-xs text-slate-400 mt-1">No restocking needed right now</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {data.belowParItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center px-5 py-3 gap-3 hover:bg-slate-50/60 cursor-pointer transition-colors"
                    onClick={() => navigate("/inventory")}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot(item.status)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400">
                        qty {item.quantity} · par {item.parLevel}
                        {item.location && ` · ${item.location}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="text-sm font-bold"
                        style={{
                          color: item.status === "out" ? "#ef4444" : item.status === "critical" ? "#f97316" : "#f59e0b",
                        }}
                      >
                        {item.missingValue > 0 ? `$${item.missingValue.toFixed(2)}` : `−${item.missing}`}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {item.missingValue > 0 ? "missing" : "units short"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Sessions */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">Recent Sessions</h3>
              <button
                onClick={() => navigate("/history")}
                className="text-xs text-indigo-500 font-semibold hover:underline"
              >
                View all
              </button>
            </div>
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            ) : !data || data.recentSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Mic className="w-8 h-8 mb-2 text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">No sessions yet</p>
                <p className="text-xs text-slate-400 mt-1">Start a voice count to see history</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 flex-1">
                {data.recentSessions.map((session, i) => {
                  const { bg, icon } = sessionIcon(i);
                  return (
                    <div
                      key={i}
                      className="flex items-center px-5 py-4 gap-3 hover:bg-slate-50/60 transition-colors"
                    >
                      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center text-sm shrink-0 ${bg}`}>
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {session.location || session.performedBy}
                        </p>
                        <p className="text-xs text-slate-400">
                          {sessionLabel(session.date)} · {session.itemCount} actions
                        </p>
                      </div>
                      {session.missingValue > 0 && (
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-red-500">${session.missingValue.toFixed(2)}</p>
                          <p className="text-[10px] text-slate-400">missing val</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="px-5 py-4 border-t border-slate-50 bg-slate-50/50">
              <button
                onClick={() => navigate("/voice-check")}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
              >
                <Mic className="w-4 h-4" />
                Start New Session
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
