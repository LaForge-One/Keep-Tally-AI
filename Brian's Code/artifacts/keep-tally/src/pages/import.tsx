import { useState, useRef } from "react";
import { useLocation as useWouterLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { NoPermissionPage } from "@/components/permission-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  ArrowLeft,
  TrendingUp,
  Minus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LIST_PAGE_SIZE = 50;

type ImportMode = "deduct" | "par";

type MatchedItem = {
  csvName: string;
  qtySold: number;
  locations: string[];
  itemId: number;
  itemName: string;
  category: string;
  location: string;
  currentQty: number;
  parLevel: number;
  projectedQty: number;
};

type UnmatchedItem = {
  csvName: string;
  qtySold: number;
  locations: string[];
};

type PreviewData = {
  detectedColumns: { item: string | null; barcode?: string | null; qty: string | null; location: string | null; date: string | null };
  totalRows: number;
  matched: MatchedItem[];
  unmatched: UnmatchedItem[];
};

type Step = "upload" | "preview" | "done";
type ApiErrorPayload = { error?: unknown };

function apiErrorMessage(payload: ApiErrorPayload, fallback: string): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybe = error as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
    if (Array.isArray(maybe.formErrors) && typeof maybe.formErrors[0] === "string") return maybe.formErrors[0];
    if (maybe.fieldErrors) {
      for (const value of Object.values(maybe.fieldErrors)) {
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      }
    }
  }
  return fallback;
}

function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
}

