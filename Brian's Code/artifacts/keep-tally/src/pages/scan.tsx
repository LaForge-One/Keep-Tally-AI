import { useState, useEffect, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSelectedLocation, LOCATIONS } from "@/contexts/location-context";
import { useToast } from "@/hooks/use-toast";
import {
  Camera,
  CameraOff,
  Search,
  Package,
  PackagePlus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ArrowLeft,
  RotateCcw,
  BarChart3,
  Minus,
  Plus,
  Trash2,
  ArrowRightLeft,
  ClipboardCheck,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LIST_PAGE_SIZE = 50;

type ScanResult = {
  found: boolean;
  storeItem: ItemData | null;
  otherItems: ItemData[];
};

type ItemData = {
  id: number;
  name: string;
  category: string;
  quantity: number;
  parLevel: number;
  location: string;
  barcode: string | null;
};

type View =
  | "idle"
  | "result"
  | "verify"
  | "adjust"
  | "add-to-store"
  | "create";

const ADJUST_REASONS = [
  { value: "adjustment", label: "Adjustment" },
  { value: "theft", label: "Theft / Shrinkage" },
  { value: "spoilage", label: "Spoilage / Expired" },
  { value: "damaged", label: "Damaged" },
  { value: "comp", label: "Comp / Give-away" },
  { value: "return_to_warehouse", label: "Return to Warehouse" },
  { value: "missing_from_bin", label: "Missing from Bin" },
];

/* ── useBarcode scanner hook ── */
function useBarcodeScanner(onScan: (barcode: string) => void) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastScan = useRef<string>("");
  const cooldown = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    try {
      const scanner = new Html5Qrcode("barcode-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 120 } },
        (text) => {
          if (!cooldown.current && text !== lastScan.current) {
            cooldown.current = true;
            lastScan.current = text;
            onScan(text);
            setTimeout(() => { cooldown.current = false; }, 2000);
          }
        },
        () => {}
      );
      setActive(true);
    } catch {
      setError("Camera access denied. Please allow camera permissions and try again.");
    }
  }, [onScan]);

  const stop = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* ignore */ }
      try { scannerRef.current.clear(); } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  return { active, error, start, stop };
}

