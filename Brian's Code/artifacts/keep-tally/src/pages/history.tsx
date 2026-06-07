import { useState, useMemo, useEffect } from "react";
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { useListHistory } from "@workspace/api-client-react";
import { format } from "date-fns";
import { TerminalSquare, MousePointerClick, ArrowRight, History, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  create: { label: "Create", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  update: { label: "Update", className: "bg-blue-100 text-blue-700 border-blue-200" },
  adjust: { label: "Adjust", className: "bg-purple-100 text-purple-700 border-purple-200" },
  command: { label: "Command", className: "bg-sky-100 text-sky-700 border-sky-200" },
  delete: { label: "Delete", className: "bg-red-100 text-red-700 border-red-200" },
};

const LIST_PAGE_SIZE = 50;

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CONFIG[action] ?? { label: action, className: "bg-muted text-muted-foreground border-border" };
  return (
    <Badge className={`capitalize font-medium text-xs border hover:${cfg.className} ${cfg.className}`}>
      {cfg.label}
    </Badge>
  );
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  warehouse: "Warehouse",
  stocker: "Stocker",
};

type HistoryEntry = {
  id: number;
  itemName?: string | null;
  action: string;
  field?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  note?: string | null;
  source?: string | null;
  createdAt: string | Date;
  performedBy?: string | null;
  performedByRole?: string | null;
  location?: string | null;
};

export default function HistoryPage() {
  const { data: history, isLoading } = useListHistory();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const entries = (history ?? []) as HistoryEntry[];
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.itemName?.toLowerCase().includes(q) ||
        e.performedBy?.toLowerCase().includes(q) ||
        e.action?.toLowerCase().includes(q) ||
        e.location?.toLowerCase().includes(q),
    );
  }, [history, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pageStart = (page - 1) * LIST_PAGE_SIZE;
  const pageEntries = filtered.slice(pageStart, pageStart + LIST_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          title="Audit Log"
          description="Chronological history of all inventory changes"
          actions={
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search log…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 bg-background"
              />
            </div>
          }
        />

        <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : !filtered || filtered.length === 0 ? (
            <div className="text-center py-16 px-4">
              <History className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="font-semibold text-foreground">
                {search ? "No matching entries" : "No history yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {search ? "Try a different search term." : "Changes you make will appear here."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4 font-semibold text-foreground w-36">Time</TableHead>
                  <TableHead className="font-semibold text-foreground w-24">Action</TableHead>
                  <TableHead className="font-semibold text-foreground">Item</TableHead>
                  <TableHead className="font-semibold text-foreground">Change</TableHead>
                  <TableHead className="font-semibold text-foreground">User</TableHead>
                  <TableHead className="font-semibold text-foreground">Location</TableHead>
                  <TableHead className="w-10 text-center font-semibold text-foreground" title="Source">Src</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="pl-4 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {format(new Date(entry.createdAt), "MMM d, h:mm a")}
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={entry.action} />
                    </TableCell>
                    <TableCell className="font-medium text-sm max-w-[180px] truncate">
                      {entry.itemName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.field && entry.action !== "create" && entry.action !== "delete" ? (
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className="capitalize font-medium text-foreground">{entry.field}:</span>
                          <span className="line-through opacity-60 text-xs">{entry.previousValue || "none"}</span>
                          <ArrowRight className="w-3 h-3 opacity-50 shrink-0" />
                          <span className="font-semibold text-foreground bg-muted px-1 rounded text-xs">
                            {entry.newValue}
                          </span>
                        </span>
                      ) : entry.note ? (
                        <span className="italic text-muted-foreground text-xs truncate max-w-[200px] block">
                          "{entry.note}"
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.performedBy ? (
                        <span className="text-foreground font-medium">
                          {entry.performedBy}
                          {entry.performedByRole && (
                            <span className="text-muted-foreground font-normal ml-1 text-xs">
                              ({ROLE_LABELS[entry.performedByRole] ?? entry.performedByRole})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.location ? (
                        <span className="bg-muted text-foreground text-xs px-1.5 py-0.5 rounded font-medium">
                          {entry.location}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {entry.source === "command" ? (
                        <span title="AI Command">
                          <TerminalSquare className="w-3.5 h-3.5 text-primary mx-auto" />
                        </span>
                      ) : (
                        <span title="UI">
                          <MousePointerClick className="w-3.5 h-3.5 text-muted-foreground mx-auto" />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!isLoading && filtered.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {pageStart + 1}-{Math.min(pageStart + LIST_PAGE_SIZE, filtered.length)} of {filtered.length} entries
              {search ? ` (${history?.length ?? 0} total)` : ""}
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
    </Layout>
  );
}
