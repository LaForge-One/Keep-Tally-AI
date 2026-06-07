import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation as useWouterLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { InventoryScanner } from "@/components/inventory-scanner";
import { useAuth } from "@/contexts/auth-context";
import { NoPermissionPage } from "@/components/permission-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Warehouse,
  Plus,
  Search,
  Download,
  Upload,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Package,
  Filter,
  MoreVertical,
  Edit,
  Trash2,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  DollarSign,
  Mic,
  ScanLine,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VENDORS = [
  "Costco",
  "Sam's Club",
  "Vistar",
  "Walmart",
  "Pepsi Corp",
  "Other",
];

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
  status: "ok" | "low" | "out" | "overstock" | "reorder";
};

type DashboardData = {
  total: number;
  low: number;
  out: number;
  overstock: number;
  reorder: number;
};

function statusBadge(status: WarehouseItem["status"]) {
  switch (status) {
    case "out":
      return (
        <Badge className="bg-red-600 text-white text-[10px] shrink-0">
          Out
        </Badge>
      );
    case "low":
      return (
        <Badge className="bg-orange-500 text-white text-[10px] shrink-0">
          Low
        </Badge>
      );
    case "reorder":
      return (
        <Badge className="bg-yellow-500 text-white text-[10px] shrink-0">
          Reorder
        </Badge>
      );
    case "overstock":
      return (
        <Badge className="bg-blue-600 text-white text-[10px] shrink-0">
          Overstock
        </Badge>
      );
    default:
      return null;
  }
}

