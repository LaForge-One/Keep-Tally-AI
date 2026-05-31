# AI And Database Performance Recommendations

Generated: 2026-05-30

This document focuses on how KeepTally should let AI interact with the database while keeping the application fast, predictable, and safe.

## Guiding Principle

The AI should not freely wander the database. It should use small, purpose-built tools that run indexed queries and return compact results.

Fast AI database access depends on four things:

1. Narrow tool contracts.
2. Indexed lookup paths.
3. Small result payloads.
4. Cached context for repeated voice or inventory workflows.

## Recommended AI Data Access Model

### Use Tools, Not Raw SQL

The AI should call application-defined tools such as:

- `find_item_by_barcode(accountId, locationId, barcode)`
- `search_items(accountId, locationId, query)`
- `get_location_snapshot(accountId, locationId)`
- `adjust_item_quantity(accountId, locationId, itemId, delta, reason)`
- `create_scan_log(accountId, locationId, itemId, action, qtyChange)`
- `get_recent_item_history(accountId, itemId, limit)`

Avoid:

- Letting the model write arbitrary SQL.
- Sending whole tables into model context.
- Asking the model to filter large result sets in memory.

Why:

- Tool calls keep permissions enforceable.
- Indexed queries stay fast.
- The app keeps a clear audit trail.

## Query Speed Targets

| AI Workflow | Database Path | Index Needed |
| --- | --- | --- |
| Voice says “count Coke Zero at Route 3” | account + location + item name | `items(account_id, location_id, name)` |
| Scanner reads barcode | account + barcode | `items(account_id, barcode)` |
| User asks recent changes for item | account + item + created time | `history(account_id, item_id, created_at)` |
| User asks who adjusted stock | account + user + created time | future `history(account_id, performed_by_user_id, created_at)` |
| User asks location scan activity | account + location + created time | `scan_log(account_id, location_id, created_at)` |
| Route sheet restock suggestion | account + location + item | `route_sheet_stop_items(account_id, item_id)` and `items(account_id, location_id, name)` |

## Keep Model Context Small

The AI should receive:

- The user command.
- Current account/user/location.
- Top 3-10 candidate items.
- Current quantity/par/barcode/category for candidates.
- A compact recent-history summary only when needed.

The AI should not receive:

- Every item in the database.
- Every location.
- Full history logs.
- Raw user tables.
- Password/security fields.

Good response payload shape:

```json
{
  "location": { "id": 12, "name": "Route 3" },
  "candidates": [
    {
      "id": 44,
      "name": "Coke Zero 12oz",
      "barcode": "0123456789",
      "quantity": 18,
      "parLevel": 24,
      "category": "Beverages"
    }
  ]
}
```

## Add An AI-Friendly Search Layer

For fast voice and text matching, add a dedicated search helper in the API layer.

Recommended behavior:

1. Exact barcode match first.
2. Exact normalized item name match second.
3. Prefix or trigram/fuzzy match third.
4. Optional vector/embedding search only for hard natural-language matching.

Do not start with embeddings for everything. Indexed SQL should handle most inventory lookups faster and cheaper.

## Recommended Future Indexes For AI

Phase 1 already adds several relational indexes. For AI search specifically, consider a later PostgreSQL trigram index if item-name matching is slow:

```sql
create extension if not exists pg_trgm;

create index if not exists items_name_trgm_idx
  on items using gin (name gin_trgm_ops);
```

Use this only after real test data shows item-name search needs fuzzy matching at scale.

For account-scoped fuzzy search, the query should still filter by `account_id` and `location_id` first.

## Recommended AI Cache Strategy

For voice check/count mode, keep a short-lived server-side cache:

- Key: `accountId + locationId`.
- Contents: item id, normalized name, barcode, quantity, par level.
- TTL: 30-120 seconds.
- Invalidate after item adjustment, scan action, import, or transfer.

Why:

- Voice workflows ask repeated questions against the same location.
- A location item snapshot is usually small.
- Avoids repeated database reads during one count session.

## Agent Workflow Pattern

The AI agent should follow this order:

1. Resolve account, user, and allowed locations from the session.
2. Resolve the target location.
3. Resolve item candidates using indexed search.
4. If confidence is high, propose or execute the action.
5. If confidence is low, ask the user to choose from a small candidate list.
6. Write changes through API services only.
7. Record `history` and `scan_log` rows with user and location references.

This keeps the AI fast and bounded.

## Audit And Safety

AI-driven writes should always create an audit record.

Recommended future fields:

- `history.performed_by_user_id`
- `scan_log.operator_user_id`
- `history.ai_session_id`
- `scan_log.ai_session_id`
- `history.confidence`
- `scan_log.confidence`

These fields would let us answer:

- Who initiated the action?
- Was it voice/manual/API/import?
- Did AI suggest it or execute it?
- What confidence did the parser have?

## Avoid Expensive Agent Behavior

Do not let agents:

- Pull all items to search locally unless the list is already cached and scoped to one location.
- Run report-style queries on every voice command.
- Join history and scan logs unless the user asks for history.
- Ask the model to infer permissions instead of checking the database.
- Use vector search for simple barcode/name lookups.

## Best Next AI/Data Improvements

1. Add relational user references to `history` and `scan_log`.
2. Create a dedicated item lookup service with exact, prefix, and optional fuzzy matching.
3. Add a location-scoped item snapshot cache for voice mode.
4. Add AI session/audit identifiers for write operations.
5. Add query timing logs for AI tool calls.
6. Add a slow-query budget for AI workflows, for example 150-300ms per DB call in VPS testing.

## Practical Speed Budget

Target timings for VPS test:

| Operation | Target |
| --- | --- |
| Health check | under 50ms |
| AI connectivity check | under 100ms locally |
| Barcode lookup | under 50ms |
| Location item candidate search | under 100ms |
| Voice parse plus DB lookup | under 500ms excluding model time |
| Quantity adjustment write plus audit rows | under 150ms |

The model itself may be slower, especially local AI. The database should not be the slow part.

## Recommendation

Use PostgreSQL as the fast source of truth, and use AI as the command interpreter and assistant layer. The AI should receive only the small slice of data needed to decide the next action. That is the path to keeping the workflow fast, secure, and scalable.
