import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Edit, Plus, Route, Trash2 } from "lucide-react";
import { LOCATIONS } from "@/contexts/location-context";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LIST_PAGE_SIZE = 50;

type RouteSheetSummary = {
  id: number;
  employee: string;
  routeDate: string;
  van: string;
  day: string;
  routeName: string;
  status: string;
  notes: string | null;
  stopCount: number;
  createdAt: string;
  updatedAt: string;
};

type ChecklistItem = {
  id?: number;
  itemId?: number | null;
  productName: string;
  parLevel: number;
  restockQty: number;
  notes: string;
};

type RouteStop = {
  id?: number;
  locationId?: number | null;
  routeOrder: number;
  locationName: string;
  address: string;
  contact: string;
  machineTypes: string;
  machineClean: "unchecked" | "ok" | "needs_attention";
  machineWorking: "unchecked" | "ok" | "needs_attention";
  paymentSystem: "unchecked" | "ok" | "needs_attention";
  cashCollected: number;
  cashBagNumber: string;
  meterReading: string;
  issueDescription: string;
  issuePriority: "none" | "low" | "medium" | "high" | "urgent";
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  notes: string;
  items: ChecklistItem[];
};

type RouteSheetDetail = RouteSheetSummary & {
  createdBy: string | null;
  stops: RouteStop[];
};

type RouteSheetForm = {
  id?: number;
  employee: string;
  routeDate: string;
  van: string;
  day: string;
  routeName: string;
  status: "draft" | "in_progress" | "completed";
  notes: string;
  stops: RouteStop[];
};

const today = new Date().toISOString().slice(0, 10);

function blankItem(): ChecklistItem {
  return { productName: "", parLevel: 0, restockQty: 0, notes: "" };
}

function blankStop(order: number): RouteStop {
  return {
    routeOrder: order,
    locationName: "",
    address: "",
    contact: "",
    machineTypes: "",
    machineClean: "unchecked",
    machineWorking: "unchecked",
    paymentSystem: "unchecked",
    cashCollected: 0,
    cashBagNumber: "",
    meterReading: "",
    issueDescription: "",
    issuePriority: "none",
    beforePhotoUrl: "",
    afterPhotoUrl: "",
    notes: "",
    items: [blankItem()],
  };
}

function blankSheet(): RouteSheetForm {
  return {
    employee: "",
    routeDate: today,
    van: "",
    day: "",
    routeName: "",
    status: "draft",
    notes: "",
    stops: [blankStop(1)],
  };
}

function messageFromResponse(data: unknown, fallback: string) {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "fieldErrors" in error) {
      const errors = Object.values((error as { fieldErrors: Record<string, string[]> }).fieldErrors).flat();
      return errors[0] ?? fallback;
    }
  }
  return fallback;
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 border-slate-200",
    in_progress: "bg-blue-100 text-blue-700 border-blue-200",
    completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  };
  const label = status === "in_progress" ? "In Progress" : status[0]?.toUpperCase() + status.slice(1);
  return <Badge className={`border ${classes[status] ?? classes.draft}`}>{label}</Badge>;
}

function NumberInput(props: { value: number; onChange: (value: number) => void; min?: number; className?: string }) {
  return (
    <Input
      type="number"
      min={props.min ?? 0}
      value={Number.isFinite(props.value) ? props.value : 0}
      onChange={(event) => props.onChange(Number(event.target.value) || 0)}
      className={props.className}
    />
  );
}

