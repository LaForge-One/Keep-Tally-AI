# Notifications Settings Implementation Design

## Purpose

The Settings module should eventually let account admins configure operational alerts without changing code or server environment variables. The first design pass keeps the UI honest: current in-app alert counts exist, but email digests and preference-based notifications still need backend support.

## Current State

- The app header already surfaces inventory alert counts from dashboard summary data.
- Settings now shows a Notifications design section with planned alert types.
- There is no notification preferences table.
- There is no notification delivery log.
- There is no email provider integration.
- There is no scheduled worker for daily digests or threshold checks.

## Recommended Notification Types

1. Low-stock and out-of-stock alerts
   - Trigger when store inventory falls below minimum or reaches zero.
   - Route to users assigned to that location and admins.
   - Support in-app first, then email.

2. Daily operations summary
   - Digest below-minimum items, warehouse reorders, overstock, stockouts, shrinkage-coded events, and recent imports.
   - Default delivery window: early morning before route work begins.
   - Support account-level time zone in a later phase.

3. Warehouse reorder alerts
   - Trigger when warehouse item quantity falls below min par or reorder point.
   - Route to warehouse and admin roles.

4. Import and data-change notices
   - Confirm successful imports.
   - Flag failed imports or large quantity swings.
   - Useful for audit and operational trust.

## Data Model Proposal

### `notification_preferences`

Account-level defaults plus optional per-user overrides.

Fields:

- `id`
- `account_id`
- `user_id` nullable
- `event_type`
- `enabled`
- `channels` JSON array, for example `["in_app", "email"]`
- `digest_frequency`, for example `instant`, `daily`, `weekly`
- `quiet_hours_start`
- `quiet_hours_end`
- `created_at`
- `updated_at`

Indexes:

- `(account_id, event_type)`
- `(account_id, user_id, event_type)`

### `notification_events`

Durable record of generated notifications.

Fields:

- `id`
- `account_id`
- `user_id`
- `event_type`
- `severity`
- `title`
- `message`
- `payload` JSON
- `read_at`
- `delivered_at`
- `delivery_status`
- `created_at`

Indexes:

- `(account_id, user_id, read_at, created_at)`
- `(account_id, event_type, created_at)`

## API Proposal

### `GET /api/settings/notifications`

Returns account defaults and current user's effective preferences.

### `PUT /api/settings/notifications`

Admin-only update for account defaults. Later, allow users to update their own personal channel preferences.

### `GET /api/notifications`

Lists in-app notification events, paginated at 50 records.

### `POST /api/notifications/:id/read`

Marks one notification as read.

### `POST /api/notifications/read-all`

Marks all visible notifications as read.

## Worker Proposal

Use a small scheduled worker process or cron-triggered script:

1. Query accounts with enabled notification preferences.
2. Evaluate low-stock, stockout, warehouse reorder, shrinkage, and import conditions.
3. Deduplicate events to avoid alert spam.
4. Insert `notification_events`.
5. Send email only for users with email channel enabled.
6. Record delivery status.

## Email Provider

Recommended options:

- Transactional provider: Postmark, SendGrid, Mailgun, or Resend.
- VPS mail is acceptable only for system-only internal notifications, but business-critical outbound delivery should use a transactional provider for deliverability.

## Performance Notes

- Notification checks should use indexed account/location/product fields.
- Daily digest generation should use summary queries, not raw table scans.
- Event insertion should be idempotent by event type, account, target entity, and time window.
- UI lists should remain paginated at 50 rows.

## Phased Implementation

### Phase 1

- Add preferences and events tables.
- Add read-only notification list endpoint.
- Generate in-app low-stock events from existing dashboard/agent summary logic.

### Phase 2

- Add admin settings API.
- Wire Settings controls to saved preferences.
- Add read/unread notification UI.

### Phase 3

- Add daily digest scheduler.
- Add transactional email provider.
- Add delivery log and retry handling.

### Phase 4

- Add richer AI-assisted summaries only after deterministic summary delivery is stable.