function ItemFormDialog({
  open,
  onClose,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item?: WarehouseItem | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const emptyForm = {
    name: "",
    barcode: "",
    category: "Uncategorized",
    quantity: "0",
    minPar: "0",
    maxPar: "0",
    reorderPoint: "0",
    caseCost: "",
    unitsPerCase: "1",
    costPerUnit: "",
    lastPurchaseDate: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: item?.name ?? "",
      barcode: item?.barcode ?? "",
      category: item?.category ?? "Uncategorized",
      quantity: String(item?.quantity ?? 0),
      minPar: String(item?.minPar ?? 0),
      maxPar: String(item?.maxPar ?? 0),
      reorderPoint: String(item?.reorderPoint ?? 0),
      caseCost: item?.caseCost != null ? String(item.caseCost) : "",
      unitsPerCase: String(item?.unitsPerCase ?? 1),
      costPerUnit: item?.costPerUnit != null ? String(item.costPerUnit) : "",
      lastPurchaseDate: item?.lastPurchaseDate ?? "",
    });
  }, [item, open]);

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (
        (field === "caseCost" || field === "unitsPerCase") &&
        next.caseCost &&
        next.unitsPerCase
      ) {
        const caseCost = Number(next.caseCost);
        const unitsPerCase = Number.parseInt(next.unitsPerCase, 10);
        if (
          Number.isFinite(caseCost) &&
          Number.isInteger(unitsPerCase) &&
          unitsPerCase > 0
        ) {
          next.costPerUnit = (caseCost / unitsPerCase).toFixed(4);
        }
      }
      return next;
    });
  }

  function parseInteger(value: string, label: string, min = 0): number | null {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < min) {
      toast({
        title: "Invalid value",
        description: `${label} must be a whole number ${min > 0 ? `>= ${min}` : ">= 0"}.`,
        variant: "destructive",
      });
      return null;
    }
    return parsed;
  }

  function parseMoney(value: string, label: string): number | null | undefined {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast({
        title: "Invalid value",
        description: `${label} must be a number >= 0.`,
        variant: "destructive",
      });
      return undefined;
    }
    return parsed;
  }

  async function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    const quantity = parseInteger(form.quantity, "Quantity");
    const minPar = parseInteger(form.minPar, "Minimum quantity");
    const maxPar = parseInteger(form.maxPar, "Maximum quantity");
    const reorderPoint = parseInteger(form.reorderPoint, "Reorder point");
    const unitsPerCase = parseInteger(form.unitsPerCase, "Units per case", 1);
    const caseCost = parseMoney(form.caseCost, "Case cost");
    const costPerUnit = parseMoney(form.costPerUnit, "Unit cost");

    if (
      quantity === null ||
      minPar === null ||
      maxPar === null ||
      reorderPoint === null ||
      unitsPerCase === null ||
      caseCost === undefined ||
      costPerUnit === undefined
    )
      return;

    setSubmitting(true);
    try {
      const body = {
        name,
        barcode: form.barcode.trim() || null,
        category: form.category.trim() || "Uncategorized",
        quantity,
        minPar,
        maxPar,
        reorderPoint,
        caseCost,
        unitsPerCase,
        costPerUnit,
        lastPurchaseDate: form.lastPurchaseDate || null,
      };
      const url = item
        ? `${BASE}/api/warehouse/${item.id}`
        : `${BASE}/api/warehouse`;
      const method = item ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err, "Save failed"));
      }
      toast({ title: item ? "Item updated" : "Item created" });
      onSaved();
      onClose();
    } catch (err) {
      toast({
        title: "Error saving item",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const field = (
    label: string,
    key: keyof typeof form,
    opts?: { type?: string; placeholder?: string; min?: string; step?: string },
  ) => (
    <div>
      <label className="text-xs font-semibold text-muted-foreground block mb-1">
        {label}
      </label>
      <Input
        type={opts?.type ?? "text"}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={opts?.placeholder}
        min={opts?.min}
        step={opts?.step}
        className="h-10 rounded-xl"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Item" : "New Warehouse Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {field("Item Name *", "name", { placeholder: "e.g. Coke Zero 20oz" })}
          <div className="grid grid-cols-2 gap-3">
            {field("Item # / UPC", "barcode", { placeholder: "012345678901" })}
            {field("Category", "category", { placeholder: "Soda, Snacks" })}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {field("Qty / Hand", "quantity", {
              type: "number",
              min: "0",
              step: "1",
            })}
            {field("Min", "minPar", { type: "number", min: "0", step: "1" })}
            {field("Max", "maxPar", { type: "number", min: "0", step: "1" })}
          </div>
          {field("Reorder Point", "reorderPoint", {
            type: "number",
            min: "0",
            step: "1",
            placeholder: "Trigger reorder at this qty",
          })}
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              Pricing
            </p>
            <div className="grid grid-cols-2 gap-3">
              {field("Case Cost ($)", "caseCost", {
                type: "number",
                min: "0",
                step: "0.01",
                placeholder: "0.00",
              })}
              {field("Units Per Case", "unitsPerCase", {
                type: "number",
                min: "1",
                step: "1",
                placeholder: "1",
              })}
            </div>
            {field("Unit Cost ($)", "costPerUnit", {
              type: "number",
              min: "0",
              step: "0.0001",
              placeholder: "Auto-calculated",
            })}
            {field("Last Purchase Date", "lastPurchaseDate", { type: "date" })}
          </div>
          <Button
            className="w-full h-11 rounded-xl font-bold"
            disabled={!form.name.trim() || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Saving..." : item ? "Save Changes" : "Create Item"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
type ApiErrorPayload = { error?: unknown };

function apiErrorMessage(payload: ApiErrorPayload, fallback: string): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybe = error as {
      formErrors?: unknown;
      fieldErrors?: Record<string, unknown>;
    };
    if (
      Array.isArray(maybe.formErrors) &&
      typeof maybe.formErrors[0] === "string"
    )
      return maybe.formErrors[0];
    if (maybe.fieldErrors) {
      for (const value of Object.values(maybe.fieldErrors)) {
        if (Array.isArray(value) && typeof value[0] === "string")
          return value[0];
      }
    }
  }
  return fallback;
}
/* ── CSV Import Dialog ── */
function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    preview: object[];
    detected: Record<string, string | null>;
    totalRows: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [mode, setMode] = useState<"upsert" | "insert">("upsert");

  async function handlePreview() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/api/warehouse/import/preview`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err, "Preview failed"));
      }
      setPreview(await res.json());
    } catch (err) {
      toast({
        title: "Error parsing CSV",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setApplying(true);
    try {
      const res = await fetch(`${BASE}/api/warehouse/import/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: preview.preview, mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err, "Apply failed"));
      }
      const result = await res.json();
      toast({
        title: `Imported: ${result.inserted} new, ${result.updated} updated`,
      });
      onImported();
      onClose();
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" /> Import Warehouse CSV
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {!preview ? (
            <>
              <div
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${file ? "border-emerald-400 bg-emerald-50" : "border-border hover:border-primary/40"}`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div>
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1" />
                    <p className="font-semibold text-sm">{file.name}</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto mb-1" />
                    <p className="text-sm text-muted-foreground">
                      Click to upload CSV
                    </p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["upsert", "insert"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded-xl px-3 py-2.5 text-xs font-medium border text-left transition-colors ${mode === m ? "border-primary bg-primary/5 text-primary font-bold" : "border-border bg-card"}`}
                  >
                    <p className="font-bold">
                      {m === "upsert" ? "Insert + Update" : "Insert Only"}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {m === "upsert"
                        ? "Update existing items by barcode"
                        : "Only add new items"}
                    </p>
                  </button>
                ))}
              </div>
              <Button
                className="w-full h-11 rounded-xl font-bold"
                disabled={!file || uploading}
                onClick={handlePreview}
              >
                {uploading ? "Parsing…" : "Preview Import"}
              </Button>
            </>
          ) : (
            <>
              <div className="bg-muted/30 rounded-xl p-3 text-sm space-y-1">
                <p>
                  <strong>{(preview.preview as object[]).length}</strong> rows
                  ready to import
                  {preview.totalRows > (preview.preview as object[]).length
                    ? ` (${preview.totalRows} in file, ${preview.totalRows - (preview.preview as object[]).length} blank/skipped)`
                    : ""}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {Object.entries(preview.detected)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <span key={k}>
                        <strong>{k}:</strong> "{v}"
                      </span>
                    ))}
                </div>
              </div>
              <div className="border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      {["Name", "Cat", "Qty", "Min", "Max", "$/Unit"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-2 py-1.5 text-left font-semibold"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(
                      preview.preview as Array<{
                        name: string;
                        category: string;
                        quantity: number;
                        minPar: number;
                        maxPar: number;
                        costPerUnit: number | null;
                      }>
                    ).map((row, i) => (
                      <tr key={i} className="hover:bg-muted/10">
                        <td className="px-2 py-1 truncate max-w-[100px]">
                          {row.name}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {row.category}
                        </td>
                        <td className="px-2 py-1">{row.quantity}</td>
                        <td className="px-2 py-1">{row.minPar}</td>
                        <td className="px-2 py-1">{row.maxPar}</td>
                        <td className="px-2 py-1">
                          {row.costPerUnit != null
                            ? `$${Number(row.costPerUnit).toFixed(2)}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-11 rounded-xl"
                  onClick={() => setPreview(null)}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 h-11 rounded-xl font-bold"
                  disabled={applying}
                  onClick={handleApply}
                >
                  {applying
                    ? "Importing…"
                    : `Import ${(preview.preview as object[]).length} Items`}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Page ── */
export default function WarehousePage() {
  const { hasPermission } = useAuth();
  const canViewWarehouse = hasPermission("view_warehouse");
  const canEditWarehouse = hasPermission("edit_warehouse");
  const canDeleteItems = hasPermission("delete_items");
  const canViewCosts = hasPermission("view_costs");
  const canUseVoice = hasPermission("use_voice_mode");
  const canScan = hasPermission("scan_barcodes");

  const [, navigate] = useWouterLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [editItem, setEditItem] = useState<WarehouseItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<WarehouseItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, statusFilter, pageSize]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "warehouse",
      search,
      categoryFilter,
      statusFilter,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`${BASE}/api/warehouse?${params}`);
      return res.json() as Promise<{
        items: WarehouseItem[];
        total: number;
        categories: string[];
      }>;
    },
    placeholderData: (prev) => prev,
  });

  const { data: dashboard } = useQuery({
    queryKey: ["warehouse-dashboard"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/warehouse/dashboard`);
      return res.json() as Promise<DashboardData>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/warehouse/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Item deleted" });
      queryClient.invalidateQueries({ queryKey: ["warehouse"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-dashboard"] });
      setDeleteItem(null);
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const categories = data?.categories ?? [];

  const totalPages = pageSize === 0 ? 1 : Math.ceil(total / pageSize);

  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["warehouse"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-dashboard"] });
  }, [queryClient]);

  const csvHref = `${BASE}/api/warehouse/export/csv`;
  const reorderHref = `${BASE}/api/warehouse/reorder/csv`;

  if (!canViewWarehouse) {
    return (
      <Layout>
        <NoPermissionPage message="You do not have permission to view warehouse inventory." />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5 pb-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
              <Warehouse className="w-7 h-7 text-primary" />
              Warehouse
            </h1>
            <p className="text-muted-foreground mt-0.5">
              Central inventory before it reaches the stores
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-xl">
                  <Download className="w-4 h-4 mr-1.5" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={csvHref} download>
                    Full Inventory CSV
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={reorderHref} download>
                    Reorder List CSV
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canScan && canEditWarehouse && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setScannerOpen(true)}
              >
                <ScanLine className="w-4 h-4 mr-1.5" />
                Scan Barcode
              </Button>
            )}
            {canEditWarehouse && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setShowImport(true)}
              >
                <Upload className="w-4 h-4 mr-1.5" />
                Import
              </Button>
            )}
            {canViewCosts && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => navigate("/warehouse/purchases")}
              >
                <DollarSign className="w-4 h-4 mr-1.5" />
                Purchases
              </Button>
            )}
            {canUseVoice && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-primary/40 text-primary hover:bg-primary/5 font-semibold"
                onClick={() => navigate("/warehouse/voice")}
              >
                <Mic className="w-4 h-4 mr-1.5" />
                Tally
              </Button>
            )}
            {canEditWarehouse && (
              <Button
                size="sm"
                className="rounded-xl font-bold"
                onClick={() => setShowNewDialog(true)}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Item
              </Button>
            )}
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-5 gap-2">
          {[
            {
              label: "Total SKUs",
              value: dashboard?.total ?? "—",
              color: "bg-card",
              filter: "",
            },
            {
              label: "Low Stock",
              value: dashboard?.low ?? 0,
              color: "bg-orange-50 border-orange-200",
              filter: "low",
            },
            {
              label: "Out of Stock",
              value: dashboard?.out ?? 0,
              color: "bg-red-50 border-red-200",
              filter: "out",
            },
            {
              label: "Overstock",
              value: dashboard?.overstock ?? 0,
              color: "bg-blue-50 border-blue-200",
              filter: "overstock",
            },
            {
              label: "Reorder",
              value: dashboard?.reorder ?? 0,
              color: "bg-yellow-50 border-yellow-200",
              filter: "reorder",
            },
          ].map((stat) => (
            <button
              key={stat.label}
              onClick={() =>
                setStatusFilter(statusFilter === stat.filter ? "" : stat.filter)
              }
              className={`border rounded-xl p-2.5 text-center transition-all ${stat.color} ${statusFilter === stat.filter ? "ring-2 ring-primary" : "hover:opacity-80"}`}
            >
              <p className="text-xl font-black">{stat.value}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {stat.label}
              </p>
            </button>
          ))}
        </div>

        {/* Showing X of Y + Page size selector */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p
            className={`text-sm transition-opacity ${isFetching ? "opacity-50" : ""}`}
          >
            {isLoading ? (
              <span className="skeleton-shimmer inline-block h-4 w-28" />
            ) : (
              <span>
                <span className="font-semibold">
                  {items.length === total
                    ? total
                    : `${items.length} of ${total}`}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  warehouse items{statusFilter ? ` (${statusFilter})` : ""}
                </span>
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Show:</span>
            {([50, 100, 250, 500, 0] as const).map((size) => (
              <button
                key={size}
                onClick={() => setPageSize(size)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                  pageSize === size
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                {size === 0 ? "All" : size}
              </button>
            ))}
          </div>
        </div>

        {/* Search + Filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, barcode, or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 rounded-xl"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Status filter pill */}
        {statusFilter && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Showing:</span>
            <button
              onClick={() => setStatusFilter("")}
              className="flex items-center gap-1 text-sm font-medium text-primary bg-primary/10 px-3 py-1 rounded-full"
            >
              {statusFilter} <XCircle className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>
        )}

        {/* Items List */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-xl h-16 animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-12 text-center">
            <Warehouse className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-semibold text-muted-foreground">
              No warehouse items
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Add items manually or import from CSV
            </p>
            <Button
              className="mt-4 rounded-xl"
              onClick={() => setShowNewDialog(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add First Item
            </Button>
          </div>
        ) : (
          <div
            className={`bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border transition-opacity ${isFetching ? "opacity-60" : ""}`}
          >
            {items.map((item) => {
              const needUnits =
                item.quantity < item.minPar ? item.minPar - item.quantity : 0;
              return (
                <div
                  key={item.id}
                  onClick={() => navigate(`/warehouse/${item.id}`)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer ${
                    item.status === "out"
                      ? "bg-red-50/40"
                      : item.status === "low"
                        ? "bg-orange-50/30"
                        : item.status === "overstock"
                          ? "bg-blue-50/20"
                          : ""
                  }`}
                >
                  {/* Left: status indicator */}
                  <div
                    className={`w-1.5 h-10 rounded-full shrink-0 ${
                      item.status === "out"
                        ? "bg-red-500"
                        : item.status === "low"
                          ? "bg-orange-500"
                          : item.status === "reorder"
                            ? "bg-yellow-500"
                            : item.status === "overstock"
                              ? "bg-blue-500"
                              : "bg-emerald-400"
                    }`}
                  />

                  {/* Name + category */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm leading-tight truncate">
                        {item.name}
                      </p>
                      {statusBadge(item.status)}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.category}
                      {item.barcode && (
                        <span className="font-mono ml-2 opacity-60">
                          {item.barcode}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Qty stats */}
                  <div className="text-right shrink-0">
                    <p
                      className={`text-lg font-black leading-none ${
                        item.status === "out"
                          ? "text-red-600"
                          : item.status === "low"
                            ? "text-orange-600"
                            : item.status === "overstock"
                              ? "text-blue-600"
                              : "text-foreground"
                      }`}
                    >
                      {item.quantity}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {item.minPar}–{item.maxPar > 0 ? item.maxPar : "∞"}
                    </p>
                    {needUnits > 0 && (
                      <p className="text-[10px] text-orange-600 font-semibold">
                        Need {needUnits}
                      </p>
                    )}
                  </div>

                  {/* Cost */}
                  {canViewCosts && item.costPerUnit != null && (
                    <div className="text-right shrink-0 w-14">
                      <p className="text-xs font-semibold">
                        ${item.costPerUnit.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">/unit</p>
                    </div>
                  )}

                  {/* Actions */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground shrink-0"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/warehouse/${item.id}`);
                        }}
                      >
                        <Package className="w-4 h-4 mr-2" />
                        View Detail
                      </DropdownMenuItem>
                      {canEditWarehouse && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditItem(item);
                          }}
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {canDeleteItems && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteItem(item);
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0 -ml-1" />
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {!isLoading && pageSize !== 0 && totalPages > 1 && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Page <span className="font-semibold">{page}</span> of{" "}
              <span className="font-semibold">{totalPages}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl h-8 px-3"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage(1)}
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl h-8 w-8 p-0"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              {/* Page number pills */}
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 7) {
                  p = i + 1;
                } else if (page <= 4) {
                  p = i + 1;
                } else if (page >= totalPages - 3) {
                  p = totalPages - 6 + i;
                } else {
                  p = page - 3 + i;
                }
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    disabled={isFetching}
                    className={`h-8 min-w-[2rem] px-2 rounded-lg text-sm font-medium border transition-colors ${
                      p === page
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}

              <Button
                variant="outline"
                size="sm"
                className="rounded-xl h-8 w-8 p-0"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl h-8 px-3"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage(totalPages)}
              >
                Last
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ItemFormDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onSaved={refetchAll}
      />
      <ItemFormDialog
        open={!!editItem}
        onClose={() => setEditItem(null)}
        item={editItem}
        onSaved={refetchAll}
      />
      <ImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={refetchAll}
      />
      <InventoryScanner
        inventoryType="warehouse"
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
      />

      <AlertDialog
        open={!!deleteItem}
        onOpenChange={(o) => !o && setDeleteItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteItem?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the item and all its purchase history from the
              warehouse. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
