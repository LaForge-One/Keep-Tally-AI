# Auth and Admin Preflight Phase 2

Generated: 2026-05-30

Phase 1 preflight now includes database-level auth/admin checks. Phase 2 should add running-application checks against the VPS test container.

## Phase 1 Already Covered

Database preflight now checks:

- `admin` user exists.
- `admin` user is active.
- `admin` user has role `admin`.
- Admin has an active account membership.
- Admin permission matrix has all 14 admin permissions enabled.
- User roles are limited to `admin`, `warehouse`, and `stocker`.
- Account membership roles are limited to `admin`, `warehouse`, and `stocker`.
- Usernames are unique case-insensitively.

These checks confirm the database can support login and admin functionality.

## Phase 2 API-Level Checks

Add a VPS-oriented script that verifies the running app, not just the database.

Recommended checks:

1. `GET /api/healthz` returns `200`.
2. `GET /api/auth/me` without cookie returns `401`.
3. `POST /api/auth/login` with missing body returns `400`.
4. `POST /api/auth/login` with wrong password returns `401`.
5. `POST /api/auth/login` with test admin credentials returns `200`.
6. Login response sets `kt_token`.
7. `GET /api/auth/me` with cookie returns admin payload.
8. `GET /api/users` with admin cookie returns `200`.
9. `GET /api/permissions` with admin cookie returns `200`.
10. `POST /api/auth/logout` clears session.
11. `GET /api/auth/me` after logout returns `401`.

## Future Role-Based Checks

Create a temporary non-admin user and verify:

- `stocker` cannot access `/api/users`.
- `stocker` can access scanner/voice routes if permissions allow.
- `warehouse` can view warehouse routes.
- `warehouse` cannot manage users.
- Location-restricted users only see allowed locations.

## Recommendation

Treat Phase 2 auth/admin preflight as the next safety improvement after the current schema/index/test-data work lands on the VPS.

The database-level checks catch broken seed/migration state. The API-level checks catch broken routing, cookies, CORS, session handling, and permission middleware.
