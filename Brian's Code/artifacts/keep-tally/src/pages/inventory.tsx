import { useState, useMemo, useEffect } from "react";
import { useLocation as useWouterLocation } from "wouter";
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { useListItems, useDeleteItem, getListItemsQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectedLocation } from "@/contexts/location-context";
import { useAuth } from "@/contexts/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Search, Plus, MoreHorizontal, Edit, Trash2, Package, SlidersHorizontal, ScanLine, Upload } from "lucide-react";
import { ItemDialog } from "@/components/item-dialog";
import { AdjustmentModal } from "@/components/adjustment-modal";
import { InventoryScanner } from "@/components/inventory-scanner";
import { toast } from "@/hooks/use-toast";
import type { Item } from "@workspace/api-client-react";

const STORE_ITEMS_PAGE_SIZE = 50;

function isWarehouseLocation(location: string | null | undefined): boolean {
  const normalized = (location ?? "").trim().toLowerCase();
  return normalized === "warehouse" || normalized.endsWith(" warehouse");
}

function StockBadge({ quantity, minQuantity, maxQuantity }: { quantity: number; minQuantity: number; maxQuantity: number }) {
  if (quantity <= 0) {
    return (
      <Badge className="bg-red-100 text-red-700 border border-red-200 hover:bg-red-100 font-medium text-xs">
        Out of Stock
      </Badge>
    );
  }
  if (quantity < minQuantity) {
    return (
      <Badge className="bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-100 font-medium text-xs">
        Low Stock
      </Badge>
    );
  }
  if (maxQuantity > 0 && quantity > maxQuantity) {
    return (
      <Badge className="bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-100 font-medium text-xs">
        Overstock
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-medium text-xs">
      In Stock
    </Badge>
  );
}

export default function Inventory() {
  const { hasPermission } = useAuth();
  const [, navigate] = useWouterLocation();
  const canEditInventory = hasPermission("edit_store_inventory");
  const canAdjust = hasPermission("mark_adjustments");
  const canDelete = hasPermission("delete_items");
  const canScan = hasPermission("scan_barcodes");
  const hasAnyRowAction = canEditInventory || canAdjust || canDelete;

  const [scannerOpen, setScannerOpen] = useState(false);

  const { selectedLocation } = useSelectedLocation();
  const { data: items, isLoading } = useListItems(
    selectedLocation ? { location: selectedLocation } : undefined,
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("All");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [page, setPage] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | undefined>(undefined);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustingItem, setAdjustingItem] = useState<Item | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  const queryClient = useQueryClient();

  const deleteItem = useDeleteItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Item deleted" });
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setDeleteConfirmOpen(false);
      },
      onError: () => toast({ title: "Failed to delete item", variant: "destructive" }),
    },
  });

  const storeItems = useMemo(() => {
    return (items ?? []).filter((item) => !isWarehouseLocation(item.location));
  }, [items]);

  const categories = useMemo(() => {
    return ["All", ...Array.from(new Set(storeItems.map((i) => i.category))).sort()];
  }, [storeItems]);

  const filteredItems = useMemo(() => {
    return storeItems.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCat = filterCategory === "All" || item.category === filterCategory;
      const matchesStatus =
        filterStatus === "All" ||
        (filterStatus === "out" && item.quantity <= 0) ||
        (filterStatus === "low" && item.quantity > 0 && item.quantity < item.minQuantity) ||
        (filterStatus === "ok" && item.quantity >= item.minQuantity && (item.maxQuantity <= 0 || item.quantity <= item.maxQuantity));
      return matchesSearch && matchesCat && matchesStatus;
    });
  }, [storeItems, searchTerm, filterCategory, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / STORE_ITEMS_PAGE_SIZE));
  const pageStart = (page - 1) * STORE_ITEMS_PAGE_SIZE;
  const pageItems = filteredItems.slice(pageStart, pageStart + STORE_ITEMS_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [selectedLocation, searchTerm, filterCategory, filterStatus]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const openCreate = () => { setEditingItem(undefined); setDialogOpen(true); };
  const openEdit = (item: Item) => { setEditingItem(item); setDialogOpen(true); };
  const openAdjust = (item: Item) => { setAdjustingItem(item); setAdjustOpen(true); };
  const confirmDelete = (id: number) => { setItemToDelete(id); setDeleteConfirmOpen(true); };

  const lowCount = storeItems.filter((i) => i.quantity > 0 && i.quantity < i.minQuantity).length;
  const outCount = storeItems.filter((i) => i.quantity <= 0).length;

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          title="Store Inventory"
          description={
            items
              ? `${storeItems.length} store items · ${lowCount} low · ${outCount} out of stock`
              : "Manage and track your products"
          }
          actions={
            <div className="flex items-center gap-2">
              {canScan && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScannerOpen(true)}
                >
                  <ScanLine className="w-4 h-4 mr-1.5" />
                  Scan Barcode
                </Button>
              )}
              {canEditInventory && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(selectedLocation ? `/import?location=${encodeURIComponent(selectedLocation)}` : "/import")}
                >
                  <Upload className="w-4 h-4 mr-1.5" />
                  Import Sales
                </Button>
              )}
              {canEditInventory && (
                <Button onClick={openCreate} size="sm">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Add Item
                </Button>
              )}
            </div>
          }
        />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search items or categories…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 bg-background"
            />
          </div>
          <select
            className="h-9 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === "All" ? "All Categories" : cat}
              </option>
            ))}
          </select>
          <select
            className="h-9 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="All">All Status</option>
            <option value="out">Out of Stock</option>
            <option value="low">Low Stock</option>
            <option value="ok">In Stock</option>
          </select>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="font-semibold text-foreground">No items found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Try adjusting your search or filters.
              </p>
              {(searchTerm || filterCategory !== "All" || filterStatus !== "All") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearchTerm("");
                    setFilterCategory("All");
                    setFilterStatus("All");
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4 font-semibold text-foreground w-[35%]">Item</TableHead>
                  <TableHead className="font-semibold text-foreground">Category</TableHead>
                  <TableHead className="font-semibold text-foreground">Location</TableHead>
                  <TableHead className="font-semibold text-foreground">Status</TableHead>
                  <TableHead className="font-semibold text-foreground text-right">Qty</TableHead>
                  <TableHead className="font-semibold text-foreground text-right">Min</TableHead>
                  <TableHead className="font-semibold text-foreground text-right">Max</TableHead>
                  {hasAnyRowAction && <TableHead className="w-[80px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((item) => (
                  <TableRow key={item.id} className="group">
                    <TableCell className="pl-4 font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{item.category}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{item.location}</TableCell>
                    <TableCell>
                      <StockBadge quantity={item.quantity} minQuantity={item.minQuantity} maxQuantity={item.maxQuantity} />
                    </TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${item.quantity <= 0 ? "text-red-600" : item.quantity < item.minQuantity ? "text-amber-600" : item.maxQuantity > 0 && item.quantity > item.maxQuantity ? "text-blue-600" : ""}`}>
                      {item.quantity}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums text-sm">
                      {item.minQuantity}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums text-sm">
                      {item.maxQuantity}
                    </TableCell>
                    {hasAnyRowAction && (
                      <TableCell className="text-right pr-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canAdjust && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Adjust quantity"
                              onClick={() => openAdjust(item)}
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              {canEditInventory && (
                                <DropdownMenuItem onClick={() => openEdit(item)}>
                                  <Edit className="w-4 h-4 mr-2" /> Edit Item
                                </DropdownMenuItem>
                              )}
                              {canAdjust && (
                                <DropdownMenuItem onClick={() => openAdjust(item)}>
                                  <SlidersHorizontal className="w-4 h-4 mr-2" /> Adjust Qty
                                </DropdownMenuItem>
                              )}
                              {canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                    onClick={() => confirmDelete(item.id)}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!isLoading && filteredItems.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {pageStart + 1}-{Math.min(pageStart + STORE_ITEMS_PAGE_SIZE, filteredItems.length)} of {filteredItems.length} store items
              {storeItems.length !== (items?.length ?? 0) ? ` (${(items?.length ?? 0) - storeItems.length} warehouse items hidden)` : ""}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <span className="text-xs font-medium text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <ItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editingItem}
        defaultLocation={selectedLocation ?? undefined}
      />
      <AdjustmentModal open={adjustOpen} onOpenChange={setAdjustOpen} item={adjustingItem} />

      <InventoryScanner open={scannerOpen} onClose={() => setScannerOpen(false)} />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The item will be permanently removed from your inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (itemToDelete) deleteItem.mutate({ id: itemToDelete }); }}
              disabled={deleteItem.isPending}
            >
              {deleteItem.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
