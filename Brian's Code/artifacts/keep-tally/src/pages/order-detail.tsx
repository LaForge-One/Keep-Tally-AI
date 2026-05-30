import { useState } from "react";
import { useRoute, useLocation as useWouterLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Printer,
  Truck,
  PackageCheck,
  CheckCircle2,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type OrderItem = {
  id: number;
  orderId: number;
  itemId: number | null;
  itemName: string;
  category: string;
  orderedQty: number;
  pickedQty: number | null;
  receivedQty: number | null;
};

type Order = {
  id: number;
  location: string;
  status: "draft" | "sent" | "picked" | "received";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent to Warehouse",
  picked: "Ready to Receive",
  received: "Received",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border",
  sent: "bg-blue-100 text-blue-800",
  picked: "bg-amber-100 text-amber-800",
  received: "bg-green-100 text-green-800",
};

function groupByCategory(items: OrderItem[]) {
  const map: Record<string, OrderItem[]> = {};
  for (const item of items) {
    if (!map[item.category]) map[item.category] = [];
    map[item.category].push(item);
  }
  return map;
}

export default function OrderDetailPage() {
  const [, params] = useRoute("/orders/:id");
  const orderId = params?.id ? parseInt(params.id) : null;
  const [, navigate] = useWouterLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editedQtys, setEditedQtys] = useState<Record<number, number>>({});
  const [pickedQtys, setPickedQtys] = useState<Record<number, number>>({});
  const [receivedQtys, setReceivedQtys] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const { data: order, isLoading, refetch } = useQuery<Order>({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/orders/${orderId}`);
      if (!res.ok) throw new Error("Order not found");
      return res.json();
    },
    enabled: orderId !== null,
  });

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  function getOrderedQty(item: OrderItem) {
    return editedQtys[item.id] ?? item.orderedQty;
  }

  function getPickedQty(item: OrderItem) {
    return pickedQtys[item.id] ?? (item.pickedQty ?? item.orderedQty);
  }

  function getReceivedQty(item: OrderItem) {
    return receivedQtys[item.id] ?? (item.receivedQty ?? item.pickedQty ?? item.orderedQty);
  }

  async function saveOrderedQty(item: OrderItem) {
    const qty = getOrderedQty(item);
    await fetch(`${BASE}/api/orders/${orderId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedQty: qty }),
    });
  }

  async function handleDeleteItem(item: OrderItem) {
    await fetch(`${BASE}/api/orders/${orderId}/items/${item.id}`, {
      method: "DELETE",
    });
    refetch();
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  }

  async function handleSendToWarehouse() {
    if (!order) return;
    setSaving(true);
    try {
      for (const item of order.items) {
        if (editedQtys[item.id] !== undefined) {
          await saveOrderedQty(item);
        }
      }
      await fetch(`${BASE}/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "sent" }),
      });
      toast({ title: "Order sent to warehouse!" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch {
      toast({ title: "Error", description: "Could not update order.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPicked() {
    if (!order) return;
    setSaving(true);
    try {
      for (const item of order.items) {
        const qty = getPickedQty(item);
        await fetch(`${BASE}/api/orders/${orderId}/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pickedQty: qty }),
        });
      }
      await fetch(`${BASE}/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "picked" }),
      });
      toast({ title: "Order marked as picked — ready for stocker!" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch {
      toast({ title: "Error", description: "Could not update order.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReceiveOrder() {
    if (!order) return;
    setSaving(true);
    try {
      const items = order.items.map((item) => ({
        id: item.id,
        receivedQty: getReceivedQty(item),
      }));
      const res = await fetch(`${BASE}/api/orders/${orderId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Failed to receive order");
      toast({ title: "Order received! Inventory updated." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    } catch {
      toast({ title: "Error", description: "Could not receive order.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    window.open(`${BASE}/orders/${orderId}/print`, "_blank");
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          Loading order...
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          Order not found.
        </div>
      </Layout>
    );
  }

  const grouped = groupByCategory(order.items);
  const isDraft = order.status === "draft";
  const isSent = order.status === "sent";
  const isPicked = order.status === "picked";
  const isReceived = order.status === "received";

  const totalOrdered = order.items.reduce((sum, i) => sum + getOrderedQty(i), 0);
  const totalPicked = order.items.reduce((sum, i) => sum + getPickedQty(i), 0);
  const totalReceived = order.items.reduce((sum, i) => sum + getReceivedQty(i), 0);

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate("/orders")}
            className="mt-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">Order #{order.id}</h1>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status]}`}
              >
                {STATUS_LABELS[order.status]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {order.location} &middot; {new Date(order.createdAt).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handlePrint} className="shrink-0">
            <Printer className="w-4 h-4 mr-1" />
            Print
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Ordered</p>
            <p className="text-xl font-bold mt-0.5">{totalOrdered}</p>
            <p className="text-xs text-muted-foreground">units</p>
          </div>
          {(isSent || isPicked || isReceived) && (
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Picked</p>
              <p className="text-xl font-bold mt-0.5">{totalPicked}</p>
              <p className="text-xs text-muted-foreground">units</p>
            </div>
          )}
          {isReceived && (
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Received</p>
              <p className="text-xl font-bold mt-0.5">{totalReceived}</p>
              <p className="text-xs text-muted-foreground">units</p>
            </div>
          )}
        </div>

        {isDraft && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
            <strong>Manager:</strong> Review and adjust quantities below, then send to the warehouse.
          </div>
        )}
        {isSent && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <strong>Warehouse:</strong> Update picked quantities for anything you couldn&apos;t fulfill, then mark as picked.
          </div>
        )}
        {isPicked && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
            <strong>Stocker:</strong> Confirm what you received. Inventory will be updated automatically.
          </div>
        )}

        <div className="space-y-3">
          {Object.entries(grouped).map(([category, items]) => {
            const collapsed = collapsedCategories[category];
            return (
              <div key={category} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <span className="font-semibold text-sm text-foreground">{category}</span>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-xs">{items.length} item{items.length !== 1 ? "s" : ""}</span>
                    {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </div>
                </button>

                {!collapsed && (
                  <div className="divide-y divide-border">
                    <div className="grid gap-2 px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                      style={{ gridTemplateColumns: isDraft ? "1fr auto auto" : isSent ? "1fr auto auto" : isPicked ? "1fr auto auto" : "1fr auto auto auto" }}
                    >
                      <span>Item</span>
                      <span className="text-right">Ordered</span>
                      {isSent && <span className="text-right w-20">Picked</span>}
                      {isPicked && <span className="text-right w-20">Received</span>}
                      {isReceived && <>
                        <span className="text-right">Picked</span>
                        <span className="text-right">Received</span>
                      </>}
                      {isDraft && <span className="w-8" />}
                    </div>

                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="grid items-center gap-2 px-4 py-3"
                        style={{ gridTemplateColumns: isDraft ? "1fr auto auto" : isSent ? "1fr auto auto" : isPicked ? "1fr auto auto" : "1fr auto auto auto" }}
                      >
                        <span className="text-sm font-medium truncate">{item.itemName}</span>

                        {isDraft ? (
                          <>
                            <Input
                              type="number"
                              min={0}
                              className="w-16 h-8 text-right text-sm"
                              value={getOrderedQty(item)}
                              onChange={(e) =>
                                setEditedQtys((prev) => ({
                                  ...prev,
                                  [item.id]: parseInt(e.target.value) || 0,
                                }))
                              }
                            />
                            <button
                              onClick={() => handleDeleteItem(item)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        ) : isSent ? (
                          <>
                            <span className="text-sm text-right text-muted-foreground">{item.orderedQty}</span>
                            <Input
                              type="number"
                              min={0}
                              className="w-20 h-8 text-right text-sm"
                              value={getPickedQty(item)}
                              onChange={(e) =>
                                setPickedQtys((prev) => ({
                                  ...prev,
                                  [item.id]: parseInt(e.target.value) || 0,
                                }))
                              }
                            />
                          </>
                        ) : isPicked ? (
                          <>
                            <span className="text-sm text-right text-muted-foreground">{item.pickedQty ?? item.orderedQty}</span>
                            <Input
                              type="number"
                              min={0}
                              className="w-20 h-8 text-right text-sm"
                              value={getReceivedQty(item)}
                              onChange={(e) =>
                                setReceivedQtys((prev) => ({
                                  ...prev,
                                  [item.id]: parseInt(e.target.value) || 0,
                                }))
                              }
                            />
                          </>
                        ) : (
                          <>
                            <span className="text-sm text-right text-muted-foreground">{item.orderedQty}</span>
                            <span className="text-sm text-right text-muted-foreground">{item.pickedQty ?? "—"}</span>
                            <span className="text-sm text-right font-medium text-green-700">{item.receivedQty ?? "—"}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {order.items.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              No items in this order.
            </div>
          )}
        </div>

        {!isReceived && (
          <div className="pt-2 pb-4">
            {isDraft && (
              <Button
                className="w-full"
                size="lg"
                onClick={handleSendToWarehouse}
                disabled={saving || order.items.length === 0}
              >
                <Truck className="w-4 h-4 mr-2" />
                {saving ? "Sending..." : "Send to Warehouse"}
              </Button>
            )}
            {isSent && (
              <Button
                className="w-full"
                size="lg"
                onClick={handleMarkPicked}
                disabled={saving}
              >
                <PackageCheck className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Mark as Picked"}
              </Button>
            )}
            {isPicked && (
              <Button
                className="w-full"
                size="lg"
                onClick={handleReceiveOrder}
                disabled={saving}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {saving ? "Receiving..." : "Receive Order"}
              </Button>
            )}
          </div>
        )}

        {isReceived && (
          <div className="flex items-center justify-center gap-2 py-4 text-green-700 font-medium">
            <CheckCircle2 className="w-5 h-5" />
            Order received &mdash; inventory updated
          </div>
        )}
      </div>
    </Layout>
  );
}