function PageFooter({
  page,
  total,
  label,
  onPageChange,
}: {
  page: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  if (total <= LIST_PAGE_SIZE) return null;
  const pages = pageCount(total);
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * LIST_PAGE_SIZE + 1;
  const end = Math.min(total, safePage * LIST_PAGE_SIZE);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground">
      <span>Showing {start}-{end} of {total} {label}</span>
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

export default function ImportPage() {
  const { hasPermission } = useAuth();

  const [, navigate] = useWouterLocation();
  const importLocation = new URLSearchParams(window.location.search).get("location") ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [mode, setMode] = useState<ImportMode>("deduct");
  const [restockDays, setRestockDays] = useState(7);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ applied: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [matchedPage, setMatchedPage] = useState(1);
  const [unmatchedPage, setUnmatchedPage] = useState(1);

  if (!hasPermission("edit_store_inventory")) {
    return (
      <Layout>
        <NoPermissionPage message="You do not have permission to import sales data." />
      </Layout>
    );
  }

  function handleFile(f: File) {
    setFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (importLocation) form.append("location", importLocation);
      const res = await fetch(`${BASE}/api/import/preview`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err, "Upload failed"));
      }
      const data: PreviewData = await res.json();
      setPreview(data);
      setSelected(new Set(data.matched.map((m) => m.itemId)));
      setMatchedPage(1);
      setUnmatchedPage(1);
      setStep("preview");
    } catch (e: unknown) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setApplying(true);
    try {
      const items = preview.matched
        .filter((m) => selected.has(m.itemId))
        .map((m) => ({ itemId: m.itemId, qtySold: m.qtySold }));

      const res = await fetch(`${BASE}/api/import/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, restockDays, items }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err, "Apply failed"));
      }
      const result = await res.json();
      setApplyResult(result);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["restock"] });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not apply changes.", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  }

  function toggleItem(itemId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function suggestedPar(qtySold: number) {
    return Math.ceil((qtySold / 7) * restockDays);
  }

  const matchedPageStart = (Math.min(matchedPage, pageCount(preview?.matched.length ?? 0)) - 1) * LIST_PAGE_SIZE;
  const unmatchedPageStart = (Math.min(unmatchedPage, pageCount(preview?.unmatched.length ?? 0)) - 1) * LIST_PAGE_SIZE;
  const matchedPageItems = preview?.matched.slice(matchedPageStart, matchedPageStart + LIST_PAGE_SIZE) ?? [];
  const unmatchedPageItems = preview?.unmatched.slice(unmatchedPageStart, unmatchedPageStart + LIST_PAGE_SIZE) ?? [];

  return (
    <Layout>
      <div className="space-y-6 pb-8 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => step === "preview" ? setStep("upload") : navigate("/")}
            className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6 text-primary" />
              Import Sales CSV
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cantaloupe Go &mdash; update inventory from your sales export
              {importLocation ? ` for ${importLocation}` : ""}
            </p>
          </div>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 text-sm">
          {(["upload", "preview", "done"] as Step[]).map((s, i) => {
            const labels = ["Upload", "Review", "Done"];
            const active = step === s;
            const past = ["upload", "preview", "done"].indexOf(step) > i;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  active ? "bg-primary text-primary-foreground" :
                  past ? "bg-emerald-500 text-white" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {past ? "✓" : i + 1}
                </div>
                <span className={active ? "font-semibold text-foreground" : "text-muted-foreground"}>{labels[i]}</span>
                {i < 2 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
            );
          })}
        </div>

        {/* ── STEP 1: Upload ── */}
        {step === "upload" && (
          <div className="space-y-5">

            {/* Mode selector */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode("deduct")}
                className={`flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all text-left ${
                  mode === "deduct" ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${mode === "deduct" ? "bg-primary/15" : "bg-muted/60"}`}>
                  <Minus className={`w-5 h-5 ${mode === "deduct" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="font-bold text-sm">Deduct Sales</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Subtract units sold from current inventory quantities</p>
                </div>
              </button>

              <button
                onClick={() => setMode("par")}
                className={`flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all text-left ${
                  mode === "par" ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${mode === "par" ? "bg-primary/15" : "bg-muted/60"}`}>
                  <TrendingUp className={`w-5 h-5 ${mode === "par" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="font-bold text-sm">Update Par Levels</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Set par based on sales velocity × restock cycle</p>
                </div>
              </button>
            </div>

            {mode === "par" && (
              <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold">Restock cycle (days)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">How many days between restocks?</p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={restockDays}
                  onChange={(e) => setRestockDays(parseInt(e.target.value) || 7)}
                  className="w-20 text-right font-bold text-base h-10"
                />
              </div>
            )}

            {/* File dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragOver ? "border-primary bg-primary/5" :
                file ? "border-emerald-400 bg-emerald-50" :
                "border-border hover:border-primary/40 bg-card"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  <p className="font-semibold text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB — click to change</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Upload className="w-10 h-10 opacity-40" />
                  <p className="font-semibold">Drop your Cantaloupe CSV here</p>
                  <p className="text-xs">or click to browse</p>
                  <p className="text-xs mt-2 opacity-60">Export from Cantaloupe Go: Reports → Sales by Product → Download CSV</p>
                </div>
              )}
            </div>

            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={!file || uploading}
              onClick={handleUpload}
            >
              {uploading ? "Parsing..." : "Preview Changes"}
              {!uploading && <ChevronRight className="w-5 h-5 ml-1" />}
            </Button>
          </div>
        )}

        {/* ── STEP 2: Preview ── */}
        {step === "preview" && preview && (
          <div className="space-y-5">

            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-foreground">{preview.totalRows}</p>
                <p className="text-xs text-muted-foreground">CSV rows</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-emerald-700">{preview.matched.length}</p>
                <p className="text-xs text-emerald-700">matched</p>
              </div>
              <div className={`border rounded-xl p-3 text-center ${preview.unmatched.length > 0 ? "bg-amber-50 border-amber-200" : "bg-muted/30 border-border"}`}>
                <p className={`text-2xl font-black ${preview.unmatched.length > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{preview.unmatched.length}</p>
                <p className={`text-xs ${preview.unmatched.length > 0 ? "text-amber-700" : "text-muted-foreground"}`}>unmatched</p>
              </div>
            </div>

            {/* Detected columns info */}
            <div className="bg-muted/40 rounded-xl px-4 py-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span><strong>Item col:</strong> {preview.detectedColumns.item ?? "not detected"}</span>
              {preview.detectedColumns.barcode && <span><strong>Barcode col:</strong> {preview.detectedColumns.barcode}</span>}
                <span><strong>Qty col:</strong> {preview.detectedColumns.qty ?? "not detected"}</span>
              {preview.detectedColumns.location && <span><strong>Location:</strong> {preview.detectedColumns.location}</span>}
            </div>

            {/* Mode info */}
            <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 ${
              mode === "deduct" ? "bg-blue-50 border border-blue-200 text-blue-800" : "bg-purple-50 border border-purple-200 text-purple-800"
            }`}>
              {mode === "deduct" ? <Minus className="w-4 h-4 shrink-0" /> : <TrendingUp className="w-4 h-4 shrink-0" />}
              {mode === "deduct"
                ? `Deducting units sold from current inventory for ${selected.size} item${selected.size !== 1 ? "s" : ""}`
                : `Setting par levels based on sales velocity × ${restockDays}-day restock cycle for ${selected.size} item${selected.size !== 1 ? "s" : ""}`
              }
            </div>

            {/* Matched items */}
            {preview.matched.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Matched Items</h3>
                  <button
                    className="text-xs text-primary font-medium"
                    onClick={() => {
                      if (selected.size === preview.matched.length) setSelected(new Set());
                      else setSelected(new Set(preview.matched.map((m) => m.itemId)));
                    }}
                  >
                    {selected.size === preview.matched.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
                  <div className="grid px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                    style={{ gridTemplateColumns: "auto 1fr auto auto auto" }}>
                    <span className="w-5" />
                    <span>Item</span>
                    <span className="text-right px-2">Sold</span>
                    <span className="text-right px-2">{mode === "deduct" ? "New Qty" : "New Par"}</span>
                    <span className="text-right">Now</span>
                  </div>
                  {matchedPageItems.map((item) => {
                    const checked = selected.has(item.itemId);
                    const newPar = suggestedPar(item.qtySold);
                    const newQty = item.projectedQty;
                    const displayNew = mode === "deduct" ? newQty : newPar;
                    const displayNow = mode === "deduct" ? item.currentQty : item.parLevel;
                    const diff = displayNew - displayNow;
                    return (
                      <button
                        key={item.itemId}
                        onClick={() => toggleItem(item.itemId)}
                        className={`grid items-center px-4 py-3 w-full text-left transition-colors active:scale-[0.99] ${checked ? "bg-primary/4" : "hover:bg-muted/20"}`}
                        style={{ gridTemplateColumns: "auto 1fr auto auto auto" }}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mr-3 transition-colors ${
                          checked ? "border-primary bg-primary" : "border-border"
                        }`}>
                          {checked && <span className="text-primary-foreground text-[10px] font-bold">✓</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.itemName}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.csvName !== item.itemName && <span className="italic">"{item.csvName}" · </span>}{item.category}</p>
                        </div>
                        <span className="text-sm tabular-nums text-muted-foreground px-2">{item.qtySold}</span>
                        <span className={`text-sm font-bold tabular-nums px-2 ${diff < 0 ? "text-red-600" : diff > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {displayNew}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">{displayNow}</span>
                      </button>
                    );
                  })}
                  <PageFooter page={matchedPage} total={preview.matched.length} label="matched items" onPageChange={setMatchedPage} />
                </div>
              </div>
            )}

            {/* Unmatched items */}
            {preview.unmatched.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm text-amber-700 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  Unmatched Items ({preview.unmatched.length})
                </h3>
                <div className="bg-card border border-amber-200 rounded-xl overflow-hidden divide-y divide-border">
                  {unmatchedPageItems.map((item, i) => (
                    <div key={`${item.csvName}-${unmatchedPageStart + i}`} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{item.csvName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{item.qtySold} sold</span>
                        <XCircle className="w-4 h-4 text-amber-400" />
                      </div>
                    </div>
                  ))}
                  <PageFooter page={unmatchedPage} total={preview.unmatched.length} label="unmatched items" onPageChange={setUnmatchedPage} />
                </div>
                <p className="text-xs text-muted-foreground">These items weren't found in your inventory. Add them to KeepTally first, then re-import.</p>
              </div>
            )}

            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={selected.size === 0 || applying}
              onClick={handleApply}
            >
              {applying ? "Applying..." : `Apply to ${selected.size} Item${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        )}

        {/* ── STEP 3: Done ── */}
        {step === "done" && applyResult && (
          <div className="space-y-5">
            <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-4">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold">Import Complete</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  {applyResult.applied} item{applyResult.applied !== 1 ? "s" : ""}{" "}
                  {mode === "deduct" ? "updated with sales deducted" : "updated with new par levels"}
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 h-12 rounded-xl font-semibold"
                  onClick={() => { setStep("upload"); setFile(null); setPreview(null); setApplyResult(null); }}
                >
                  Import Another
                </Button>
                <Button
                  className="flex-1 h-12 rounded-xl font-semibold"
                  onClick={() => navigate("/inventory")}
                >
                  View Inventory
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
