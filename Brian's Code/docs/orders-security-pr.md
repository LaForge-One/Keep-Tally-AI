# Orders Security PR Notes

This PR is intentionally limited to the orders route group. It does not change the schema, auth behavior, or non-order inventory flows.

## Regression Test Coverage Targets

- A user without `edit_store_inventory` cannot access any `/orders` route.
- A limited-location user cannot list, create, read, update, archive, delete, edit items on, or receive an order for another location.
- A limited-location user can still complete the same order workflows for an assigned location.
- Updating or deleting an order item rejects an item that does not belong to the requested order.
- Updating or receiving an order item rejects a linked inventory item whose location does not match the order location.
- Receiving an order updates order-item received quantities, increments matching inventory quantities, and marks the order received as one transaction.
- Receiving an order rejects a payload that repeats the same order item id.
- A failed receive leaves order status, order-item received quantities, and inventory quantities unchanged.

## Manual Test Cases

1. Submit one receive request containing the same order item id twice and confirm it returns `400` with `{ error: string }` without changing inventory quantities.
2. Submit the same receive request again after a successful receive and confirm it returns `400` without changing inventory quantities.
3. Sign in as a user assigned to only one location and confirm `/orders`, `/orders/:id`, `/orders/:id/archive`, `/orders/:id/items/:itemId`, and `/orders/:id/receive` reject another location.
4. Attempt to update, delete, or receive by pairing an order id with an order item id from another order and confirm it returns `404`.
5. Create or modify an order item so its linked inventory item belongs to a different location, then confirm update/delete/receive reject it with a location mismatch error.
6. Force one invalid order item in a receive request and confirm the order status, all received quantities, and inventory quantities remain unchanged.

## Audit Trail Recommendations

- Add history rows for order creation, status changes, order-item quantity edits, order-item deletion, and receive completion.
- Include `performedBy`, `performedByRole`, `source`, `location`, previous value, and new value on every order history row.
- Keep the existing archive/delete audit rows, but standardize action names and notes with the future order audit events.