/* ── Main component ── */
export default function ScanPage() {
  const { selectedLocation } = useSelectedLocation();
  const { toast } = useToast();
  const createLocationOptions = selectedLocation ? [selectedLocation] : [];

  const [view, setView] = useState<View>("idle");
  const [barcode, setBarcode] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Verify form
  const [countedQty, setCountedQty] = useState("");
  const [verifyReason, setVerifyReason] = useState("adjustment");

  // Adjust form
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("adjustment");
  const [adjustNotes, setAdjustNotes] = useState("");

  // Add-to-store form
  const [addQty, setAddQty] = useState("0");
  const [addPar, setAddPar] = useState("");
  const [addCategory, setAddCategory] = useState("");

  // Create form
  const [createName, setCreateName] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createQty, setCreateQty] = useState("0");
  const [createPar, setCreatePar] = useState("0");
  const [createLocation, setCreateLocation] = useState(selectedLocation ?? LOCATIONS[0]);

  const handleBarcodeScan = useCallback(async (code: string) => {
    setBarcode(code);
    setView("result");
    setLoading(true);
    try {
      const params = new URLSearchParams({ barcode: code });
      if (selectedLocation) params.set("location", selectedLocation);
      const res = await fetch(`${BASE}/api/scan/lookup?${params}`, {
        credentials: "include",
      });
      const data: ScanResult = await res.json();
      setResult(data);
      if (data.storeItem) {
        setAdjustQty(String(data.storeItem.quantity));
        setVerifyReason("adjustment");
      }
    } catch {
      toast({ title: "Lookup failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedLocation, toast]);

  const { active: scannerActive, error: cameraError, start: startScanner, stop: stopScanner } =
    useBarcodeScanner(handleBarcodeScan);

  function resetAll() {
    setView("idle");
    setBarcode("");
    setManualInput("");
    setResult(null);
    setCountedQty("");
    setAdjustQty("");
    setAdjustNotes("");
    setCreateName("");
    setCreateCategory("");
    setCreateQty("0");
    setCreatePar("0");
  }

  async function postAction(body: object) {
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/scan/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Action failed");
      return await res.json();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify() {
    if (!result?.storeItem || countedQty === "") return;
    if (!selectedLocation) {
      toast({
        title: "Select a store first",
        description: "Scanner inventory changes need an explicit store location.",
        variant: "destructive",
      });
      return;
    }
    const counted = parseInt(countedQty);
    const diff = counted - result.storeItem.quantity;
    const applyCount = diff !== 0;
    try {
      await postAction({
        action: "verify",
        barcode,
        itemId: result.storeItem.id,
        countedQty: counted,
        reason: diff !== 0 ? verifyReason : undefined,
        applyCount,
      });
      toast({
        title: diff === 0 ? "Count verified ✓" : `Quantity updated (${diff > 0 ? "+" : ""}${diff})`,
        description: result.storeItem.name,
      });
      resetAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  async function handleAdjust() {
    if (!result?.storeItem || adjustQty === "") return;
    if (!selectedLocation) {
      toast({
        title: "Select a store first",
        description: "Scanner inventory changes need an explicit store location.",
        variant: "destructive",
      });
      return;
    }
    try {
      await postAction({
        action: "adjust",
        barcode,
        itemId: result.storeItem.id,
        newQty: parseInt(adjustQty),
        reason: adjustReason,
        notes: adjustNotes || undefined,
      });
      toast({ title: "Quantity adjusted", description: result.storeItem.name });
      resetAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  async function handleAddToStore() {
    if (!result?.otherItems[0]) return;
    if (!selectedLocation) {
      toast({
        title: "Select a store first",
        description: "Scanner inventory changes need an explicit store location.",
        variant: "destructive",
      });
      return;
    }
    const source = result.otherItems[0];
    try {
      await postAction({
        action: "add-to-store",
        barcode,
        sourceItemId: source.id,
        location: selectedLocation,
        quantity: parseInt(addQty) || 0,
        parLevel: parseInt(addPar) || source.parLevel,
        category: addCategory || source.category,
      });
      toast({ title: `"${source.name}" added to ${selectedLocation}!` });
      resetAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  async function handleCreate() {
    if (!createName.trim()) return;
    if (!selectedLocation) {
      toast({
        title: "Select a store first",
        description: "Scanner inventory changes need an explicit store location.",
        variant: "destructive",
      });
      return;
    }
    try {
      await postAction({
        action: "create",
        barcode,
        name: createName.trim(),
        category: createCategory || "Uncategorized",
        location: selectedLocation,
        quantity: parseInt(createQty) || 0,
        parLevel: parseInt(createPar) || 0,
      });
      toast({ title: `"${createName}" created!` });
      resetAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  const item = result?.storeItem;
  const otherItem = result?.otherItems[0];

  return (
    <Layout>
      <div className="max-w-md mx-auto space-y-4 pb-10">

        {/* Header */}
        <div className="flex items-center gap-3">
          {view !== "idle" ? (
            <button onClick={() => { if (view !== "result") setView("result"); else resetAll(); }}
              className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground">
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : null}
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-primary" />
              Barcode Scanner
            </h1>
            <p className="text-sm text-muted-foreground">
              {selectedLocation ?? "All locations"} · Scan or type a barcode
            </p>
          </div>
        </div>

        {/* ── IDLE: Scanner + manual entry ── */}
        {(view === "idle" || view === "result") && (
          <div className="space-y-4">

            {/* Camera scanner area */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              {/* The div where html5-qrcode mounts */}
              <div id="barcode-reader" className={scannerActive ? "w-full" : "hidden"} />

              {!scannerActive && (
                <div className="flex flex-col items-center justify-center gap-4 p-8">
                  <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Camera className="w-10 h-10 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-base">Scan a barcode</p>
                    <p className="text-xs text-muted-foreground mt-1">Point your camera at a product barcode</p>
                  </div>
                  <Button
                    className="w-full h-12 text-base font-bold rounded-xl"
                    onClick={startScanner}
                  >
                    <Camera className="w-5 h-5 mr-2" />
                    Start Camera
                  </Button>
                  {cameraError && (
                    <p className="text-xs text-red-500 text-center">{cameraError}</p>
                  )}
                </div>
              )}

              {scannerActive && (
                <div className="p-3 flex items-center justify-between border-t border-border bg-muted/20">
                  <p className="text-sm text-muted-foreground font-medium">Scanning…</p>
                  <Button variant="outline" size="sm" onClick={stopScanner}>
                    <CameraOff className="w-4 h-4 mr-1" />
                    Stop
                  </Button>
                </div>
              )}
            </div>

            {/* Manual barcode entry */}
            <div className="flex gap-2">
              <Input
                placeholder="Type barcode manually…"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualInput.trim()) {
                    stopScanner();
                    handleBarcodeScan(manualInput.trim());
                    setManualInput("");
                  }
                }}
                className="h-11 rounded-xl font-mono text-sm"
              />
              <Button
                className="h-11 rounded-xl shrink-0"
                disabled={!manualInput.trim()}
                onClick={() => {
                  stopScanner();
                  handleBarcodeScan(manualInput.trim());
                  setManualInput("");
                }}
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>

            {/* ── Result card ── */}
            {view === "result" && (
              <>
                {loading ? (
                  <div className="bg-card border border-border rounded-2xl p-6 text-center">
                    <p className="text-muted-foreground text-sm">Looking up <span className="font-mono">{barcode}</span>…</p>
                  </div>
                ) : result && (
                  <div className="space-y-3">

                    {/* Scanned barcode chip */}
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-xs text-muted-foreground">Barcode:</span>
                      <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{barcode}</code>
                      <button onClick={resetAll} className="ml-auto text-xs text-primary font-medium flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" /> Scan again
                      </button>
                    </div>

                    {/* FOUND IN STORE */}
                    {item && (
                      <div className="bg-card border border-border rounded-2xl overflow-hidden">
                        <div className="flex items-center gap-3 p-4 border-b border-border">
                          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-xs text-emerald-700 font-semibold uppercase tracking-wide">Found in {item.location}</p>
                            <h2 className="font-bold text-lg leading-tight">{item.name}</h2>
                            <p className="text-xs text-muted-foreground">{item.category}</p>
                          </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                          <div className="p-3 text-center">
                            <p className={`text-2xl font-black ${item.quantity <= item.parLevel ? "text-red-600" : "text-foreground"}`}>
                              {item.quantity}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">In Store</p>
                          </div>
                          <div className="p-3 text-center">
                            <p className="text-2xl font-black text-muted-foreground">{item.parLevel}</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Par Level</p>
                          </div>
                          <div className="p-3 text-center">
                            {result.otherItems.slice(0, LIST_PAGE_SIZE).map((o) => (
                              <div key={o.id}>
                                <p className="text-2xl font-black text-blue-600">{o.quantity}</p>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{o.location}</p>
                              </div>
                            ))}
                            {result.otherItems.length === 0 && (
                              <>
                                <p className="text-2xl font-black text-muted-foreground/30">—</p>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Warehouse</p>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="grid grid-cols-2 gap-2 p-3">
                          <Button className="h-11 rounded-xl font-semibold text-sm" onClick={() => { setCountedQty(""); setView("verify"); }}>
                            <ClipboardCheck className="w-4 h-4 mr-1.5" />
                            Verify Count
                          </Button>
                          <Button variant="outline" className="h-11 rounded-xl font-semibold text-sm" onClick={() => { setAdjustQty(String(item.quantity)); setView("adjust"); }}>
                            <ArrowRightLeft className="w-4 h-4 mr-1.5" />
                            Adjust Qty
                          </Button>
                          <Button variant="outline" className="h-11 rounded-xl font-semibold text-sm col-span-1"
                            onClick={() => { setAdjustReason("damaged"); setAdjustQty(String(Math.max(0, item.quantity - 1))); setView("adjust"); }}>
                            <Trash2 className="w-4 h-4 mr-1.5" />
                            Mark Damaged
                          </Button>
                          <Button variant="outline" className="h-11 rounded-xl font-semibold text-sm col-span-1"
                            onClick={() => { setAdjustReason("return_to_warehouse"); setAdjustQty("0"); setView("adjust"); }}>
                            <Package className="w-4 h-4 mr-1.5" />
                            Return to WH
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* FOUND IN OTHER LOCATION ONLY */}
                    {!item && otherItem && (
                      <div className="bg-card border-2 border-amber-300 rounded-2xl overflow-hidden">
                        <div className="flex items-center gap-3 p-4 bg-amber-50 border-b border-amber-200">
                          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                            <AlertTriangle className="w-5 h-5 text-amber-600" />
                          </div>
                          <div>
                            <p className="text-xs text-amber-700 font-semibold uppercase tracking-wide">Not in {selectedLocation ?? "this store"}</p>
                            <h2 className="font-bold text-lg leading-tight">{otherItem.name}</h2>
                            <p className="text-xs text-amber-700">Found in {otherItem.location} · {otherItem.quantity} units</p>
                          </div>
                        </div>
                        <div className="p-4 space-y-3">
                          <p className="text-sm text-muted-foreground">This item exists in another location. Would you like to add it to <strong>{selectedLocation ?? "this store"}</strong>?</p>
                          <Button className="w-full h-12 rounded-xl font-bold" onClick={() => {
                            setAddQty("0");
                            setAddPar(String(otherItem.parLevel));
                            setAddCategory(otherItem.category);
                            setView("add-to-store");
                          }}>
                            <PackagePlus className="w-5 h-5 mr-2" />
                            Add to {selectedLocation ?? "Store"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* NOT FOUND */}
                    {!result.found && (
                      <div className="bg-card border-2 border-dashed border-border rounded-2xl overflow-hidden">
                        <div className="flex items-center gap-3 p-4">
                          <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center shrink-0">
                            <XCircle className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-bold text-base">Item Not Found</p>
                            <p className="text-xs text-muted-foreground">This barcode isn't in your inventory yet</p>
                          </div>
                        </div>
                        <div className="px-4 pb-4">
                          <Button className="w-full h-12 rounded-xl font-bold" onClick={() => {
                            setCreateLocation(selectedLocation ?? LOCATIONS[0]);
                            setView("create");
                          }}>
                            <PackagePlus className="w-5 h-5 mr-2" />
                            Create New Item
                          </Button>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── VERIFY COUNT ── */}
        {view === "verify" && item && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Verifying</p>
              <h2 className="font-bold text-xl">{item.name}</h2>
              <p className="text-sm text-muted-foreground">{item.location} · System qty: <strong>{item.quantity}</strong></p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-2">Counted Quantity</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setCountedQty(String(Math.max(0, (parseInt(countedQty) || 0) - 1)))}
                    className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-xl font-bold hover:bg-muted/80">
                    <Minus className="w-5 h-5" />
                  </button>
                  <Input
                    type="number"
                    min={0}
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                    className="flex-1 h-12 text-center text-2xl font-black rounded-xl"
                    placeholder="0"
                  />
                  <button onClick={() => setCountedQty(String((parseInt(countedQty) || 0) + 1))}
                    className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-xl font-bold hover:bg-muted/80">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {countedQty !== "" && parseInt(countedQty) !== item.quantity && (
                <div>
                  <div className={`rounded-xl px-3 py-2 text-sm font-semibold mb-3 ${
                    parseInt(countedQty) < item.quantity ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}>
                    Discrepancy: {parseInt(countedQty) > item.quantity ? "+" : ""}{parseInt(countedQty) - item.quantity} from system count
                  </div>
                  <label className="text-sm font-semibold block mb-2">Reason for discrepancy</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ADJUST_REASONS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setVerifyReason(r.value)}
                        className={`text-xs rounded-xl px-3 py-2.5 font-medium border transition-colors text-left ${
                          verifyReason === r.value
                            ? "border-primary bg-primary/5 text-primary font-bold"
                            : "border-border bg-card hover:border-primary/40"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {countedQty !== "" && parseInt(countedQty) === item.quantity && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm font-semibold text-emerald-700">
                  ✓ Count matches system — no discrepancy
                </div>
              )}
            </div>

            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={countedQty === "" || submitting}
              onClick={handleVerify}
            >
              <CheckCircle2 className="w-5 h-5 mr-2" />
              {parseInt(countedQty) === item.quantity ? "Confirm Count" : "Save & Update Quantity"}
            </Button>
          </div>
        )}

        {/* ── ADJUST QUANTITY ── */}
        {view === "adjust" && item && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Adjusting</p>
              <h2 className="font-bold text-xl">{item.name}</h2>
              <p className="text-sm text-muted-foreground">{item.location} · Current: <strong>{item.quantity}</strong></p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-2">New Quantity</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setAdjustQty(String(Math.max(0, (parseInt(adjustQty) || 0) - 1)))}
                    className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80">
                    <Minus className="w-5 h-5" />
                  </button>
                  <Input
                    type="number"
                    min={0}
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                    className="flex-1 h-12 text-center text-2xl font-black rounded-xl"
                  />
                  <button onClick={() => setAdjustQty(String((parseInt(adjustQty) || 0) + 1))}
                    className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold block mb-2">Reason</label>
                <div className="grid grid-cols-2 gap-2">
                  {ADJUST_REASONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setAdjustReason(r.value)}
                      className={`text-xs rounded-xl px-3 py-2.5 font-medium border transition-colors text-left ${
                        adjustReason === r.value
                          ? "border-primary bg-primary/5 text-primary font-bold"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold block mb-2">Notes (optional)</label>
                <Input
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="Add any notes…"
                  className="rounded-xl h-10"
                />
              </div>
            </div>

            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={adjustQty === "" || submitting}
              onClick={handleAdjust}
            >
              Save Adjustment
              <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
          </div>
        )}

        {/* ── ADD TO STORE ── */}
        {view === "add-to-store" && otherItem && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Adding to {selectedLocation ?? "store"}</p>
              <h2 className="font-bold text-xl">{otherItem.name}</h2>
              <p className="text-sm text-muted-foreground">From {otherItem.location} · {otherItem.quantity} available</p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-2">Starting Quantity</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setAddQty(String(Math.max(0, (parseInt(addQty) || 0) - 1)))}
                    className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80">
                    <Minus className="w-5 h-5" />
                  </button>
                  <Input
                    type="number"
                    min={0}
                    value={addQty}
                    onChange={(e) => setAddQty(e.target.value)}
                    className="flex-1 h-12 text-center text-2xl font-black rounded-xl"
                  />
                  <button onClick={() => setAddQty(String((parseInt(addQty) || 0) + 1))}
                    className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-2">Par Level</label>
                <Input
                  type="number"
                  min={0}
                  value={addPar}
                  onChange={(e) => setAddPar(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder={`Default: ${otherItem.parLevel}`}
                />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-2">Category</label>
                <Input
                  value={addCategory}
                  onChange={(e) => setAddCategory(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder={otherItem.category}
                />
              </div>
            </div>

            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={submitting}
              onClick={handleAddToStore}
            >
              <PackagePlus className="w-5 h-5 mr-2" />
              Add to {selectedLocation ?? "Store"}
            </Button>
          </div>
        )}

        {/* ── CREATE NEW ITEM ── */}
        {view === "create" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">New Item</p>
              <p className="text-sm font-mono text-muted-foreground">Barcode: {barcode}</p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-2">Item Name <span className="text-red-500">*</span></label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Coke Zero 20 oz"
                  className="h-11 rounded-xl"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-2">Category</label>
                <Input
                  value={createCategory}
                  onChange={(e) => setCreateCategory(e.target.value)}
                  placeholder="e.g. Soda, Snacks, Candy"
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold block mb-2">Quantity</label>
                  <Input
                    type="number"
                    min={0}
                    value={createQty}
                    onChange={(e) => setCreateQty(e.target.value)}
                    className="h-11 rounded-xl text-center font-bold"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold block mb-2">Par Level</label>
                  <Input
                    type="number"
                    min={0}
                    value={createPar}
                    onChange={(e) => setCreatePar(e.target.value)}
                    className="h-11 rounded-xl text-center font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-2">Location</label>
                <div className="grid grid-cols-2 gap-2">
                  {createLocationOptions.map((loc) => (
                    <button
                      key={loc}
                      onClick={() => setCreateLocation(loc)}
                      className={`text-xs rounded-xl px-3 py-2.5 font-medium border transition-colors text-left ${
                        createLocation === loc
                          ? "border-primary bg-primary/5 text-primary font-bold"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={!createName.trim() || submitting}
              onClick={handleCreate}
            >
              <PackagePlus className="w-5 h-5 mr-2" />
              Create Item
            </Button>
          </div>
        )}

      </div>
    </Layout>
  );
}
