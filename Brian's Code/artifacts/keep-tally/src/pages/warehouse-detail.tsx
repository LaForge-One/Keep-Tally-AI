import { useState } from "react";
import { useRoute, useLocation as useWouterLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSelectedLocation } from "@/contexts/location-context";
import {
  ArrowLeft,
  Package,
  Edit,
  Truck,
  ArrowRightLeft,
  Plus,
  Minus,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Calendar,
  BarChart3,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VENDORS = ["Costco", "Sam's Club", "Vistar", "Walmart", "Pepsi Corp", "Other"];

const LIST_PAGE_SIZE = 50;

type WarehouseItem = {
  id: number;
  name: string;
  barcode: string | null;
  category: string;
  quantity: number;
  minPar: number;
  maxPar: number;
  reorderPoint: number;
  caseCost: number | null;
  unitsPerCase: number;
  costPerUnit: number | null;
  lastPurchaseDate: string | null;
  status: string;
};

type Purchase = {
  id: number;
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

type Transfer = {
  id: number;
  storeLocation: string;
  unitsTransferred: number;
  notes: string | null;
  createdAt: string;
};

type VendorPricing = {
  vendor: string;
  latestCost: number;
  lowestCost: number;
  avgCost: number;
  totalUnits: number;
};

type DetailData = {
  item: WarehouseItem;
  purchases: Purchase[];
  transfers: Transfer[];
  pagination?: {
    purchases: { page: number; pageSize: number; total: number };
    transfers: { page: number; pageSize: number; total: number };
  };
  vendorPricing: VendorPricing[];
  pricing: { latest: number | null; avg: number | null; lowest: number | null };
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusColor(status: string) {
  switch (status) {
    case "out": return "text-red-600 bg-red-50 border-red-200";
    case "low": return "text-orange-600 bg-orange-50 border-orange-200";
    case "reorder": return "text-yellow-700 bg-yellow-50 border-yellow-200";
    case "overstock": return "text-blue-600 bg-blue-50 border-blue-200";
    default: return "text-emerald-700 bg-emerald-50 border-emerald-200";
  }
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { out: "Out of Stock", low: "Low Stock", reorder: "Reorder Soon", overstock: "Overstock", ok: "In Stock" };
  return labels[status] ?? status;
}

function listPageCount(total: number) {
  return Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
}

function listPageItems<T>(items: T[], page: number) {
  const safePage = Math.min(page, listPageCount(items.length));
  const start = (safePage - 1) * LIST_PAGE_SIZE;
  return items.slice(start, start + LIST_PAGE_SIZE);
}

function ListPager({
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
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3"
          disabled={safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3"
          disabled={safePage >= pages}
          onClick={() => onPageChange(Math.min(pages, safePage + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* ── Receive Form ── */
function ReceiveForm({ itemId, onReceived }: { itemId: number; onReceived: () => void }) {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0]!;
  const [form, setForm] = useState({
    vendor: "Vistar",
    caseCost: "",
    casesReceived: "1",
    unitsPerCase: "1",
    purchaseDate: today,
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const totalUnits = (parseInt(form.casesReceived) || 0) * (parseInt(form.unitsPerCase) || 0);
  const costPerUnit = parseFloat(form.caseCost) / (parseInt(form.unitsPerCase) || 1);

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.caseCost || !form.vendor) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/warehouse/${itemId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor: form.vendor,
          caseCost: parseFloat(form.caseCost),
          casesReceived: parseInt(form.casesReceived) || 1,
          unitsPerCase: parseInt(form.unitsPerCase) || 1,
          purchaseDate: form.purchaseDate,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json();
      toast({ title: `Received ${result.unitsAdded} units`, description: `New qty: ${result.newQty}` });
      onReceived();
    } catch {
      toast({ title: "Error receiving inventory", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <h3 className="font-bold text-base flex items-center gap-2"><Truck className="w-5 h-5 text-primary" />Receive Inventory</h3>

      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">Vendor</label>
        <div className="grid grid-cols-3 gap-1.5">
          {VENDORS.map((v) => (
            <button key={v} onClick={() => set("vendor", v)}
              className={`text-xs rounded-xl px-2 py-2 font-medium border transition-colors text-center ${form.vendor === v ? "border-primary bg-primary/5 text-primary font-bold" : "border-border bg-background hover:border-primary/40"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Case Cost ($)</label>
          <Input type="number" min={0} step={0.01} value={form.caseCost} onChange={(e) => set("caseCost", e.target.value)} placeholder="0.00" className="h-10 rounded-xl" />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Cases Received</label>
          <div className="flex items-center gap-1">
            <button onClick={() => set("casesReceived", String(Math.max(1, (parseInt(form.casesReceived) || 1) - 1)))} className="w-9 h-10 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80"><Minus className="w-3.5 h-3.5" /></button>
            <Input type="number" min={1} value={form.casesReceived} onChange={(e) => set("casesReceived", e.target.value)} className="h-10 rounded-xl text-center font-bold flex-1" />
            <button onClick={() => set("casesReceived", String((parseInt(form.casesReceived) || 1) + 1))} className="w-9 h-10 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Units Per Case</label>
          <Input type="number" min={1} value={form.unitsPerCase} onChange={(e) => set("unitsPerCase", e.target.value)} className="h-10 rounded-xl text-center font-bold" />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Purchase Date</label>
          <Input type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className="h-10 rounded-xl" />
        </div>
      </div>

      {/* Summary */}
      {form.caseCost && totalUnits > 0 && (
        <div className="bg-muted/30 rounded-xl px-3 py-2 flex justify-between text-sm">
          <span className="text-muted-foreground">Total units: <strong>{totalUnits}</strong></span>
          <span className="text-muted-foreground">Cost/unit: <strong>{isNaN(costPerUnit) ? "—" : fmt(costPerUnit)}</strong></span>
          <span className="text-muted-foreground">Total cost: <strong>{fmt(parseFloat(form.caseCost) * (parseInt(form.casesReceived) || 1))}</strong></span>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">Notes (optional)</label>
        <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="PO#, invoice, etc." className="h-10 rounded-xl" />
      </div>

      <Button className="w-full h-11 rounded-xl font-bold" disabled={!form.caseCost || !form.vendor || submitting} onClick={handleSubmit}>
        <Truck className="w-4 h-4 mr-2" />
        {submitting ? "Saving…" : `Receive ${totalUnits || "?"} Units`}
      </Button>
    </div>
  );
}

/* ── Transfer Form ── */
function TransferForm({ item, onTransferred }: { item: WarehouseItem; onTransferred: () => void }) {
  const { toast } = useToast();
  const { locations } = useSelectedLocation();
  const [form, setForm] = useState({
    storeLocation: "",
    unitsTransferred: "1",
    createStoreItem: false,
    parLevel: "0",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  function set(key: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    const units = parseInt(form.unitsTransferred) || 0;
    if (!units) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/warehouse/${item.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeLocation: form.storeLocation,
          unitsTransferred: units,
          createStoreItem: form.createStoreItem,
          parLevel: parseInt(form.parLevel) || 0,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed");
      }
      const result = await res.json();
      toast({ title: `${units} units sent to ${form.storeLocation}`, description: `Warehouse qty now: ${result.newWarehouseQty}` });
      onTransferred();
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Error transferring", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const units = parseInt(form.unitsTransferred) || 0;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <h3 className="font-bold text-base flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-primary" />Transfer to Store</h3>

      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">Destination Store</label>
        <div className="grid grid-cols-3 gap-1.5">
          {locations.map((loc) => (
            <button key={loc.name} onClick={() => set("storeLocation", loc.name)}
              className={`text-xs rounded-xl px-2 py-2 font-medium border transition-colors text-center ${form.storeLocation === loc.name ? "border-primary bg-primary/5 text-primary font-bold" : "border-border bg-background hover:border-primary/40"}`}>
              {loc.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Units to Transfer</label>
          <div className="flex items-center gap-1">
            <button onClick={() => set("unitsTransferred", String(Math.max(1, (parseInt(form.unitsTransferred) || 1) - 1)))} className="w-9 h-10 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80"><Minus className="w-3.5 h-3.5" /></button>
            <Input type="number" min={1} max={item.quantity} value={form.unitsTransferred} onChange={(e) => set("unitsTransferred", e.target.value)} className="h-10 rounded-xl text-center font-bold flex-1" />
            <button onClick={() => set("unitsTransferred", String((parseInt(form.unitsTransferred) || 0) + 1))} className="w-9 h-10 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Max available: {item.quantity}</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Notes (optional)</label>
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Transfer note…" className="h-10 rounded-xl" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="create-store-item" checked={form.createStoreItem} onChange={(e) => set("createStoreItem", e.target.checked)} className="rounded" />
        <label htmlFor="create-store-item" className="text-sm font-medium cursor-pointer">Create new store item if it doesn't exist</label>
      </div>

      {form.createStoreItem && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Store Par Level</label>
          <Input type="number" min={0} value={form.parLevel} onChange={(e) => set("parLevel", e.target.value)} className="h-10 rounded-xl w-32" />
        </div>
      )}

      <Button className="w-full h-11 rounded-xl font-bold" disabled={!units || units > item.quantity || submitting} onClick={handleSubmit}>
        <ArrowRightLeft className="w-4 h-4 mr-2" />
        {submitting ? "Transferring…" : `Send ${units} Units to ${form.storeLocation}`}
      </Button>
    </div>
  );
}

/* ── Detail Page ── */
export default function WarehouseDetailPage() {
  const { hasPermission } = useAuth();
  const canViewCosts = hasPermission("view_costs");
  const canReceive = hasPermission("receive_purchases");
  const canTransfer = hasPermission("transfer_inventory");

  const [, navigate] = useWouterLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, params] = useRoute("/warehouse/:id");
  const id = parseInt(params?.id ?? "0");

  const [showReceive, setShowReceive] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [vendorPage, setVendorPage] = useState(1);
  const [purchasePage, setPurchasePage] = useState(1);
  const [transferPage, setTransferPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouse-detail", id, purchasePage, transferPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        purchasePage: String(purchasePage),
        transferPage: String(transferPage),
      });
      const res = await fetch(`${BASE}/api/warehouse/${id}?${params.toString()}`);
      if (!res.ok) throw new Error("Not found");
      return res.json() as Promise<DetailData>;
    },
    enabled: !!id,
  });

  function handleRefetch() {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["warehouse"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-dashboard"] });
  }

  if (isLoading) return <Layout><div className="max-w-xl mx-auto space-y-4 animate-pulse">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}</div></Layout>;
  if (!data) return <Layout><div className="text-center py-20 text-muted-foreground">Item not found</div></Layout>;

  const { item, purchases, transfers, vendorPricing, pricing } = data;
  const purchaseTotal = data.pagination?.purchases.total ?? purchases.length;
  const transferTotal = data.pagination?.transfers.total ?? transfers.length;
  const pctFull = item.maxPar > 0 ? Math.min(100, (item.quantity / item.maxPar) * 100) : null;
  const pagedVendorPricing = listPageItems(vendorPricing, vendorPage);
  const pagedPurchases = purchases;
  const pagedTransfers = transfers;

  return (
    <Layout>
      <div className="max-w-xl mx-auto space-y-4 pb-10">

        {/* Header */}
        <div className="flex items-start gap-3">
          <button onClick={() => navigate("/warehouse")} className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground mt-0.5">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-extrabold leading-tight">{item.name}</h1>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor(item.status)}`}>
                {statusLabel(item.status)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {item.category}
              {item.barcode && <span className="font-mono ml-2">{item.barcode}</span>}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {/* Qty bar */}
          {pctFull !== null && (
            <div className="px-4 pt-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>0</span><span>Min {item.minPar}</span><span>Max {item.maxPar}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${item.status === "out" ? "bg-red-500" : item.status === "low" ? "bg-orange-500" : item.status === "overstock" ? "bg-blue-500" : "bg-emerald-500"}`}
                  style={{ width: `${pctFull}%` }}
                />
              </div>
              {item.reorderPoint > 0 && (
                <div className="relative h-0">
                  <div className="absolute top-0 h-3 w-0.5 bg-yellow-500 -translate-y-3" style={{ left: `${Math.min(100, (item.reorderPoint / item.maxPar) * 100)}%` }} />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-4 divide-x divide-border p-4 gap-0">
            {[
              { label: "In Warehouse", value: item.quantity, large: true },
              { label: "Min Par", value: item.minPar },
              { label: "Max Par", value: item.maxPar || "—" },
              { label: "Reorder At", value: item.reorderPoint || "—" },
            ].map((s) => (
              <div key={s.label} className="text-center px-2 first:pl-0 last:pr-0">
                <p className={`font-black leading-none ${s.large ? "text-3xl" : "text-xl"} ${
                  s.label === "In Warehouse" && item.status === "out" ? "text-red-600" :
                  s.label === "In Warehouse" && item.status === "low" ? "text-orange-600" :
                  s.label === "In Warehouse" && item.status === "overstock" ? "text-blue-600" : "text-foreground"
                }`}>
                  {s.value}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing */}
        {canViewCosts && (pricing.latest != null || pricing.avg != null || pricing.lowest != null) && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" />Cost Summary</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: "Latest Cost/Unit", value: pricing.latest },
                { label: "Average Cost/Unit", value: pricing.avg },
                { label: "Lowest Cost/Unit", value: pricing.lowest },
              ].map((p) => (
                <div key={p.label} className="text-center bg-muted/30 rounded-xl p-2">
                  <p className="text-base font-black">{fmt(p.value)}</p>
                  <p className="text-[10px] text-muted-foreground">{p.label}</p>
                </div>
              ))}
            </div>

            {vendorPricing.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">By Vendor</p>
                <div className="space-y-1">
                  {pagedVendorPricing.map((vp) => (
                    <div key={vp.vendor} className="flex items-center justify-between text-sm py-1">
                      <span className="font-medium">{vp.vendor}</span>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Lowest: <strong className="text-emerald-700">{fmt(vp.lowestCost)}</strong></span>
                        <span>Avg: <strong>{fmt(vp.avgCost)}</strong></span>
                        <span>Latest: <strong>{fmt(vp.latestCost)}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
                <ListPager page={vendorPage} total={vendorPricing.length} onPageChange={setVendorPage} />
              </>
            )}

            {item.caseCost != null && (
              <p className="text-xs text-muted-foreground mt-2">
                Case cost: <strong>{fmt(item.caseCost)}</strong> · {item.unitsPerCase} units/case
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {(canReceive || canTransfer) && (
          <div className="flex gap-3">
            {canReceive && (
              <Button
                className={`flex-1 h-12 rounded-xl font-bold ${showReceive ? "opacity-60" : ""}`}
                onClick={() => { setShowReceive(!showReceive); setShowTransfer(false); }}
              >
                <Truck className="w-4 h-4 mr-2" />
                Receive Inventory
              </Button>
            )}
            {canTransfer && (
              <Button
                variant="outline"
                className={`flex-1 h-12 rounded-xl font-bold ${showTransfer ? "opacity-60" : ""}`}
                disabled={item.quantity <= 0}
                onClick={() => { setShowTransfer(!showTransfer); setShowReceive(false); }}
              >
                <ArrowRightLeft className="w-4 h-4 mr-2" />
                Transfer to Store
              </Button>
            )}
          </div>
        )}

        {canReceive && showReceive && (
          <ReceiveForm itemId={id} onReceived={() => { handleRefetch(); setShowReceive(false); }} />
        )}
        {canTransfer && showTransfer && (
          <TransferForm item={item} onTransferred={() => { handleRefetch(); setShowTransfer(false); }} />
        )}

        {/* Purchase History */}
        {canViewCosts && purchaseTotal > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Truck className="w-4 h-4 text-primary" />Purchase History ({purchaseTotal})</h3>
              <button onClick={() => navigate("/warehouse/purchases")} className="text-xs text-primary font-semibold hover:underline">View all</button>
            </div>
            <div className="divide-y divide-border">
              {pagedPurchases.map((p) => (
                <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{p.vendor}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(p.purchaseDate)} · {p.casesReceived} case{p.casesReceived !== 1 ? "s" : ""} × {p.unitsPerCase}/case
                    </p>
                    {p.notes && <p className="text-xs text-muted-foreground italic">{p.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">+{p.totalUnits} units</p>
                    <p className="text-xs text-muted-foreground">{fmt(p.caseCost)}/case · {fmt(p.costPerUnit)}/unit</p>
                  </div>
                </div>
              ))}
            </div>
            <ListPager page={purchasePage} total={purchaseTotal} onPageChange={setPurchasePage} />
          </div>
        )}

        {/* Transfer History */}
        {transferTotal > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-primary" />Transfer History ({transferTotal})</h3>
            </div>
            <div className="divide-y divide-border">
              {pagedTransfers.map((t) => (
                <div key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{t.storeLocation}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(t.createdAt)}</p>
                    {t.notes && <p className="text-xs text-muted-foreground italic">{t.notes}</p>}
                  </div>
                  <p className="text-sm font-bold text-orange-600">−{t.unitsTransferred} units</p>
                </div>
              ))}
            </div>
            <ListPager page={transferPage} total={transferTotal} onPageChange={setTransferPage} />
          </div>
        )}

      </div>
    </Layout>
  );
}
