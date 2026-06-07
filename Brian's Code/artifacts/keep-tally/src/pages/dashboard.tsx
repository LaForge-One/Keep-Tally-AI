import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useSelectedLocation } from "@/contexts/location-context";
import { useAuth } from "@/contexts/auth-context";
import { useLocation as useWouterLocation } from "wouter";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  format,
  formatDistanceToNow,
  isToday,
  isYesterday,
} from "date-fns";
import {
  Bot,
  ClipboardList,
  Map,
  Mic,
  Package,
  Warehouse,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LIST_PAGE_SIZE = 50;
const DASHBOARD_PREVIEW_LIMIT = 5;

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

function statusDotColor(status: "out" | "critical" | "low") {
  if (status === "out") return "#ef4444";
  if (status === "critical") return "#f97316";
  return "#f59e0b";
}

export default function Dashboard() {
  const { hasPermission } = useAuth();
  const [, navigate] = useWouterLocation();
  const { selectedLocation } = useSelectedLocation();

  const { data, isLoading } = useQuery<VoiceData>({
    queryKey: ["voice-dashboard", selectedLocation],
    queryFn: async () => {
      const params = selectedLocation
        ? `?location=${encodeURIComponent(selectedLocation)}`
        : "";
      const res = await fetch(`${BASE}/api/dashboard/voice${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const canVoice = hasPermission("use_voice_mode");
  const canWarehouse = hasPermission("view_warehouse");
  const lastCount = data?.lastCountAt ?? null;
  const isWarning = lastCount
    ? Date.now() - new Date(lastCount).getTime() > 2 * 24 * 60 * 60 * 1000
    : true;

  const workCenters = [
    {
      label: "Tally",
      desc: "Speak counts, confirm updates, and see verified results in real time.",
      tags: ["Voice count", "Confirm"],
      icon: Mic,
      path: "/voice-check",
      enabled: canVoice,
    },
    {
      label: "Warehouse",
      desc: "Add products, receive purchases, and transfer stock into stores.",
      tags: ["Add item", "Transfer"],
      icon: Warehouse,
      path: "/warehouse",
      enabled: canWarehouse,
    },
    {
      label: "Routes",
      desc: "Build pick lists and route sheets from low-stock store inventory.",
      tags: ["Pick lists", "Sheets"],
      icon: Map,
      path: "/route-sheets",
      enabled: true,
    },
    {
      label: "AI Insights",
      desc: "Surface stock risk, cost watch points, and restock recommendations.",
      tags: ["Agents", "Reports"],
      icon: Bot,
      path: "/agents",
      enabled: true,
    },
  ];

  if (isLoading) {
    return (
      <Layout>
        <PageSkeleton rows={6} cols={4} />
      </Layout>
    );
  }

  return (
    <Layout>
      <style>{`
        @keyframes kt-pulse-ring {
          0% { transform: scale(1); opacity: .5; }
          100% { transform: scale(1.65); opacity: 0; }
        }
        @keyframes kt-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .kt-fade-up { animation: kt-fade-up .3s ease both; }
        .kt-fade-up-2 { animation: kt-fade-up .3s ease .07s both; }
        .kt-fade-up-3 { animation: kt-fade-up .3s ease .14s both; }
        .work-card:hover { border-color: #c7d9ee !important; }
        .queue-row:hover { background: #f8fafc; }
      `}</style>

      <div className="space-y-6 pb-8">
        <div className="kt-fade-up flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 900,
                letterSpacing: "-.01em",
                color: "#0f2748",
                margin: 0,
              }}
            >
              Voice Inventory
            </h1>
            <p style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>
              {format(new Date(), "EEEE, MMMM d")}
              {selectedLocation && ` · ${selectedLocation}`}
            </p>
          </div>
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            style={{
              border: `1px solid ${isWarning ? "#fed7aa" : "#bbf7d0"}`,
              borderRadius: 12,
              background: isWarning ? "#fff7ed" : "#f0fdf4",
              color: isWarning ? "#92400e" : "#166534",
            }}
          >
            <span>{isWarning ? "WARN" : "OK"}</span>
            <span>{lastCountLabel(lastCount)}</span>
          </div>
        </div>

        <section
          className="kt-fade-up flex flex-col items-center gap-6 rounded-2xl md:flex-row md:justify-between"
          style={{
            background: "linear-gradient(135deg, #1f3e6d, #446fa7)",
            boxShadow: "0 16px 48px rgba(68,111,167,.18)",
            padding: "28px 32px",
          }}
          aria-label="Start inventory session"
        >
          <div>
            <p
              style={{
                color: "#b9d7f6",
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Voice-first operations
            </p>
            <h2
              style={{
                color: "#fff",
                fontSize: 30,
                fontWeight: 900,
                marginBottom: 8,
              }}
            >
              Start Inventory Session
            </h2>
            <p
              style={{
                color: "#d8e8f8",
                fontSize: 14,
                lineHeight: 1.55,
                maxWidth: 460,
              }}
            >
              Speak counts, detect shrinkage instantly, and see the financial
              impact in real time.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <button
                onClick={() => canVoice && navigate("/voice-check")}
                disabled={!canVoice}
                className="flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  height: 40,
                  border: "none",
                  borderRadius: 8,
                  background: "#fff",
                  color: "#1f3e6d",
                  fontWeight: 900,
                  padding: "0 16px",
                  cursor: canVoice ? "pointer" : "not-allowed",
                  fontSize: 14,
                  transition: "opacity 150ms ease",
                }}
              >
                <Mic className="h-4 w-4" />
                Start Tally
              </button>
              {canWarehouse && (
                <button
                  onClick={() => navigate("/warehouse/voice")}
                  className="flex items-center gap-2"
                  style={{
                    height: 40,
                    border: "1px solid rgba(255,255,255,.28)",
                    borderRadius: 8,
                    background: "rgba(255,255,255,.12)",
                    color: "#fff",
                    fontWeight: 900,
                    padding: "0 16px",
                    cursor: "pointer",
                    fontSize: 14,
                    transition: "background 150ms ease",
                  }}
                >
                  <Package className="h-4 w-4" />
                  Add Warehouse Item
                </button>
              )}
            </div>
          </div>

          <div
            className="relative grid shrink-0 place-items-center"
            style={{
              width: 88,
              height: 88,
              borderRadius: 999,
              background: "linear-gradient(135deg, #5ea4dc, #9bc7ec)",
              boxShadow: "0 10px 26px rgba(18,62,110,.28)",
            }}
            aria-hidden="true"
          >
            <div
              style={{
                position: "absolute",
                inset: -10,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,.35)",
                animation: "kt-pulse-ring 2s ease-out infinite",
              }}
            />
            <Mic style={{ width: 34, height: 34, color: "#fff" }} />
          </div>
        </section>

        <div className="kt-fade-up-2 grid grid-cols-2 gap-3.5 md:grid-cols-4">
          {[
            {
              label: "Missing Value",
              value: data ? `$${data.missingValue.toFixed(2)}` : "$-",
              note: "across items below par",
              variant: "danger",
            },
            {
              label: "Below Par",
              value: data?.belowParCount ?? "-",
              note: "items need restocking",
              variant: "warning",
            },
            {
              label: "Out of Stock",
              value: data?.outOfStockCount ?? "-",
              note: "items completely empty",
              variant: "danger",
            },
            {
              label: "Last Session",
              value: lastCount
                ? isToday(new Date(lastCount))
                  ? "Today"
                  : formatDistanceToNow(new Date(lastCount), {
                      addSuffix: true,
                    })
                : "None",
              note: "most recent voice count",
              variant: "neutral",
            },
          ].map(({ label, value, note, variant }) => (
            <div
              key={label}
              style={{
                border: `1px solid ${
                  variant === "danger"
                    ? "#fecaca"
                    : variant === "warning"
                      ? "#fed7aa"
                      : "#e8eef5"
                }`,
                borderRadius: 16,
                background:
                  variant === "danger"
                    ? "linear-gradient(135deg,#fef2f2,#fff)"
                    : variant === "warning"
                      ? "linear-gradient(135deg,#fff7ed,#fff)"
                      : "#fff",
                padding: 18,
                boxShadow:
                  "0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.08)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color:
                    variant === "danger"
                      ? "#ef4444"
                      : variant === "warning"
                        ? "#f97316"
                        : "#64748b",
                  marginBottom: 8,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 900,
                  color:
                    variant === "danger"
                      ? "#dc2626"
                      : variant === "warning"
                        ? "#ea580c"
                        : "#0f2748",
                }}
              >
                {String(value)}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 3 }}>
                {note}
              </div>
            </div>
          ))}
        </div>

        <div className="kt-fade-up-3 grid gap-5 md:grid-cols-[1fr_360px]">
          <div
            style={{
              overflow: "hidden",
              border: "1px solid #e8eef5",
              borderRadius: 16,
              background: "#fff",
              boxShadow:
                "0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.08)",
            }}
          >
            <div
              className="flex items-center justify-between gap-3 px-4 py-3.5"
              style={{ borderBottom: "1px solid #f1f5f9" }}
            >
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 900,
                  color: "#0f2748",
                  margin: 0,
                }}
              >
                Work Centers
              </h3>
              <button
                onClick={() => navigate("/inventory")}
                style={{
                  color: "#446fa7",
                  fontSize: 12,
                  fontWeight: 900,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Open module map
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              {workCenters
                .filter((center) => center.enabled)
                .map(({ label, desc, tags, icon: Icon, path }) => (
                  <article
                    key={label}
                    className="work-card"
                    onClick={() => navigate(path)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 1fr",
                      gap: 12,
                      minHeight: 114,
                      border: "1px solid #e7edf5",
                      borderRadius: 12,
                      background: "#fbfdff",
                      padding: 14,
                      cursor: "pointer",
                      transition: "border-color 150ms ease",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: "#eaf2fb",
                        color: "#446fa7",
                        flexShrink: 0,
                      }}
                    >
                      <Icon style={{ width: 19, height: 19 }} aria-hidden="true" />
                    </div>
                    <div>
                      <h4
                        style={{
                          fontSize: 14,
                          fontWeight: 900,
                          color: "#102846",
                          margin: 0,
                        }}
                      >
                        {label}
                      </h4>
                      <p
                        style={{
                          fontSize: 12,
                          color: "#64748b",
                          lineHeight: 1.45,
                          marginTop: 4,
                        }}
                      >
                        {desc}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            style={{
                              borderRadius: 999,
                              background: "#eef4fa",
                              color: "#466681",
                              padding: "4px 7px",
                              fontSize: 10,
                              fontWeight: 900,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div
              style={{
                overflow: "hidden",
                border: "1px solid #e8eef5",
                borderRadius: 16,
                background: "#fff",
                boxShadow:
                  "0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.08)",
              }}
            >
              <div
                className="flex items-center justify-between gap-3 px-4 py-3.5"
                style={{ borderBottom: "1px solid #f1f5f9" }}
              >
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 900,
                    color: "#0f2748",
                    margin: 0,
                  }}
                >
                  Priority Queue
                </h3>
                <button
                  onClick={() => navigate("/inventory")}
                  style={{
                    color: "#446fa7",
                    fontSize: 12,
                    fontWeight: 900,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  View all
                </button>
              </div>

              {!data || data.belowParItems.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center py-8"
                  style={{ color: "#94a3b8" }}
                >
                  <span style={{ fontSize: 24, marginBottom: 6 }}>OK</span>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#475569",
                    }}
                  >
                    All items at par
                  </p>
                  <p style={{ fontSize: 12, marginTop: 2 }}>
                    No restocking needed
                  </p>
                </div>
              ) : (
                <div>
                  {data.belowParItems
                    .slice(0, Math.min(DASHBOARD_PREVIEW_LIMIT, LIST_PAGE_SIZE))
                    .map((item) => (
                      <div
                        key={item.id}
                        className="queue-row flex cursor-pointer items-center gap-3 px-4 py-3"
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          transition: "background 150ms ease",
                        }}
                        onClick={() => navigate("/inventory")}
                      >
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: statusDotColor(item.status),
                            flexShrink: 0,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            style={{
                              fontSize: 13,
                              fontWeight: 900,
                              color: "#142b4d",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              margin: 0,
                            }}
                          >
                            {item.name}
                          </p>
                          <p
                            style={{
                              fontSize: 12,
                              color: "#94a3b8",
                              marginTop: 2,
                            }}
                          >
                            qty {item.quantity} · par {item.parLevel}
                            {item.location ? ` · ${item.location}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            style={{
                              fontSize: 13,
                              fontWeight: 900,
                              color: statusDotColor(item.status),
                              margin: 0,
                            }}
                          >
                            {item.missingValue > 0
                              ? `$${item.missingValue.toFixed(2)}`
                              : `-${item.missing}`}
                          </p>
                          <p style={{ fontSize: 10, color: "#94a3b8" }}>
                            {item.missingValue > 0 ? "missing" : "units short"}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div
              style={{
                overflow: "hidden",
                border: "1px solid #e8eef5",
                borderRadius: 16,
                background: "#fff",
                boxShadow:
                  "0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.08)",
              }}
            >
              <div
                className="flex items-center justify-between gap-3 px-4 py-3.5"
                style={{ borderBottom: "1px solid #f1f5f9" }}
              >
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 900,
                    color: "#0f2748",
                    margin: 0,
                  }}
                >
                  Recent Sessions
                </h3>
                <button
                  onClick={() => navigate("/history")}
                  style={{
                    color: "#446fa7",
                    fontSize: 12,
                    fontWeight: 900,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  View all
                </button>
              </div>

              {!data || data.recentSessions.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center py-8"
                  style={{ color: "#94a3b8" }}
                >
                  <Mic style={{ width: 28, height: 28, marginBottom: 8 }} />
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#475569",
                    }}
                  >
                    No sessions yet
                  </p>
                  <p style={{ fontSize: 12, marginTop: 2 }}>
                    Start a voice count to see history
                  </p>
                </div>
              ) : (
                <div>
                  {data.recentSessions
                    .slice(0, Math.min(3, LIST_PAGE_SIZE))
                    .map((session, i) => (
                      <div
                        key={`${session.date}-${i}`}
                        className="flex items-center gap-3 px-4 py-3.5"
                        style={{ borderBottom: "1px solid #f1f5f9" }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            flexShrink: 0,
                            display: "grid",
                            placeItems: "center",
                            fontSize: 12,
                            fontWeight: 900,
                            color: i === 0 ? "#92400e" : "#166534",
                            background: i === 0 ? "#fff7ed" : "#f0fdf4",
                            border:
                              i === 0
                                ? "1px solid #fed7aa"
                                : "1px solid #bbf7d0",
                          }}
                        >
                          {i === 0 ? "WARN" : "OK"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: "#162f57",
                              margin: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {session.location || session.performedBy}
                          </p>
                          <p
                            style={{
                              fontSize: 12,
                              color: "#94a3b8",
                              marginTop: 2,
                            }}
                          >
                            {sessionLabel(session.date)} · {session.itemCount}{" "}
                            actions
                          </p>
                        </div>
                        {session.missingValue > 0 && (
                          <div className="shrink-0 text-right">
                            <p
                              style={{
                                fontSize: 13,
                                fontWeight: 900,
                                color: "#ef4444",
                                margin: 0,
                              }}
                            >
                              ${session.missingValue.toFixed(2)}
                            </p>
                            <p style={{ fontSize: 10, color: "#94a3b8" }}>
                              missing val
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}

              <div
                style={{
                  padding: "12px 16px",
                  borderTop: "1px solid #f1f5f9",
                  background: "#f8fafc",
                }}
              >
                <button
                  onClick={() => canVoice && navigate("/voice-check")}
                  disabled={!canVoice}
                  className="flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    height: 38,
                    borderRadius: 10,
                    border: "1px solid #c7d9ee",
                    background: "#fff",
                    color: "#446fa7",
                    fontWeight: 900,
                    fontSize: 13,
                    cursor: canVoice ? "pointer" : "not-allowed",
                    transition: "background 150ms ease,border-color 150ms ease",
                  }}
                >
                  <Mic style={{ width: 15, height: 15 }} aria-hidden="true" />
                  Start New Session
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
