import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateItem, useUpdateItem, useGetItem, getListItemsQueryKey, getGetDashboardSummaryQueryKey, getListHistoryQueryKey, getGetItemQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import type { Item } from "@workspace/api-client-react";

const itemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  quantity: z.coerce.number().min(0, "Quantity must be positive"),
  minQuantity: z.coerce.number().min(0, "Minimum quantity must be positive"),
  maxQuantity: z.coerce.number().min(0, "Maximum quantity must be positive"),
  location: z.string().min(1, "Location is required"),
  barcode: z.string().optional(),
}).refine((data) => data.maxQuantity >= data.minQuantity, {
  message: "Maximum quantity must be at least the minimum quantity",
  path: ["maxQuantity"],
});

type ItemFormValues = z.infer<typeof itemSchema>;

interface ItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: Item;
  defaultLocation?: string;
}

export function ItemDialog({ open, onOpenChange, item, defaultLocation }: ItemDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = !!item;

  const { data: itemData } = useGetItem(item?.id ?? 0, {
    query: {
      enabled: isEditing && open,
      queryKey: getGetItemQueryKey(item?.id ?? 0),
    }
  });

  const displayItem = itemData || item;

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: "",
      category: "",
      quantity: 0,
      minQuantity: 0,
      maxQuantity: 0,
      location: defaultLocation ?? "",
      barcode: "",
    },
  });

  // Reset form when item changes
  useEffect(() => {
    if (displayItem && open) {
      form.reset({
        name: displayItem.name,
        category: displayItem.category,
        quantity: displayItem.quantity,
        minQuantity: displayItem.minQuantity ?? displayItem.parLevel,
        maxQuantity: displayItem.maxQuantity ?? displayItem.parLevel,
        location: displayItem.location,
        barcode: displayItem.barcode ?? "",
      });
    } else if (!displayItem && open) {
      form.reset({
        name: "",
        category: "",
        quantity: 0,
        minQuantity: 0,
        maxQuantity: 0,
        location: defaultLocation ?? "",
        barcode: "",
      });
    }
  }, [displayItem, open, form, defaultLocation]);

  const createItem = useCreateItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Item created successfully" });
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to create item", description: err.data?.error || err.message, variant: "destructive" });
      }
    }
  });

  const updateItem = useUpdateItem({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Item updated successfully" });
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        if (item) {
          queryClient.setQueryData(getGetItemQueryKey(item.id), data);
        }
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to update item", description: err.data?.error || err.message, variant: "destructive" });
      }
    }
  });

  const onSubmit = (data: ItemFormValues) => {
    const payload = {
      ...data,
      parLevel: data.minQuantity,
      barcode: data.barcode?.trim() || null,
    };
    if (isEditing && item) {
      updateItem.mutate({ id: item.id, data: payload });
    } else {
      createItem.mutate({ data: payload });
    }
  };

  const isPending = createItem.isPending || updateItem.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Item" : "Add New Item"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Coke Zero 12oz" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Beverage" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Route 3" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="minQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="maxQuantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Maximum Quantity</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="barcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Barcode / UPC</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 012345678901" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
