import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const queryClient = new QueryClient();

type OrderItem = {
  id: number;
  itemName: string;
  category: string;
  orderedQty: number;
  pickedQty: number | null;
  receivedQty: number | null;
};

type Order = {
  id: number;
  location: string;
  status: string;
  notes: string | null;
  createdAt: string;
  items: OrderItem[];
};

function groupByCategory(items: OrderItem[]) {
  const map: Record<string, OrderItem[]> = {};
  for (const item of items) {
    if (!map[item.category]) map[item.category] = [];
    map[item.category].push(item);
  }
  return map;
}

function PrintContent() {
  const [, params] = useRoute("/orders/:id/print");
  const orderId = params?.id ? parseInt(params.id) : null;

  const { data: order, isLoading } = useQuery<Order>({
    queryKey: ["order-print", orderId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/orders/${orderId}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: orderId !== null,
  });

  useEffect(() => {
    if (order) {
      document.title = `Order #${order.id} — ${order.location} — KeepTally`;
    }
  }, [order]);

  if (isLoading) return <div style={{ padding: 32 }}>Loading...</div>;
  if (!order) return <div style={{ padding: 32 }}>Order not found.</div>;

  const grouped = groupByCategory(order.items);
  const totalOrdered = order.items.reduce((s, i) => s + i.orderedQty, 0);

  const showPicked = ["sent", "picked", "received"].includes(order.status);
  const showReceived = order.status === "received";

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 700, margin: "0 auto", padding: "32px 24px", color: "#111" }}>
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th { background: #f3f4f6; text-align: left; padding: 6px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
        td { padding: 8px 10px; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
        .category-header td { background: #f9fafb; font-weight: 700; font-size: 12px; color: #374151; padding: 6px 10px; }
        .qty-cell { text-align: right; width: 70px; }
        .picked-cell { text-align: right; width: 80px; }
        .checkbox-cell { text-align: center; width: 40px; }
        .signature-line { border-top: 1px solid #111; width: 200px; display: inline-block; margin-top: 32px; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Pick List — Order #{order.id}</h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
            {order.location} &middot; {new Date(order.createdAt).toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })}
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: "#6b7280" }}>
          <div style={{ fontWeight: 600, color: "#111" }}>KeepTally</div>
          <div>{totalOrdered} total units</div>
          <div>{order.items.length} items</div>
        </div>
      </div>

      {order.notes && (
        <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13 }}>
          <strong>Notes:</strong> {order.notes}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="qty-cell" style={{ textAlign: "right" }}>Ordered</th>
            {showPicked && <th className="picked-cell" style={{ textAlign: "right" }}>Picked</th>}
            {showReceived && <th className="picked-cell" style={{ textAlign: "right" }}>Received</th>}
            {!showPicked && <th className="checkbox-cell" style={{ textAlign: "center" }}>&#10003;</th>}
          </tr>
        </thead>
        <tbody>
          {Object.entries(grouped).map(([category, items]) => (
            <>
              <tr key={`cat-${category}`} className="category-header">
                <td colSpan={showReceived ? 4 : showPicked ? 3 : 3}>{category}</td>
              </tr>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.itemName}</td>
                  <td className="qty-cell" style={{ textAlign: "right" }}>{item.orderedQty}</td>
                  {showPicked && (
                    <td className="picked-cell" style={{ textAlign: "right" }}>
                      {item.pickedQty !== null ? item.pickedQty : (
                        <span style={{ display: "inline-block", width: 50, borderBottom: "1px solid #aaa" }}>&nbsp;</span>
                      )}
                    </td>
                  )}
                  {showReceived && (
                    <td className="picked-cell" style={{ textAlign: "right" }}>
                      {item.receivedQty !== null ? item.receivedQty : "—"}
                    </td>
                  )}
                  {!showPicked && (
                    <td className="checkbox-cell" style={{ textAlign: "center" }}>
                      <span style={{ display: "inline-block", width: 16, height: 16, border: "1.5px solid #333", borderRadius: 3 }} />
                    </td>
                  )}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between" }}>
        <div>
          <div className="signature-line" />
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Warehouse Worker Signature</div>
        </div>
        <div>
          <div className="signature-line" />
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Stocker Signature</div>
        </div>
      </div>

      <div className="no-print" style={{ marginTop: 32, textAlign: "center" }}>
        <button
          onClick={() => window.print()}
          style={{
            background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8,
            padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}
        >
          Print this page
        </button>
      </div>
    </div>
  );
}

export default function OrderPrintPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrintContent />
    </QueryClientProvider>
  );
}
