import { useState, useEffect, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSelectedLocation } from "@/contexts/location-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListItemsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  X,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PackagePlus,
  ArrowRightLeft,
  Package,
  ShieldAlert,
  Flame,
  Wrench,
  ClipboardCheck,
  Search,
  Keyboard,
  Minus,
  Plus,
  ChevronLeft,
  RotateCcw,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SCANNER_ID = "inv-barcode-reader";
const MOBILE_SCANNER_V2_ENABLED =
  import.meta.env.VITE_MOBILE_SCANNER_V2_ENABLED === "true";

type WarehouseItemData = {
  id: number;
  name: string;
  category: string;
  quantity: number;
  minPar: number;
  maxPar: number;
  barcode?: string | null;
};
type ScanResult = {
  found: boolean;
  storeItem: ItemData | null;
  otherItems: ItemData[];
  warehouseItem?: WarehouseItemData | null;
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
type Phase =
  | "camera"
  | "result"
  | "verify"
  | "adjust"
  | "add-to-store"
  | "create";

const ADJUST_REASONS = [
  { value: "spoilage", label: "Spoilage" },
  { value: "theft", label: "Theft" },
  { value: "comp", label: "Comp" },
  { value: "damage", label: "Damage" },
  { value: "return_to_warehouse", label: "Return to Warehouse" },
  { value: "adjustment", label: "General adjustment" },
];

interface InventoryScannerProps {
  open: boolean;
  onClose: () => void;
  inventoryType?: "store" | "warehouse";
}

type BarcodeLookupResponse = {
  found: boolean;
  inventoryType?: "store" | "warehouse";
  item: ItemData | null;
};

export function InventoryScanner({
  open,
  onClose,
  inventoryType = "store",
}: InventoryScannerProps) {
  const { selectedLocation } = useSelectedLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const selectedStoreLocation =
    inventoryType === "store" ? selectedLocation : null;
  const createLocationOptions =
    inventoryType === "warehouse"
      ? ["Warehouse"]
      : selectedStoreLocation
        ? [selectedStoreLocation]
        : [];
  const defaultCreateLocation =
    inventoryType === "warehouse"
      ? "Warehouse"
      : (selectedLocation ?? "");

  const [phase, setPhase] = useState<Phase>("camera");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [countedQty, setCountedQty] = useState("");
  const [verifyReason, setVerifyReason] = useState("adjustment");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("adjustment");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [addQty, setAddQty] = useState("0");
  const [addPar, setAddPar] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [createName, setCreateName] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createQty, setCreateQty] = useState("0");
  const [createPar, setCreatePar] = useState("0");
  const [createLocation, setCreateLocation] = useState(defaultCreateLocation);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const cooldownRef = useRef(false);
  const lastBarcodeRef = useRef("");

  /* ── Camera ── */
  const startCamera = useCallback(async () => {
    setCameraError(null);
    let scanner: Html5Qrcode | null = null;
    try {
      scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 100 } },
        (text) => {
          if (!cooldownRef.current && text !== lastBarcodeRef.current) {
            cooldownRef.current = true;
            lastBarcodeRef.current = text;
            handleScan(text);
            setTimeout(() => {
              cooldownRef.current = false;
            }, 3000);
          }
        },
        () => {},
      );
      setCameraActive(true);
    } catch {
      // Clean up the scanner instance on failure so stopCamera is a no-op
      if (scanner) {
        try {
          scanner.clear();
        } catch {
          /* ignore */
        }
      }
      scannerRef.current = null;
      setCameraError(
        "Camera access denied or not available. Use manual entry below.",
      );
      setShowManual(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        /* ignore */
      }
      try {
        scannerRef.current.clear();
      } catch {
        /* ignore */
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  /* Start camera when overlay opens */
  useEffect(() => {
    if (open && phase === "camera") {
      const timer = setTimeout(() => startCamera(), 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Cleanup on unmount or close */
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      stopCamera();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) setCreateLocation(defaultCreateLocation);
  }, [open, defaultCreateLocation]);

  /* Escape key closes the overlay */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, stopCamera]);

  /* ── Scan lookup ── */
  const handleScan = useCallback(
    async (code: string) => {
      stopCamera();
      setBarcode(code);
      setPhase("result");
      setLoading(true);
      try {
        if (inventoryType === "warehouse") {
          const params = new URLSearchParams({ inventoryType: "warehouse" });
          const res = await fetch(
            `${BASE}/api/items/barcode/${encodeURIComponent(code)}?${params}`,
            { credentials: "include" },
          );
          if (res.status === 404) {
            setResult({
              found: false,
              storeItem: null,
              otherItems: [],
              warehouseItem: null,
            });
            return;
          }
          if (!res.ok) throw new Error("Lookup failed");
          const data: BarcodeLookupResponse = await res.json();
          setResult({
            found: data.found,
            storeItem: data.item,
            otherItems: [],
            warehouseItem: null,
          });
          if (data.item) setAdjustQty(String(data.item.quantity));
        } else {
          const params = new URLSearchParams({ barcode: code });
          if (selectedLocation) params.set("location", selectedLocation);
          const res = await fetch(`${BASE}/api/scan/lookup?${params}`, {
            credentials: "include",
          });
          const data: ScanResult = await res.json();
          setResult(data);
          if (data.storeItem) setAdjustQty(String(data.storeItem.quantity));
        }
      } catch {
        toast({ title: "Lookup failed", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [inventoryType, selectedLocation, stopCamera, toast],
  );

  /* ── Post action ── */
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

  function invalidateInventory() {
    queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetDashboardSummaryQueryKey(),
    });
    queryClient.invalidateQueries({ queryKey: ["warehouse"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-dashboard"] });
  }

  function resetToCamera() {
    setPhase("camera");
    setBarcode("");
    setResult(null);
    setCountedQty("");
    setAdjustQty("");
    setAdjustNotes("");
    setManualInput("");
    setCameraError(null);
    setShowManual(false);
    lastBarcodeRef.current = "";
    // Restart camera
    setTimeout(() => startCamera(), 100);
  }

  function requireStoreLocationForWrite() {
    if (inventoryType !== "store" || selectedStoreLocation) return true;
    toast({
      title: "Select a store first",
      description: "Scanner inventory changes need an explicit store location.",
      variant: "destructive",
    });
    return false;
  }

  async function handleVerify() {
    if (!result?.storeItem || countedQty === "") return;
    if (!requireStoreLocationForWrite()) return;
    const item = result.storeItem;
    const counted = parseInt(countedQty);
    const diff = counted - item.quantity;
    try {
      await postAction({
        action: "verify",
        barcode,
        itemId: item.id,
        countedQty: counted,
        reason: diff !== 0 ? verifyReason : undefined,
        applyCount: diff !== 0,
      });
      toast({
        title:
          diff === 0
            ? "Count verified ✓"
            : `Updated (${diff > 0 ? "+" : ""}${diff})`,
        description: item.name,
      });
      invalidateInventory();
      resetToCamera();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  async function handleAdjust() {
    if (!result?.storeItem || adjustQty === "") return;
    if (inventoryType === "store" && !requireStoreLocationForWrite()) return;
    try {
      const res = await fetch(`${BASE}/api/inventory/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          inventoryType,
          barcode,
          itemId: result.storeItem.id,
          mode: "set",
          newQuantity: parseInt(adjustQty),
          reason: adjustReason,
          notes: adjustNotes || undefined,
        }),
      });
      if (!res.ok) throw new Error("Adjustment failed");
      toast({ title: "Quantity adjusted", description: result.storeItem.name });
      invalidateInventory();
      resetToCamera();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  async function handleAddToStore() {
    const src = result?.otherItems[0];
    if (!src) return;
    if (!requireStoreLocationForWrite()) return;
    try {
      await postAction({
        action: "add-to-store",
        barcode,
        sourceItemId: src.id,
        location: selectedStoreLocation!,
        quantity: parseInt(addQty) || 0,
        parLevel: parseInt(addPar) || src.parLevel,
        category: addCategory || src.category,
      });
      toast({ title: `"${src.name}" added to ${selectedStoreLocation}!` });
      invalidateInventory();
      resetToCamera();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  async function handleCreate() {
    if (!createName.trim()) return;
    if (inventoryType === "store" && !requireStoreLocationForWrite()) return;
    try {
      if (inventoryType === "warehouse") {
        const quantity = parseInt(createQty) || 0;
        const minPar = parseInt(createPar) || 0;
        const res = await fetch(`${BASE}/api/warehouse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            barcode,
            name: createName.trim(),
            category: createCategory || "Uncategorized",
            quantity,
            minPar,
            maxPar: Math.max(quantity, minPar, minPar * 2),
            reorderPoint: minPar,
          }),
        });
        if (!res.ok) throw new Error("Warehouse create failed");
      } else {
        await postAction({
          action: "create",
          barcode,
          name: createName.trim(),
          category: createCategory || "Uncategorized",
          location: selectedStoreLocation!,
          quantity: parseInt(createQty) || 0,
          parLevel: parseInt(createPar) || 0,
        });
      }
      toast({ title: `"${createName}" created!` });
      invalidateInventory();
      resetToCamera();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  if (!open) return null;

  const item = result?.storeItem;
  const otherItem = result?.otherItems?.[0];
  const scannerStep =
    phase === "camera"
      ? cameraActive
        ? "Camera ready"
        : cameraError
          ? "Camera needs attention"
          : "Starting camera"
      : loading
        ? "Looking up barcode"
        : submitting
          ? "Saving inventory action"
          : result?.storeItem
            ? "Store item matched"
            : result?.warehouseItem
              ? "Warehouse item matched"
              : result?.otherItems?.length
                ? "Matched another location"
                : "Ready for next action";

  /* ── Full-screen overlay ── */
  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* ─────────────── CAMERA PHASE ─────────────── */}
      {phase === "camera" && (
        <>
          {/* Fixed close button — always on top regardless of html5-qrcode DOM */}
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close scanner"
            className="fixed top-4 right-4 z-[110] w-11 h-11 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center text-white border border-white/20"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Camera stream */}
          <div className="relative flex-1 bg-black overflow-hidden">
            <div
              id={SCANNER_ID}
              className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>div]:hidden"
            />

            {/* Scan frame overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {/* Dim overlay with cutout feel */}
              <div className="absolute inset-0 bg-black/40" />

              {/* Scan frame */}
              <div className="relative z-10 w-72 h-28">
                {/* Corner brackets */}
                <span className="absolute top-0 left-0 w-8 h-8 border-l-4 border-t-4 border-white rounded-tl-sm" />
                <span className="absolute top-0 right-0 w-8 h-8 border-r-4 border-t-4 border-white rounded-tr-sm" />
                <span className="absolute bottom-0 left-0 w-8 h-8 border-l-4 border-b-4 border-white rounded-bl-sm" />
                <span className="absolute bottom-0 right-0 w-8 h-8 border-r-4 border-b-4 border-white rounded-br-sm" />
                <span className="scan-corner scan-corner-tl" />
                <span className="scan-corner scan-corner-tr" />
                <span className="scan-corner scan-corner-bl" />
                <span className="scan-corner scan-corner-br" />
                {/* Animated scan line */}
                {cameraActive && <div className="h-0.5 animate-scan-line" />}
              </div>

              <p className="relative z-10 mt-5 text-white/80 text-sm font-medium tracking-wide">
                {cameraActive ? "Point camera at barcode" : "Starting camera…"}
              </p>
            </div>

            {/* Header label */}
            <div className="absolute top-4 left-4 z-20 pointer-events-none">
              <span className="text-white font-semibold text-sm bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full">
                {selectedLocation ?? "Scan Barcode"}
              </span>
            </div>

            {MOBILE_SCANNER_V2_ENABLED && (
              <div className="absolute left-4 right-16 bottom-4 z-20 rounded-xl border border-white/15 bg-black/65 px-3 py-2 text-white backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">
                    Mobile scanner
                  </p>
                  <p className="text-xs text-white/70">
                    {inventoryType === "warehouse"
                      ? "Warehouse"
                      : (selectedLocation ?? "Store")}
                  </p>
                </div>
                <p className="mt-1 text-sm font-semibold">{scannerStep}</p>
                <p className="mt-0.5 text-xs text-white/65">
                  UPC lookup uses product identifiers first, then legacy
                  barcodes.
                </p>
              </div>
            )}
          </div>

          {/* Bottom toolbar */}
          <div className="bg-zinc-900 px-4 pt-4 pb-6 space-y-3">
            {cameraError && (
              <div className="flex items-start gap-2 bg-red-900/40 border border-red-700/50 rounded-xl px-3 py-2.5">
                <CameraOff className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-300">{cameraError}</p>
              </div>
            )}

            {/* Manual entry */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Keyboard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Type barcode manually…"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && manualInput.trim()) {
                      stopCamera();
                      handleScan(manualInput.trim());
                      setManualInput("");
                    }
                  }}
                  className="w-full h-11 pl-9 pr-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <button
                disabled={!manualInput.trim()}
                onClick={() => {
                  if (manualInput.trim()) {
                    stopCamera();
                    handleScan(manualInput.trim());
                    setManualInput("");
                  }
                }}
                className="w-11 h-11 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-40 flex items-center justify-center text-white transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>

            {!cameraActive && !cameraError && (
              <button
                onClick={startCamera}
                className="w-full h-11 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm transition-colors"
              >
                Start Camera
              </button>
            )}
          </div>
        </>
      )}

      {/* ─────────────── RESULT / ACTION PHASES ─────────────── */}
      {phase !== "camera" && (
        <div className="flex flex-col h-full bg-background">
          {/* Result header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
            <button
              onClick={() => {
                if (phase !== "result") {
                  setPhase("result");
                } else {
                  resetToCamera();
                }
              }}
              className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground font-medium">
                Scanned
              </p>
              <code className="text-sm font-mono font-semibold text-foreground truncate">
                {barcode}
              </code>
            </div>
            <button
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {MOBILE_SCANNER_V2_ENABLED && (
            <div className="border-b border-border bg-sky-50 px-4 py-3 text-sky-950">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Mobile scanner status
                </p>
                <p className="text-xs font-mono">{barcode || "no scan"}</p>
              </div>
              <p className="mt-1 text-sm font-semibold">{scannerStep}</p>
              <p className="mt-0.5 text-xs text-sky-800">
                Identity lookup checks normalized UPC/SKU records before legacy
                item barcodes.
              </p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {/* ── RESULT VIEW ── */}
            {phase === "result" && (
              <div className="p-4 space-y-4 max-w-lg mx-auto">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Looking up barcode…
                    </p>
                  </div>
                ) : (
                  result && (
                    <>
                      {/* FOUND IN STORE */}
                      {item && (
                        <div className="space-y-3">
                          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-emerald-700 font-semibold uppercase tracking-wide">
                                Found · {item.location}
                              </p>
                              <h2 className="font-bold text-lg leading-tight truncate">
                                {item.name}
                              </h2>
                              <p className="text-xs text-emerald-700/70">
                                {item.category}
                              </p>
                            </div>
                          </div>

                          {/* Stats */}
                          <div className="grid grid-cols-3 divide-x divide-border rounded-2xl border border-border overflow-hidden bg-card">
                            <Stat
                              label="In Store"
                              value={item.quantity}
                              alert={item.quantity <= item.parLevel}
                            />
                            <Stat
                              label="Par Level"
                              value={item.parLevel}
                              muted
                            />
                            {otherItem ? (
                              <Stat
                                label={otherItem.location}
                                value={otherItem.quantity}
                                blue
                              />
                            ) : (
                              <Stat label="Warehouse" value="—" muted />
                            )}
                          </div>

                          {/* Action grid */}
                          <div className="grid grid-cols-2 gap-2">
                            {inventoryType === "store" && (
                              <ActionBtn
                                icon={ClipboardCheck}
                                label="Verify Count"
                                primary
                                onClick={() => {
                                  setCountedQty("");
                                  setVerifyReason("adjustment");
                                  setPhase("verify");
                                }}
                              />
                            )}
                            <ActionBtn
                              icon={ArrowRightLeft}
                              label="Adjust Quantity"
                              primary={inventoryType === "warehouse"}
                              onClick={() => {
                                setAdjustQty(String(item.quantity));
                                setAdjustReason("adjustment");
                                setAdjustNotes("");
                                setPhase("adjust");
                              }}
                            />
                            <ActionBtn
                              icon={ShieldAlert}
                              label="Mark Theft"
                              onClick={() => {
                                setAdjustQty(
                                  String(Math.max(0, item.quantity - 1)),
                                );
                                setAdjustReason("theft");
                                setAdjustNotes("");
                                setPhase("adjust");
                              }}
                            />
                            <ActionBtn
                              icon={Flame}
                              label="Mark Spoilage"
                              onClick={() => {
                                setAdjustQty(
                                  String(Math.max(0, item.quantity - 1)),
                                );
                                setAdjustReason("spoilage");
                                setAdjustNotes("");
                                setPhase("adjust");
                              }}
                            />
                            <ActionBtn
                              icon={Wrench}
                              label="Mark Damaged"
                              onClick={() => {
                                setAdjustQty(
                                  String(Math.max(0, item.quantity - 1)),
                                );
                                setAdjustReason("damage");
                                setAdjustNotes("");
                                setPhase("adjust");
                              }}
                            />
                            <ActionBtn
                              icon={Package}
                              label="Return to WH"
                              onClick={() => {
                                setAdjustQty("0");
                                setAdjustReason("return_to_warehouse");
                                setAdjustNotes("");
                                setPhase("adjust");
                              }}
                            />
                          </div>

                          <button
                            onClick={resetToCamera}
                            className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground py-3 hover:text-foreground transition-colors"
                          >
                            <RotateCcw className="w-4 h-4" /> Scan another item
                          </button>
                        </div>
                      )}

                      {/* NOT IN THIS STORE — found in warehouse/other */}
                      {!item && otherItem && (
                        <div className="space-y-3">
                          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                              <AlertTriangle className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                              <p className="text-xs text-amber-700 font-semibold uppercase tracking-wide">
                                Not in {selectedLocation ?? "this store"}
                              </p>
                              <h2 className="font-bold text-lg leading-tight">
                                {otherItem.name}
                              </h2>
                              <p className="text-sm text-amber-700/80">
                                Found in {otherItem.location} ·{" "}
                                {otherItem.quantity} units available
                              </p>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground px-1">
                            Would you like to add{" "}
                            <strong>{otherItem.name}</strong> to{" "}
                            <strong>{selectedLocation ?? "this store"}</strong>?
                          </p>
                          <Button
                            className="w-full h-12 font-bold"
                            onClick={() => {
                              setAddQty("0");
                              setAddPar(String(otherItem.parLevel));
                              setAddCategory(otherItem.category);
                              setPhase("add-to-store");
                            }}
                          >
                            <PackagePlus className="w-5 h-5 mr-2" />
                            Add to {selectedLocation ?? "Store"}
                          </Button>
                          <button
                            onClick={resetToCamera}
                            className="w-full text-sm text-muted-foreground py-2 hover:text-foreground transition-colors flex items-center justify-center gap-2"
                          >
                            <RotateCcw className="w-4 h-4" /> Scan another item
                          </button>
                        </div>
                      )}

                      {/* NOT FOUND IN STORES */}
                      {!result.found && (
                        <div className="space-y-3">
                          {result.warehouseItem ? (
                            /* Found in warehouse catalog — offer to add to store */
                            <>
                              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                                  <Package className="w-5 h-5 text-blue-600" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-base text-blue-900">
                                    {result.warehouseItem.name}
                                  </p>
                                  <p className="text-sm text-blue-700">
                                    {result.warehouseItem.category}
                                  </p>
                                  <p className="text-xs text-blue-600 mt-1">
                                    Found in warehouse catalog &mdash;{" "}
                                    {result.warehouseItem.quantity} units in
                                    stock
                                  </p>
                                </div>
                              </div>
                              <Button
                                className="w-full h-12 font-bold"
                                onClick={() => {
                                  setCreateLocation(defaultCreateLocation);
                                  setCreateName(result.warehouseItem!.name);
                                  setCreateCategory(
                                    result.warehouseItem!.category,
                                  );
                                  setCreateQty("0");
                                  setCreatePar(
                                    String(result.warehouseItem!.minPar || 0),
                                  );
                                  setPhase("create");
                                }}
                              >
                                <PackagePlus className="w-5 h-5 mr-2" />
                                Add to {selectedLocation ?? "Store"}
                              </Button>
                            </>
                          ) : (
                            /* Truly unknown barcode */
                            <>
                              <div className="bg-muted border-2 border-dashed border-border rounded-2xl p-4 flex items-center gap-3">
                                <div className="w-10 h-10 bg-background rounded-xl flex items-center justify-center shrink-0 border border-border">
                                  <XCircle className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <div>
                                  <p className="font-bold text-base">
                                    Item Not Found
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    This barcode isn't in your inventory or
                                    warehouse catalog.
                                  </p>
                                </div>
                              </div>
                              <Button
                                className="w-full h-12 font-bold"
                                onClick={() => {
                                  setCreateLocation(defaultCreateLocation);
                                  setCreateName("");
                                  setCreateCategory("");
                                  setCreateQty("0");
                                  setCreatePar("0");
                                  setPhase("create");
                                }}
                              >
                                <PackagePlus className="w-5 h-5 mr-2" />
                                Create New Item
                              </Button>
                            </>
                          )}
                          <button
                            onClick={resetToCamera}
                            className="w-full text-sm text-muted-foreground py-2 hover:text-foreground transition-colors flex items-center justify-center gap-2"
                          >
                            <RotateCcw className="w-4 h-4" /> Scan another item
                          </button>
                        </div>
                      )}
                    </>
                  )
                )}
              </div>
            )}

            {/* ── VERIFY COUNT ── */}
            {phase === "verify" && item && (
              <div className="p-4 space-y-4 max-w-lg mx-auto">
                <ItemHeader item={item} label="Verifying count" />
                <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
                  <div>
                    <label className="text-sm font-semibold block mb-2">
                      Counted Quantity
                    </label>
                    <QtySpinner value={countedQty} onChange={setCountedQty} />
                  </div>
                  {countedQty !== "" &&
                    parseInt(countedQty) !== item.quantity && (
                      <div>
                        <div
                          className={`rounded-xl px-3 py-2 text-sm font-semibold mb-3 ${
                            parseInt(countedQty) < item.quantity
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          Discrepancy:{" "}
                          {parseInt(countedQty) > item.quantity ? "+" : ""}
                          {parseInt(countedQty) - item.quantity} from system
                          count
                        </div>
                        <label className="text-sm font-semibold block mb-2">
                          Reason
                        </label>
                        <ReasonGrid
                          value={verifyReason}
                          onChange={setVerifyReason}
                        />
                      </div>
                    )}
                  {countedQty !== "" &&
                    parseInt(countedQty) === item.quantity && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm font-semibold text-emerald-700">
                        ✓ Count matches — no discrepancy
                      </div>
                    )}
                </div>
                <Button
                  className="w-full h-14 text-base font-bold"
                  disabled={countedQty === "" || submitting}
                  onClick={handleVerify}
                >
                  <CheckCircle2 className="w-5 h-5 mr-2" />
                  {parseInt(countedQty) === item.quantity
                    ? "Confirm Count"
                    : "Save & Update"}
                </Button>
              </div>
            )}

            {/* ── ADJUST / REASON ── */}
            {phase === "adjust" && item && (
              <div className="p-4 space-y-4 max-w-lg mx-auto">
                <ItemHeader
                  item={item}
                  label={
                    adjustReason === "theft"
                      ? "Marking theft"
                      : adjustReason === "spoilage"
                        ? "Marking spoilage"
                        : adjustReason === "damage"
                          ? "Marking damage"
                          : adjustReason === "return_to_warehouse"
                            ? "Return to warehouse"
                            : "Adjusting quantity"
                  }
                />
                <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
                  <div>
                    <label className="text-sm font-semibold block mb-2">
                      New Quantity
                    </label>
                    <QtySpinner value={adjustQty} onChange={setAdjustQty} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold block mb-2">
                      Reason
                    </label>
                    <ReasonGrid
                      value={adjustReason}
                      onChange={setAdjustReason}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold block mb-1.5">
                      Notes (optional)
                    </label>
                    <Input
                      value={adjustNotes}
                      onChange={(e) => setAdjustNotes(e.target.value)}
                      placeholder="Add context…"
                      className="rounded-xl h-10"
                    />
                  </div>
                </div>
                <Button
                  className="w-full h-14 text-base font-bold"
                  disabled={adjustQty === "" || submitting}
                  onClick={handleAdjust}
                >
                  Save Adjustment
                </Button>
              </div>
            )}

            {/* ── ADD TO STORE ── */}
            {phase === "add-to-store" && otherItem && (
              <div className="p-4 space-y-4 max-w-lg mx-auto">
                <div className="bg-card border border-border rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">
                    Adding to {selectedLocation ?? "store"}
                  </p>
                  <h2 className="font-bold text-xl">{otherItem.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    From {otherItem.location} · {otherItem.quantity} available
                  </p>
                </div>
                <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
                  <div>
                    <label className="text-sm font-semibold block mb-2">
                      Starting Quantity
                    </label>
                    <QtySpinner value={addQty} onChange={setAddQty} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold block mb-1.5">
                      Par Level
                    </label>
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
                    <label className="text-sm font-semibold block mb-1.5">
                      Category
                    </label>
                    <Input
                      value={addCategory}
                      onChange={(e) => setAddCategory(e.target.value)}
                      className="h-11 rounded-xl"
                      placeholder={otherItem.category}
                    />
                  </div>
                </div>
                <Button
                  className="w-full h-14 text-base font-bold"
                  disabled={submitting}
                  onClick={handleAddToStore}
                >
                  <PackagePlus className="w-5 h-5 mr-2" />
                  Add to {selectedLocation ?? "Store"}
                </Button>
              </div>
            )}

            {/* ── CREATE NEW ── */}
            {phase === "create" && (
              <div className="p-4 space-y-4 max-w-lg mx-auto">
                <div className="bg-card border border-border rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">
                    New Item
                  </p>
                  <code className="text-sm font-mono text-muted-foreground">
                    {barcode}
                  </code>
                </div>
                <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
                  <div>
                    <label className="text-sm font-semibold block mb-1.5">
                      Item Name <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="e.g. Coke Zero 20 oz"
                      className="h-11 rounded-xl"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold block mb-1.5">
                      Category
                    </label>
                    <Input
                      value={createCategory}
                      onChange={(e) => setCreateCategory(e.target.value)}
                      placeholder="e.g. Soda, Snacks"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-semibold block mb-1.5">
                        Quantity
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={createQty}
                        onChange={(e) => setCreateQty(e.target.value)}
                        className="h-11 rounded-xl text-center font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold block mb-1.5">
                        Par Level
                      </label>
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
                    <label className="text-sm font-semibold block mb-2">
                      Location
                    </label>
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
                  className="w-full h-14 text-base font-bold"
                  disabled={!createName.trim() || submitting}
                  onClick={handleCreate}
                >
                  <PackagePlus className="w-5 h-5 mr-2" />
                  Create Item
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Helper sub-components ── */
function Stat({
  label,
  value,
  alert,
  muted,
  blue,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
  muted?: boolean;
  blue?: boolean;
}) {
  return (
    <div className="p-3 text-center">
      <p
        className={`text-2xl font-black tabular-nums ${alert ? "text-red-600" : muted ? "text-muted-foreground" : blue ? "text-blue-600" : "text-foreground"}`}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5 truncate">
        {label}
      </p>
    </div>
  );
}

function ItemHeader({ item, label }: { item: ItemData; label: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">
        {label}
      </p>
      <h2 className="font-bold text-xl leading-tight">{item.name}</h2>
      <p className="text-sm text-muted-foreground mt-0.5">
        {item.location} · Current:{" "}
        <strong className="text-foreground">{item.quantity}</strong> · Par:{" "}
        <strong className="text-foreground">{item.parLevel}</strong>
      </p>
    </div>
  );
}

function QtySpinner({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() =>
          onChange(String(Math.max(0, (parseInt(value) || 0) - 1)))
        }
        className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
      >
        <Minus className="w-5 h-5" />
      </button>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-12 text-center text-2xl font-black rounded-xl"
        placeholder="0"
      />
      <button
        onClick={() => onChange(String((parseInt(value) || 0) + 1))}
        className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
      >
        <Plus className="w-5 h-5" />
      </button>
    </div>
  );
}

function ReasonGrid({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ADJUST_REASONS.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={`text-xs rounded-xl px-3 py-2.5 font-medium border transition-colors text-left ${
            value === r.value
              ? "border-primary bg-primary/5 text-primary font-bold"
              : "border-border bg-card hover:border-primary/40"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  primary,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 h-13 px-4 py-3 rounded-xl border font-semibold text-sm transition-colors text-left ${
        primary
          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
          : "bg-card border-border hover:bg-muted text-foreground"
      }`}
    >
      <Icon
        className={`w-4 h-4 shrink-0 ${primary ? "text-primary-foreground" : "text-muted-foreground"}`}
      />
      {label}
    </button>
  );
}
