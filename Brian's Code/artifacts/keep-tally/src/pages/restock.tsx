import { useMemo } from "react";
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

export default function RestockPage() {
  const { hasPermission } = useAuth();
  const canImport = hasPermission("edit_store_inventory");

  const { selectedLocation } = useSelectedLocation();
  const [, navigate] = useWouterLocation();
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

  const csvHref = selectedLocation
    ? `${import.meta.env.BASE_URL}api/restock.csv?location=${encodeURIComponent(selectedLocation)}`
    : `${import.meta.env.BASE_URL}api/restock.csv`;

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          title="Restock / Transfers"
          description="Items at or below par level — ready for your next supplier order"
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
              Every item is at or above its par level. Nothing to reorder right now.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
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
                        <TableHead className="font-semibold text-foreground text-right">Par</TableHead>
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
                              {item.parLevel}
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
          </div>
        )}
      </div>
    </Layout>
  );
}
