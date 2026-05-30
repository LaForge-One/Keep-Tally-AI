import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { NoPermissionPage } from "@/components/permission-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ShoppingCart,
  Download,
  TrendingDown,
  BarChart3,
  DollarSign,
  Package,
  Search,
  X,
  ChevronRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Purchase = {
  id: number;
  warehouseItemId: number;
  itemName: string | null;
  category: string | null;
  vendor: string;
  caseCost: number;
  casesReceived: number;
  unitsPerCase: number;
  totalUnits: number;
  costPerUnit: number;
  purchaseDate: string;
  notes: string | null;
  createdAt: string;
};

type VendorSummary = {
  vendor: string;
  totalUnits: number;
  totalSpend: number;
  latestCost: number | null;
  avgCost: number | null;
  lowestCost: number | null;
  orderCount: number;
};

type Analytics = {
  latestCost: number | null;
  avgCost: number | null;
  lowestCost: number | null;
  totalSpend: number;
  totalUnits: number;
};

type PurchaseData = {
  purchases: Purchase[];
  analytics: Analytics;
  vendorSummary: VendorSummary[];
  vendors: string[];
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function WarehousePurchasesPage() {
  const { hasPermission } = useAuth();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeTab, setActiveTab] = useState<"list" | "vendors">("list");

  const params = new URLSearchParams();
  if (vendorFilter) params.set("vendor", vendorFilter);
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);

  const { data, isLoading } = useQuery<PurchaseData>({
    queryKey: ["warehouse-purchases", vendorFilter, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/warehouse/purchases?${params}`);
      return res.json();
    },
  });

  if (!hasPermission("view_costs")) {
    return (
      <Layout>
        <NoPermissionPage message="You do not have permission to view purchase costs." />
      </Layout>
    );
  }

  const purchases = data?.purchases ?? [];
  const analytics = data?.analytics;
  const vendorSummary = data?.vendorSummary ?? [];
  const vendors = data?.vendors ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return purchases;
    const s = search.toLowerCase();
    return purchases.filter(
      (p) =>
        (p.itemName ?? "").toLowerCase().includes(s) ||
        p.vendor.toLowerCase().includes(s) ||
        (p.category ?? "").toLowerCase().includes(s) ||
        (p.notes ?? "").toLowerCase().includes(s)
    );
  }, [purchases, search]);

  const hasFilters = vendorFilter || dateFrom || dateTo || search;
  const exportHref = `${BASE}/api/warehouse/purchases/export`;

  const lowestVendor = vendorSummary.length
    ? vendorSummary.reduce((best, v) =>
        (v.lowestCost ?? Infinity) < (best.lowestCost ?? Infinity) ? v : best
      )
    : null;

  return (
    <Layout>
      <div className="space-y-5 pb-10">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/warehouse")}
            className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
              <ShoppingCart className="w-7 h-7 text-primary" />
              Purchase History
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">All warehouse receiving records</p>
          </div>
          <a href={exportHref} download>
            <Button variant="outline" size="sm" className="rounded-xl">
              <Download className="w-4 h-4 mr-1.5" />
              Export CSV
            </Button>
          </a>
        </div>

        {/* Analytics summary */}
        {analytics && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-2xl p-4 text-center">
              <p className="text-2xl font-black tabular-nums">{fmt(analytics.latestCost)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Latest Cost/Unit</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-4 text-center">
              <p className="text-2xl font-black tabular-nums">{fmt(analytics.avgCost)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Avg Cost/Unit</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-black tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(analytics.lowestCost)}</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">Lowest Cost/Unit</p>
              {lowestVendor && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-500 font-semibold mt-0.5 truncate">{lowestVendor.vendor}</p>
              )}
            </div>
            <div className="bg-card border border-border rounded-2xl p-4 text-center">
              <p className="text-2xl font-black tabular-nums">{fmt(analytics.totalSpend)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total Spend</p>
              <p className="text-[10px] text-muted-foreground">{analytics.totalUnits.toLocaleString()} units received</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search item, vendor, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 rounded-xl"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            {/* Vendor pills */}
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setVendorFilter("")}
                className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${!vendorFilter ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:border-primary/40"}`}
              >
                All Vendors
              </button>
              {vendors.map((v) => (
                <button
                  key={v}
                  onClick={() => setVendorFilter(vendorFilter === v ? "" : v)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${vendorFilter === v ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:border-primary/40"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-xl text-sm flex-1"
              placeholder="From"
            />
            <span className="text-muted-foreground text-sm shrink-0">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 rounded-xl text-sm flex-1"
              placeholder="To"
            />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {hasFilters && (
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {purchases.length} records
              {vendorFilter && ` · ${vendorFilter}`}
              {(dateFrom || dateTo) && ` · ${dateFrom || "…"} → ${dateTo || "…"}`}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(["list", "vendors"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "list" && <><Package className="w-3.5 h-3.5 inline mr-1.5" />All Purchases</>}
              {tab === "vendors" && <><BarChart3 className="w-3.5 h-3.5 inline mr-1.5" />By Vendor</>}
            </button>
          ))}
        </div>

        {/* ── ALL PURCHASES LIST ── */}
        {activeTab === "list" && (
          <>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-20 bg-muted/40 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-semibold text-muted-foreground">No purchase records</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {hasFilters ? "Try adjusting your filters." : "Receive inventory from a warehouse item to get started."}
                </p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
                {filtered.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => navigate(`/warehouse/${p.warehouseItemId}`)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    {/* Left: item + date */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">{p.itemName ?? "Unknown item"}</p>
                        <span className="text-xs text-muted-foreground shrink-0 font-medium">{p.vendor}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-xs text-muted-foreground">{fmtDate(p.purchaseDate)}</p>
                        {p.category && (
                          <span className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground font-medium">{p.category}</span>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {p.casesReceived} case{p.casesReceived !== 1 ? "s" : ""} × {p.unitsPerCase}/case
                        </p>
                      </div>
                      {p.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{p.notes}</p>}
                    </div>

                    {/* Right: qty + cost */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-emerald-700">+{p.totalUnits} units</p>
                      <p className="text-xs text-muted-foreground">{fmt(p.caseCost)}/case</p>
                      <p className="text-xs font-semibold text-muted-foreground">{fmt(p.costPerUnit)}/unit</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── VENDOR BREAKDOWN ── */}
        {activeTab === "vendors" && (
          <>
            {vendorSummary.length === 0 ? (
              <div className="text-center py-16">
                <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-semibold text-muted-foreground">No vendor data yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {vendorSummary.map((v, idx) => {
                  const isLowest = v.vendor === lowestVendor?.vendor;
                  return (
                    <div key={v.vendor} className={`bg-card border rounded-2xl p-4 ${isLowest ? "border-emerald-300 dark:border-emerald-700" : "border-border"}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {idx === 0 && <span className="text-xs bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">Top Vendor</span>}
                          {isLowest && <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-full">Lowest Cost</span>}
                          <h3 className="font-bold text-base">{v.vendor}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground">{v.orderCount} order{v.orderCount !== 1 ? "s" : ""}</p>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center bg-muted/30 rounded-xl py-2 px-1">
                          <p className="text-base font-black tabular-nums">{fmt(v.latestCost)}</p>
                          <p className="text-[10px] text-muted-foreground">Latest/unit</p>
                        </div>
                        <div className="text-center bg-muted/30 rounded-xl py-2 px-1">
                          <p className="text-base font-black tabular-nums">{fmt(v.avgCost)}</p>
                          <p className="text-[10px] text-muted-foreground">Avg/unit</p>
                        </div>
                        <div className={`text-center rounded-xl py-2 px-1 ${isLowest ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-muted/30"}`}>
                          <p className={`text-base font-black tabular-nums ${isLowest ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{fmt(v.lowestCost)}</p>
                          <p className={`text-[10px] ${isLowest ? "text-emerald-600 dark:text-emerald-500" : "text-muted-foreground"}`}>Lowest/unit</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
                        <span>{v.totalUnits.toLocaleString()} total units received</span>
                        <span className="font-semibold">{fmt(v.totalSpend)} total spent</span>
                      </div>
                    </div>
                  );
                })}

                {/* Cost comparison chart */}
                {vendorSummary.length > 1 && vendorSummary.every((v) => v.avgCost != null) && (
                  <div className="bg-card border border-border rounded-2xl p-4">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                      <TrendingDown className="w-4 h-4 text-emerald-600" />
                      Avg Cost/Unit Comparison
                    </h3>
                    <div className="space-y-2">
                      {(() => {
                        const maxAvg = Math.max(...vendorSummary.map((v) => v.avgCost ?? 0));
                        return vendorSummary
                          .slice()
                          .sort((a, b) => (a.avgCost ?? 0) - (b.avgCost ?? 0))
                          .map((v) => {
                            const pct = maxAvg > 0 ? ((v.avgCost ?? 0) / maxAvg) * 100 : 0;
                            const isMin = v.vendor === lowestVendor?.vendor;
                            return (
                              <div key={v.vendor} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium">{v.vendor}</span>
                                  <span className={`font-bold tabular-nums ${isMin ? "text-emerald-700" : ""}`}>{fmt(v.avgCost)}</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${isMin ? "bg-emerald-500" : "bg-primary/60"}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
