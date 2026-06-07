import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { useGetRestockList } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClipboardList, Download, AlertTriangle, PackageX, CheckCircle2, Upload, Package } from "lucide-react";
import { useSelectedLocation } from "@/contexts/location-context";
import { useLocation as useWouterLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";

const LIST_PAGE_SIZE = 50;

export default function RestockPage() {
  const { hasPermission } = useAuth();
  const canImport = hasPermission("edit_store_inventory");

  const { selectedLocation } = useSelectedLocation();
  const [, navigate] = useWouterLocation();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetRestockList(
    selectedLocation ? { location: selectedLocation } : undefined,
  );

  const grouped = useMemo(() => {
    if (!data?.entries) return [];
    const map = new Map<string, typeof data.entries>();
    for (const entry of data.entries) {
      const key = entry.item.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, entries]) => ({
        category,
        entries: entries.slice().sort((a, b) => b.unitsNeeded - a.unitsNeeded),
        unitsNeeded: entries.reduce((acc, e) => acc + e.unitsNeeded, 0),
      }));
  }, [data]);

  const sortedEntries = useMemo(() => {
    return (data?.entries ?? [])
      .slice()
      .sort((a, b) => {
        const categorySort = a.item.category.localeCompare(b.item.category);
        return categorySort !== 0 ? categorySort : b.unitsNeeded - a.unitsNeeded;
      });
  }, [data]);
  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / LIST_PAGE_SIZE));
  const pageStart = (page - 1) * LIST_PAGE_SIZE;
  const pageEntries = sortedEntries.slice(pageStart, pageStart + LIST_PAGE_SIZE);
  const pageGrouped = useMemo(() => {
    const map = new Map<string, typeof pageEntries>();
    for (const entry of pageEntries) {
      const key = entry.item.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return Array.from(map.entries()).map(([category, entries]) => ({
      category,
      entries,
      unitsNeeded: entries.reduce((acc, e) => acc + e.unitsNeeded, 0),
    }));
  }, [pageEntries]);

  useEffect(() => {
    setPage(1);
  }, [selectedLocation]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const csvHref = selectedLocation
    ? `${import.meta.env.BASE_URL}api/restock.csv?location=${encodeURIComponent(selectedLocation)}`
    : `${import.meta.env.BASE_URL}api/restock.csv`;

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          title="Restock / Transfers"
          description="Items below minimum stock, with transfer quantities to refill toward maximum"
          actions={
            <div className="flex items-center gap-2">
              {canImport && (
                <Button variant="outline" size="sm" onClick={() => navigate("/import")}>
                  <Upload className="w-4 h-4 mr-1.5" />
                  Import Sales
                </Button>
              )}
              <Button size="sm" asChild disabled={!data?.entries.length}>
                <a href={csvHref} download>
                  <Download className="w-4 h-4 mr-1.5" />
                  Export CSV
                </a>
              </Button>
            </div>
          }
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Items Needed", value: data?.totalItems ?? 0, highlight: false },
            { label: "Total Units", value: data?.totalUnitsNeeded ?? 0, highlight: true },
            { label: "Categories", value: grouped.length, highlight: false },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="bg-card border border-border rounded-lg p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className={`text-3xl font-bold mt-1 tabular-nums ${highlight ? "text-primary" : ""}`}>
                {isLoading ? <Skeleton className="h-9 w-14 inline-block" /> : value}
              </p>
            </div>
          ))}
        </div>

        {/* Main content */}
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : grouped.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-12 text-center shadow-sm">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
            <h2 className="text-xl font-semibold">All stocked up!</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Every item is within its minimum and maximum stock range. Nothing to reorder right now.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {pageGrouped.map((group) => (
              <section key={group.category}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">{group.category}</h2>
                    <span className="text-xs text-muted-foreground">
                      ({group.entries.length} {group.entries.length === 1 ? "item" : "items"})
                    </span>
                  </div>
                  <Badge variant="secondary" className="font-medium text-xs">
                    {group.unitsNeeded} units needed
                  </Badge>
                </div>
                <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="pl-4 font-semibold text-foreground">Item</TableHead>
                        <TableHead className="font-semibold text-foreground">Location</TableHead>
                        <TableHead className="font-semibold text-foreground text-right">Current</TableHead>
                        <TableHead className="font-semibold text-foreground text-right">Min</TableHead>
                        <TableHead className="font-semibold text-foreground text-right">Max</TableHead>
                        <TableHead className="font-semibold text-foreground text-right pr-4">Need</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.entries.map(({ item, unitsNeeded }) => {
                        const isOut = item.quantity <= 0;
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="pl-4 font-medium text-sm">
                              <div className="flex items-center gap-2">
                                {item.name}
                                {isOut && (
                                  <Badge className="bg-red-100 text-red-700 border border-red-200 text-xs font-medium">
                                    <PackageX className="w-3 h-3 mr-1" />
                                    Out
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{item.location}</TableCell>
                            <TableCell className={`text-right font-semibold tabular-nums text-sm ${isOut ? "text-red-600" : "text-amber-600"}`}>
                              {item.quantity}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums text-sm">
                              {item.minQuantity}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums text-sm">
                              {item.maxQuantity}
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              <Badge className={`font-bold tabular-nums ${isOut ? "bg-red-600 text-white hover:bg-red-600" : "bg-amber-500 text-white hover:bg-amber-500"}`}>
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                +{unitsNeeded}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </section>
            ))}
            {sortedEntries.length > 0 && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {pageStart + 1}-{Math.min(pageStart + LIST_PAGE_SIZE, sortedEntries.length)} of {sortedEntries.length} restock items
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
          </div>
        )}
      </div>
    </Layout>
  );
}