export default function RouteSheetsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RouteSheetForm>(blankSheet());
  const [page, setPage] = useState(1);

  const { data: sheets = [], isLoading } = useQuery<RouteSheetSummary[]>({
    queryKey: ["route-sheets"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/route-sheets`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load route sheets");
      return res.json();
    },
  });

  const sortedStops = useMemo(
    () => [...form.stops].sort((a, b) => a.routeOrder - b.routeOrder),
    [form.stops],
  );
  const totalPages = Math.max(1, Math.ceil(sheets.length / LIST_PAGE_SIZE));
  const pageStart = (page - 1) * LIST_PAGE_SIZE;
  const pageSheets = useMemo(() => sheets.slice(pageStart, pageStart + LIST_PAGE_SIZE), [sheets, pageStart]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  function updateField<K extends keyof RouteSheetForm>(key: K, value: RouteSheetForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateStop(index: number, patch: Partial<RouteStop>) {
    setForm((current) => ({
      ...current,
      stops: current.stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)),
    }));
  }

  function updateStopItem(stopIndex: number, itemIndex: number, patch: Partial<ChecklistItem>) {
    setForm((current) => ({
      ...current,
      stops: current.stops.map((stop, i) => {
        if (i !== stopIndex) return stop;
        return {
          ...stop,
          items: stop.items.map((item, j) => (j === itemIndex ? { ...item, ...patch } : item)),
        };
      }),
    }));
  }

  function addStop() {
    setForm((current) => ({ ...current, stops: [...current.stops, blankStop(current.stops.length + 1)] }));
  }

  function removeStop(index: number) {
    setForm((current) => ({ ...current, stops: current.stops.filter((_, i) => i !== index) }));
  }

  function addChecklistItem(stopIndex: number) {
    setForm((current) => ({
      ...current,
      stops: current.stops.map((stop, i) => (i === stopIndex ? { ...stop, items: [...stop.items, blankItem()] } : stop)),
    }));
  }

  function removeChecklistItem(stopIndex: number, itemIndex: number) {
    setForm((current) => ({
      ...current,
      stops: current.stops.map((stop, i) => {
        if (i !== stopIndex) return stop;
        return { ...stop, items: stop.items.filter((_, j) => j !== itemIndex) };
      }),
    }));
  }

  async function openNew() {
    setForm(blankSheet());
    setDialogOpen(true);
  }

  async function openEdit(sheet: RouteSheetSummary) {
    try {
      const res = await fetch(`${BASE}/api/route-sheets/${sheet.id}`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(messageFromResponse(data, "Could not load route sheet"));
      const detail = data as RouteSheetDetail;
      setForm({
        id: detail.id,
        employee: detail.employee,
        routeDate: detail.routeDate,
        van: detail.van,
        day: detail.day,
        routeName: detail.routeName,
        status: detail.status as RouteSheetForm["status"],
        notes: detail.notes ?? "",
        stops: detail.stops.length > 0 ? detail.stops : [blankStop(1)],
      });
      setDialogOpen(true);
    } catch (error) {
      toast({ title: "Could not open route sheet", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    }
  }

  async function saveSheet() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        stops: form.stops.map((stop, index) => ({ ...stop, routeOrder: stop.routeOrder || index + 1 })),
      };
      const res = await fetch(`${BASE}/api/route-sheets${form.id ? `/${form.id}` : ""}`, {
        method: form.id ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(messageFromResponse(data, "Could not save route sheet"));
      toast({ title: "Route sheet saved", description: `${form.routeName || "Route sheet"} is ready.` });
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["route-sheets"] });
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Route Sheets"
        description="Build ordered daily routes with stop checklists, cash, and issue notes."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> New Route Sheet</Button>}
      />

      <div className="mt-6 rounded-lg border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Van</TableHead>
              <TableHead>Stops</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Loading route sheets...</TableCell></TableRow>
            ) : sheets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-44 text-center text-muted-foreground">
                  <ClipboardList className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  No route sheets yet.
                </TableCell>
              </TableRow>
            ) : pageSheets.map((sheet) => (
              <TableRow key={sheet.id}>
                <TableCell className="font-medium">{sheet.routeName}</TableCell>
                <TableCell>{sheet.routeDate}</TableCell>
                <TableCell>{sheet.employee}</TableCell>
                <TableCell>{sheet.van || "-"}</TableCell>
                <TableCell>{sheet.stopCount}</TableCell>
                <TableCell><StatusBadge status={sheet.status} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => openEdit(sheet)}>
                    <Edit className="h-4 w-4 mr-1" /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {!isLoading && sheets.length > 0 && (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {pageStart + 1}-{Math.min(pageStart + LIST_PAGE_SIZE, sheets.length)} of {sheets.length} route sheets
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
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Route className="h-5 w-5" /> {form.id ? "Edit Route Sheet" : "New Route Sheet"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-5">
            <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Route name</span><Input value={form.routeName} onChange={(e) => updateField("routeName", e.target.value)} /></label>
            <label className="space-y-1"><span className="text-sm font-medium">Date</span><Input type="date" value={form.routeDate} onChange={(e) => updateField("routeDate", e.target.value)} /></label>
            <label className="space-y-1"><span className="text-sm font-medium">Day</span><Input value={form.day} onChange={(e) => updateField("day", e.target.value)} /></label>
            <label className="space-y-1"><span className="text-sm font-medium">Status</span><Select value={form.status} onValueChange={(value) => updateField("status", value as RouteSheetForm["status"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></label>
            <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Employee</span><Input value={form.employee} onChange={(e) => updateField("employee", e.target.value)} /></label>
            <label className="space-y-1"><span className="text-sm font-medium">Van</span><Input value={form.van} onChange={(e) => updateField("van", e.target.value)} /></label>
            <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Header notes</span><Input value={form.notes} onChange={(e) => updateField("notes", e.target.value)} /></label>
          </div>

          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Ordered Stops</h3>
              <Button variant="outline" size="sm" onClick={addStop}><Plus className="h-4 w-4 mr-1" /> Add Stop</Button>
            </div>

            {sortedStops.map((stop) => {
              const index = form.stops.indexOf(stop);
              return (
                <div key={index} className="rounded-lg border bg-slate-50 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">Stop {index + 1}</div>
                    {form.stops.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeStop(index)}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button>}
                  </div>

                  <div className="grid gap-3 md:grid-cols-6">
                    <label className="space-y-1"><span className="text-xs font-medium">Order</span><NumberInput value={stop.routeOrder} onChange={(value) => updateStop(index, { routeOrder: value })} /></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Location</span><Select value={stop.locationName || undefined} onValueChange={(value) => updateStop(index, { locationName: value })}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{LOCATIONS.map((loc) => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}</SelectContent></Select></label>
                    <label className="space-y-1 md:col-span-3"><span className="text-xs font-medium">Address</span><Input value={stop.address} onChange={(e) => updateStop(index, { address: e.target.value })} /></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Contact</span><Input value={stop.contact} onChange={(e) => updateStop(index, { contact: e.target.value })} /></label>
                    <label className="space-y-1 md:col-span-4"><span className="text-xs font-medium">Machine types</span><Input value={stop.machineTypes} onChange={(e) => updateStop(index, { machineTypes: e.target.value })} placeholder="Cooler, snack, coffee" /></label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-6">
                    <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Machine clean</span><ConditionSelect value={stop.machineClean} onChange={(value) => updateStop(index, { machineClean: value })} /></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Machine working</span><ConditionSelect value={stop.machineWorking} onChange={(value) => updateStop(index, { machineWorking: value })} /></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Payment system</span><ConditionSelect value={stop.paymentSystem} onChange={(value) => updateStop(index, { paymentSystem: value })} /></label>
                    <label className="space-y-1"><span className="text-xs font-medium">Cash collected</span><NumberInput value={stop.cashCollected} onChange={(value) => updateStop(index, { cashCollected: value })} /></label>
                    <label className="space-y-1"><span className="text-xs font-medium">Bag #</span><Input value={stop.cashBagNumber} onChange={(e) => updateStop(index, { cashBagNumber: e.target.value })} /></label>
                    <label className="space-y-1"><span className="text-xs font-medium">Meter</span><Input value={stop.meterReading} onChange={(e) => updateStop(index, { meterReading: e.target.value })} /></label>
                    <label className="space-y-1"><span className="text-xs font-medium">Priority</span><Select value={stop.issuePriority} onValueChange={(value) => updateStop(index, { issuePriority: value as RouteStop["issuePriority"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent></Select></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Before photo placeholder</span><Input value={stop.beforePhotoUrl} onChange={(e) => updateStop(index, { beforePhotoUrl: e.target.value })} placeholder="Add later" /></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">After photo placeholder</span><Input value={stop.afterPhotoUrl} onChange={(e) => updateStop(index, { afterPhotoUrl: e.target.value })} placeholder="Add later" /></label>
                    <label className="space-y-1 md:col-span-3"><span className="text-xs font-medium">Issue</span><Textarea value={stop.issueDescription} onChange={(e) => updateStop(index, { issueDescription: e.target.value })} /></label>
                    <label className="space-y-1 md:col-span-3"><span className="text-xs font-medium">Stop notes</span><Textarea value={stop.notes} onChange={(e) => updateStop(index, { notes: e.target.value })} /></label>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between"><div className="text-sm font-semibold">Inventory checklist</div><Button variant="outline" size="sm" onClick={() => addChecklistItem(index)}>Add Product</Button></div>
                    <div className="space-y-2">
                      {stop.items.map((item, itemIndex) => (
                        <div key={itemIndex} className="grid gap-2 md:grid-cols-12">
                          <Input className="md:col-span-4" placeholder="Product" value={item.productName} onChange={(e) => updateStopItem(index, itemIndex, { productName: e.target.value })} />
                          <NumberInput className="md:col-span-2" value={item.parLevel} onChange={(value) => updateStopItem(index, itemIndex, { parLevel: value })} />
                          <NumberInput className="md:col-span-2" value={item.restockQty} onChange={(value) => updateStopItem(index, itemIndex, { restockQty: value })} />
                          <Input className="md:col-span-3" placeholder="Notes" value={item.notes} onChange={(e) => updateStopItem(index, itemIndex, { notes: e.target.value })} />
                          <Button variant="ghost" size="sm" onClick={() => removeChecklistItem(index, itemIndex)}>Remove</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="mt-5">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveSheet} disabled={saving}>{saving ? "Saving..." : "Save Route Sheet"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function ConditionSelect({ value, onChange }: { value: RouteStop["machineClean"]; onChange: (value: RouteStop["machineClean"]) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as RouteStop["machineClean"])}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="unchecked">Unchecked</SelectItem>
        <SelectItem value="ok">OK</SelectItem>
        <SelectItem value="needs_attention">Needs Attention</SelectItem>
      </SelectContent>
    </Select>
  );
}
