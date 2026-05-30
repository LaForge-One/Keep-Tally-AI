import { useState, useEffect } from "react";
import { Minus, Plus, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { getListItemsQueryKey, getGetDashboardSummaryQueryKey, getListHistoryQueryKey } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import type { Item } from "@workspace/api-client-react";

const ADJUSTMENT_TYPES = [
  "Adjustment",
  "Spoilage",
  "Theft",
  "Comp",
  "Return to Warehouse",
] as const;

type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

interface AdjustmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Item | null;
}

export function AdjustmentModal({ open, onOpenChange, item }: AdjustmentModalProps) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(0);
  const [verified, setVerified] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (open && item) {
      setQuantity(item.quantity);
      setVerified(false);
      setAdjustmentType(null);
    }
  }, [open, item]);

  const decrement = () => setQuantity((q) => Math.max(0, q - 1));
  const increment = () => setQuantity((q) => q + 1);

  const handleConfirm = async () => {
    if (!item || !adjustmentType) return;
    setIsPending(true);
    try {
      const res = await fetch(`/api/items/${item.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, adjustmentType, verified }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to adjust");
      }
      toast({ title: "Quantity updated", description: `${item.name} → ${quantity} (${adjustmentType})` });
      queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to adjust quantity",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  if (!item) return null;

  const quantityChanged = quantity !== item.quantity;
  const canConfirm = adjustmentType !== null && quantityChanged;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="text-xl font-extrabold truncate">{item.name}</DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            {item.location} &middot; {item.category}
          </p>
        </DialogHeader>

        <div className="px-6 py-5 space-y-6">
          {/* Verify Quantity checkbox */}
          <button
            type="button"
            onClick={() => setVerified((v) => !v)}
            className="flex items-center gap-3 w-full group"
          >
            <div
              className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors shrink-0 ${
                verified
                  ? "bg-primary border-primary"
                  : "border-border group-hover:border-primary/60"
              }`}
            >
              {verified && <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />}
            </div>
            <span className="text-sm font-semibold select-none">Verify Quantity</span>
          </button>

          {/* Quantity stepper */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Quantity
            </p>
            <div className="flex items-center justify-between bg-muted/40 rounded-xl border border-border p-1">
              <button
                type="button"
                onClick={decrement}
                disabled={quantity <= 0}
                className="w-12 h-12 rounded-lg flex items-center justify-center text-foreground hover:bg-card hover:shadow-sm active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Minus className="w-5 h-5" />
              </button>

              <div className="text-center flex-1">
                <span className="text-4xl font-black tabular-nums leading-none">{quantity}</span>
                {quantityChanged && (
                  <span
                    className={`ml-2 text-sm font-bold ${
                      quantity > item.quantity ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {quantity > item.quantity ? "+" : ""}
                    {quantity - item.quantity}
                  </span>
                )}
                <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mt-1">
                  of {item.parLevel} par
                </p>
              </div>

              <button
                type="button"
                onClick={increment}
                className="w-12 h-12 rounded-lg flex items-center justify-center text-foreground hover:bg-card hover:shadow-sm active:scale-95 transition-all"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Adjustment type */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Select Adjustment Type
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ADJUSTMENT_TYPES.map((type) => {
                const active = adjustmentType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAdjustmentType(type)}
                    className={`px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all text-left ${
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-card border-border text-foreground hover:border-primary/50 hover:bg-primary/5"
                    } ${type === "Return to Warehouse" ? "col-span-2" : ""}`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 pt-2 gap-2 flex-row">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={handleConfirm}
            disabled={!canConfirm || isPending}
          >
            {isPending ? "Saving..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
