import { useState } from "react";
import { useLocation as useWouterLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ClipboardList,
  Plus,
  MapPin,
  Package,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { LOCATIONS } from "@/contexts/location-context";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/auth-context";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type OrderView = "active" | "archived" | "completed" | "deleted" | "all";

type OrderSummary = {
  id: number;
  location: string;
  status: string;
  notes: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  itemCount: number;
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  sent: {
    label: "Sent to Warehouse",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  picked: {
    label: "Ready to Receive",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  received: {
    label: "Received",
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
};

const VIEW_TABS: { key: OrderView; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "archived", label: "Archived" },
  { key: "completed", label: "Completed" },
];

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground",
  };
  return (
    <Badge
      className={`font-medium text-xs border hover:${cfg.className} ${cfg.className}`}
    >
      {cfg.label}
    </Badge>
  );
}

export default function OrdersPage() {
  const [, navigate] = useWouterLocation();
  const { toast } = useToast();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const isAdmin = currentUser?.role === "admin";

  const [activeView, setActiveView] = useState<OrderView>("active");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newLocation, setNewLocation] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<OrderSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Archive in-flight
  const [archiving, setArchiving] = useState<number | null>(null);

  const {
    data: orders = [],
    isLoading,
    refetch,
  } = useQuery<OrderSummary[]>({
    queryKey: ["orders", activeView],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/orders?view=${activeView}`);
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });

  /* ── Create ── */
  async function handleCreateOrder() {
    if (!newLocation) return;
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: newLocation }),
      });
      if (!res.ok) throw new Error("Failed to create order");
      const order = await res.json();
      setShowNewDialog(false);
      navigate(`/orders/${order.id}`);
    } catch {
      toast({
        title: "Error",
        description: "Could not create order.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  /* ── Archive toggle ── */
  async function handleArchive(order: OrderSummary, e: React.MouseEvent) {
    e.stopPropagation();
    setArchiving(order.id);
    try {
      const res = await fetch(`${BASE}/api/orders/${order.id}/archive`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed");
      const wasArchived = order.archivedAt === null;
      toast({
        title: wasArchived ? "Pick list archived" : "Pick list restored",
        description: wasArchived
          ? `Order #${order.id} has been moved to Archived.`
          : `Order #${order.id} is now active again.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["orders"],
        refetchType: "all",
      });
    } catch {
      toast({
        title: "Error",
        description: "Could not archive order.",
        variant: "destructive",
      });
    } finally {
      setArchiving(null);
    }
  }

  /* ── Delete (admin only) ── */
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${BASE}/api/orders/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to delete");
      }
      toast({
        title: "Pick list deleted",
        description: `Order #${deleteTarget.id} has been permanently deleted.`,
      });
      setDeleteTarget(null);
      queryClient.invalidateQueries({
        queryKey: ["orders"],
        refetchType: "all",
      });
    } catch (err: unknown) {
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Could not delete order.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  const viewTabs = isAdmin
    ? [...VIEW_TABS, { key: "deleted" as OrderView, label: "Deleted" }]
    : VIEW_TABS;

  const emptyMessages: Record<OrderView, string> = {
    active: "No active pick lists. Create one to get started.",
    archived: "No archived pick lists.",
    completed: "No completed pick lists yet.",
    deleted: "No deleted pick lists.",
    all: "No pick lists found.",
  };

  return (
    <Layout>
      {isLoading ? (
        <PageSkeleton rows={6} cols={3} />
      ) : (
        <>
          <div className="space-y-5">
            <PageHeader
              title="Pick Lists"
              description="Warehouse restocking orders for your locations"
              actions={
                <Button size="sm" onClick={() => setShowNewDialog(true)}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  New Order
                </Button>
              }
            />

            {/* View tabs */}
            <div className="flex items-center gap-1 border-b border-border pb-0">
              {viewTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveView(tab.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px ${
                    activeView === tab.key
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  } ${tab.key === "deleted" ? "text-destructive hover:text-destructive" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
              <span className="ml-auto text-sm text-muted-foreground pr-1">
                {orders.length} {orders.length === 1 ? "order" : "orders"}
              </span>
            </div>

            {/* Table */}
            <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
              {orders.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <ClipboardList className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="font-semibold text-foreground">
                    No orders found
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {emptyMessages[activeView]}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="pl-4 font-semibold text-foreground w-24">
                        Order #
                      </TableHead>
                      <TableHead className="font-semibold text-foreground">
                        Status
                      </TableHead>
                      <TableHead className="font-semibold text-foreground">
                        Location
                      </TableHead>
                      <TableHead className="font-semibold text-foreground text-center">
                        Items
                      </TableHead>
                      <TableHead className="font-semibold text-foreground">
                        Created
                      </TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => {
                      const isDeleted = !!order.deletedAt;
                      const isArchived = !!order.archivedAt;
                      return (
                        <TableRow
                          key={order.id}
                          className={`cursor-pointer hover:bg-muted/40 ${
                            isDeleted
                              ? "opacity-50"
                              : isArchived
                                ? "opacity-70 bg-muted/20"
                                : ""
                          }`}
                          onClick={() =>
                            !isDeleted && navigate(`/orders/${order.id}`)
                          }
                        >
                          <TableCell className="pl-4 font-semibold text-foreground">
                            <span
                              className={
                                isDeleted
                                  ? "line-through text-muted-foreground"
                                  : ""
                              }
                            >
                              #{order.id}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <StatusBadge status={order.status} />
                              {isArchived && !isDeleted && (
                                <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200 border font-medium">
                                  Archived
                                </Badge>
                              )}
                              {isDeleted && (
                                <Badge className="text-xs bg-red-100 text-red-700 border-red-200 border font-medium">
                                  Deleted
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              {order.location}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center gap-1 text-sm font-medium">
                              <Package className="w-3.5 h-3.5 text-muted-foreground" />
                              {order.itemCount}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(order.createdAt), "MMM d, yyyy")}
                            {isArchived && order.archivedBy && !isDeleted && (
                              <div className="text-xs text-purple-600 mt-0.5">
                                Archived by {order.archivedBy}
                              </div>
                            )}
                            {isDeleted && order.deletedBy && (
                              <div className="text-xs text-red-600 mt-0.5">
                                Deleted by {order.deletedBy}
                              </div>
                            )}
                          </TableCell>
                          <TableCell
                            className="pr-2 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!isDeleted && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    disabled={archiving === order.id}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="w-48"
                                >
                                  {isArchived ? (
                                    <DropdownMenuItem
                                      onClick={(e) => handleArchive(order, e)}
                                    >
                                      <ArchiveRestore className="mr-2 h-4 w-4" />
                                      Restore to Active
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={(e) => handleArchive(order, e)}
                                    >
                                      <Archive className="mr-2 h-4 w-4" />
                                      Archive Pick List
                                    </DropdownMenuItem>
                                  )}
                                  {isAdmin && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeleteTarget(order);
                                        }}
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete Permanently
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          {/* New Order dialog */}
          <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New Pick List</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Select a location. The order will be auto-filled with all
                  items currently below par level.
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Location</label>
                  <Select value={newLocation} onValueChange={setNewLocation}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a location…" />
                    </SelectTrigger>
                    <SelectContent>
                      {LOCATIONS.map((loc) => (
                        <SelectItem key={loc} value={loc}>
                          {loc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowNewDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateOrder}
                  disabled={!newLocation || creating}
                >
                  {creating ? "Creating…" : "Create Order"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete confirmation dialog */}
          <Dialog
            open={!!deleteTarget}
            onOpenChange={(open) => !open && setDeleteTarget(null)}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Delete Pick List
                </DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete{" "}
                  <strong>Pick List #{deleteTarget?.id}</strong> for{" "}
                  <strong>{deleteTarget?.location}</strong>? This action cannot
                  be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 text-sm text-destructive">
                This pick list and all its line items will be permanently
                removed from active views. The action will be logged with your
                user, role, and timestamp.
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Delete Permanently"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </Layout>
  );
}
