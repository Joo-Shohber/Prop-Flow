# PropFlow

Property & Rental Management API. NestJS (ESM) + PostgreSQL/TypeORM + Redis. Built phase by phase with an emphasis on business logic — state machines, transactional integrity, resource-level authorization, and real database constraints — rather than plain CRUD.

## Table of contents

- [Full tech stack](#full-tech-stack)
- [Roles & permission matrix](#roles--permission-matrix)
- [Architecture](#architecture)
- [Data model — every table, every column](#data-model--every-table-every-column)
- [Business rules in full](#business-rules-in-full)
- [Environment variables — every one, explained](#environment-variables--every-one-explained)
- [Installation](#installation)
- [Scripts](#scripts)
- [Common infrastructure](#common-infrastructure)
- [Full API reference](#full-api-reference)
- [Caching](#caching)
- [Rate limiting](#rate-limiting)
- [Security measures](#security-measures)
- [Deployment](#deployment)
- [Complete project structure](#complete-project-structure)

---

## Full tech stack

| Package                                                      | Why it's here                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` | Framework (Nest 12, ESM-first, Node ≥ 22.12)                                                                                   |
| `@nestjs/config`                                             | `.env` loading                                                                                                                 |
| `zod`                                                        | Environment variable validation (chosen over Joi)                                                                              |
| `@nestjs/typeorm`, `typeorm`, `pg`                           | ORM + Postgres driver, migrations only (`synchronize: false`)                                                                  |
| `ioredis`                                                    | Redis client — cache, OTP storage, rate-limit storage                                                                          |
| `helmet`                                                     | Security headers                                                                                                               |
| `cookie-parser`                                              | Reads the httpOnly refresh-token cookie                                                                                        |
| `class-validator`, `class-transformer`                       | DTO validation/transformation                                                                                                  |
| `@nestjs/swagger`                                            | OpenAPI docs at `/api/docs`                                                                                                    |
| `@nestjs/jwt`                                                | Access + refresh token signing/verification                                                                                    |
| `bcrypt`                                                     | Password hashing (native binding, SHA-256 pre-hashed to use the full password, not just the first 72 bytes)                    |
| `nodemailer`, `ejs`                                          | OTP emails, HTML templates (called directly — no wrapper library)                                                              |
| `@nestjs/platform-express` (Multer integration), `multer`    | Multipart file uploads                                                                                                         |
| `file-type`                                                  | Magic-byte image validation (rejects spoofed extensions/MIME types)                                                            |
| `cloudinary`                                                 | Image storage (property photos, unit photos, maintenance photos, avatars)                                                      |
| `@nestjs/throttler`                                          | Rate limiting, with a **custom Redis-backed storage** (the community Redis storage packages don't declare Nest 12 support yet) |
| `@nestjs/passport`, `passport`, `passport-google-oauth20`    | Google OAuth                                                                                                                   |

Dev-only: `@nestjs/cli`, `@types/*` packages, `typeorm-ts-node-esm` (via the `migration:*` scripts).

## Roles & permission matrix

| Action                                                |                          TENANT                          |        OWNER         |       MAINTENANCE_STAFF        |       ADMIN       |
| ----------------------------------------------------- | :------------------------------------------------------: | :------------------: | :----------------------------: | :---------------: |
| Manage own profile / avatar                           |                           Yes                            |         Yes          |              Yes               |        Yes        |
| View properties                                       |                        Yes (all)                         |      Yes (own)       |               No               |     Yes (all)     |
| View units                                            | Yes (`AVAILABLE` only, cross-property, price-filterable) |      Yes (own)       |               No               |     Yes (all)     |
| Create/manage properties & units, incl. images        |                            No                            |      Yes (own)       |               No               |     Yes (all)     |
| Search the user directory (TENANT/STAFF names)        |                            No                            |         Yes          |               No               |        Yes        |
| Create rental requests                                |                 Yes (`AVAILABLE` units)                  |          No          |               No               |        No         |
| View rental requests                                  |                        Yes (own)                         | Yes (own properties) |               No               |     Yes (all)     |
| Approve / reject rental requests                      |                            No                            | Yes (own properties) |               No               |        Yes        |
| View leases                                           |                        Yes (own)                         | Yes (own properties) |               No               |     Yes (all)     |
| Create/activate/terminate leases directly             |                            No                            |   Yes (own units)    |               No               |        Yes        |
| Create maintenance requests                           |              Yes (own active lease's unit)               |          No          |               No               |        No         |
| Add more images to a maintenance request (while OPEN) |                        Yes (own)                         | Yes (own properties) |               No               |        Yes        |
| Assign maintenance requests                           |                            No                            | Yes (own properties) |               No               |        Yes        |
| Start / complete maintenance requests                 |                            No                            |          No          | Yes (only if assigned to them) |        No         |
| Close / cancel maintenance requests                   |                        Yes (own)                         | Yes (own properties) |               No               |        Yes        |
| Receive notifications                                 |                           Yes                            |         Yes          |              Yes               |        Yes        |
| View analytics dashboard                              |                            No                            | Yes (own properties) |               No               | Yes (system-wide) |
| List/manage all users, view audit log                 |                            No                            |          No          |               No               |        Yes        |

Enforced two ways: a global `RolesGuard` (coarse, `@Roles()` on each route) **and** a resource-level policy check inside the service for every read/write (`canManageProperty`, `canAccessLease`, `canAccessRentalRequest`, `canAccessMaintenance`, `canCloseOrCancelMaintenance` in `common/policies/policy.utils.ts`) — this second layer is what stops IDOR.

## Architecture

```
Client (Web / Mobile / Swagger)
        |  HTTPS
        v
 Helmet -> CORS(configured origins) -> cookie-parser -> ValidationPipe(whitelist, forbidNonWhitelisted)
        |
        v
 JwtAuthGuard (global) -> RolesGuard (global) -> ThrottlerGuard (global)
        |
        v
 Controllers (thin) -> Services (business logic, transactions, policy checks)
        |
        +-- Auth ---------- Users ---------- Properties ---------- Units
        +-- Leases -------- RentalRequests -- Maintenance -------- Notifications
        +-- AuditLogs ----- Analytics
        |
        v
 Common infra: RedisService . UploadService(Cloudinary) . EmailService(SMTP)
               LeaseExpirationService . CacheInvalidationService . RedisThrottlerStorage
        |
        v
 ResponseInterceptor (wraps { success, data, meta }) / AllExceptionsFilter (maps DB errors -> HTTP)
        |
        v
 PostgreSQL  .  Redis  .  Cloudinary  .  SMTP provider  .  Google OAuth
```

Modular monolith — one Nest module per domain, `common/` for cross-cutting concerns. Controllers never touch the database or Cloudinary/Redis directly; everything goes through a service.

## Data model — every table, every column

### `users`

| Column                   | Type                                              | Notes                                              |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------- |
| `id`                     | uuid PK                                           |                                                    |
| `email`                  | varchar(255)                                      | unique                                             |
| `passwordHash`           | varchar(255), nullable                            | `select: false`; nullable for Google-only accounts |
| `firstName`, `lastName`  | varchar(100)                                      |                                                    |
| `phone`                  | varchar(30), nullable                             |                                                    |
| `role`                   | enum `TENANT / OWNER / MAINTENANCE_STAFF / ADMIN` | default `TENANT`                                   |
| `isActive`               | boolean                                           | default `true`                                     |
| `isEmailVerified`        | boolean                                           | default `false`                                    |
| `avatar`                 | jsonb `{url, publicId}`, nullable                 |                                                    |
| `googleId`               | varchar(255), nullable                            | unique                                             |
| `createdAt`, `updatedAt` | timestamptz                                       |                                                    |

### `refresh_tokens`

| Column      | Type                        | Notes                          |
| ----------- | --------------------------- | ------------------------------ |
| `id`        | uuid PK                     | doubles as the JWT `jti` claim |
| `userId`    | uuid FK -> users, `CASCADE` | indexed                        |
| `family`    | uuid                        | indexed                        |
| `tokenHash` | varchar(64)                 | SHA-256 of the raw token       |
| `expiresAt` | timestamptz                 |                                |
| `revoked`   | boolean                     | default `false`                |
| `createdAt` | timestamptz                 |                                |

### `properties`

| Column                   | Type                                                               | Notes                |
| ------------------------ | ------------------------------------------------------------------ | -------------------- |
| `id`                     | uuid PK                                                            |                      |
| `name`                   | varchar(150)                                                       |                      |
| `description`            | text, nullable                                                     |                      |
| `propertyType`           | enum `APARTMENT / VILLA / STUDIO / TOWNHOUSE / COMMERCIAL / OTHER` | indexed              |
| `address`                | varchar(255)                                                       |                      |
| `city`                   | varchar(100)                                                       | indexed              |
| `country`                | varchar(100)                                                       |                      |
| `ownerId`                | uuid FK -> users, `CASCADE`                                        | indexed              |
| `images`                 | jsonb `{url, publicId}[]`                                          | default `[]`, max 10 |
| `createdAt`, `updatedAt` | timestamptz                                                        |                      |
| `deletedAt`              | timestamptz, nullable                                              | soft delete          |

### `units`

| Column                   | Type                                        | Notes                                                                             |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                     | uuid PK                                     |                                                                                   |
| `unitNumber`             | varchar(50)                                 |                                                                                   |
| `building`               | varchar(100)                                | free-text label                                                                   |
| `floor`                  | int, nullable                               |                                                                                   |
| `area`                   | numeric(10,2)                               |                                                                                   |
| `rentAmount`             | numeric(10,2)                               | current asking rent; snapshotted onto rental requests and leases at creation time |
| `bedrooms`               | smallint                                    | indexed                                                                           |
| `bathrooms`              | smallint                                    |                                                                                   |
| `description`            | text, nullable                              |                                                                                   |
| `propertyId`             | uuid FK -> properties, `CASCADE`            | indexed                                                                           |
| `status`                 | enum `AVAILABLE / RENTED / MAINTENANCE`     | default `AVAILABLE`, indexed                                                      |
| `images`                 | jsonb `{url, publicId}[]`                   | default `[]`, max 10                                                              |
| `createdAt`, `updatedAt` | timestamptz                                 |                                                                                   |
| —                        | `UNIQUE (propertyId, building, unitNumber)` |                                                                                   |

`Unit` has no soft delete of its own; its visibility in list queries is additionally gated on its parent `Property` not being soft-deleted (see "Zombie units" under Business rules).

### `leases`

| Column                   | Type                                                                                                                   | Notes                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | uuid PK                                                                                                                |                                                                                                                           |
| `tenantId`               | uuid FK -> users, `RESTRICT`                                                                                           | indexed                                                                                                                   |
| `unitId`                 | uuid FK -> units, `RESTRICT`                                                                                           | indexed                                                                                                                   |
| `startDate`, `endDate`   | date                                                                                                                   |                                                                                                                           |
| `rentAmount`             | numeric(10,2)                                                                                                          | copied from the unit (direct creation) or from the approved rental request, at lease-creation time; never client-supplied |
| `status`                 | enum `PENDING / ACTIVE / TERMINATED / EXPIRED`                                                                         | default `PENDING`, indexed                                                                                                |
| `notes`                  | text, nullable                                                                                                         |                                                                                                                           |
| `createdAt`, `updatedAt` | timestamptz                                                                                                            |                                                                                                                           |
| —                        | `CHECK (startDate < endDate)`                                                                                          |                                                                                                                           |
| —                        | `EXCLUDE USING gist (unitId WITH =, daterange(startDate, endDate, '[]') WITH &&) WHERE status IN ('PENDING','ACTIVE')` | requires `btree_gist`                                                                                                     |
| —                        | partial `UNIQUE (unitId) WHERE status = 'ACTIVE'`                                                                      | at most one ACTIVE lease per unit                                                                                         |
| —                        | composite index `(status, endDate)`                                                                                    | used by the lazy-expiration sweep                                                                                         |

### `rental_requests`

| Column                   | Type                                 | Notes                                                         |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------- |
| `id`                     | uuid PK                              |                                                               |
| `tenantId`               | uuid FK -> users, `RESTRICT`         | indexed — always the authenticated tenant, never client input |
| `unitId`                 | uuid FK -> units, `RESTRICT`         | indexed; the property is reached through `unit -> property`   |
| `startDate`, `endDate`   | date                                 | same format/semantics as leases                               |
| `rentAmount`             | numeric(10,2)                        | snapshot of the unit's `rentAmount` at request time           |
| `message`                | text, nullable                       | max 1000 characters                                           |
| `status`                 | enum `PENDING / APPROVED / REJECTED` | default `PENDING`, indexed                                    |
| `createdAt`, `updatedAt` | timestamptz                          |                                                               |
| —                        | `CHECK (startDate < endDate)`        |                                                               |

No overlap constraint on this table by design — a request does not reserve a unit. Conflicts are resolved at approval time, by the `leases` constraints above.

### `maintenance_requests`

| Column                   | Type                                                                  | Notes                                                                |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `id`                     | uuid PK                                                               |                                                                      |
| `title`                  | varchar(150)                                                          |                                                                      |
| `description`            | text                                                                  |                                                                      |
| `category`               | enum `PLUMBING / ELECTRICITY / HVAC / CARPENTRY / APPLIANCES / OTHER` |                                                                      |
| `priority`               | enum `LOW / MEDIUM / HIGH / URGENT`                                   | indexed                                                              |
| `images`                 | jsonb `{url, publicId}[]`                                             | default `[]`, up to 5; addable while `OPEN`, not just at creation    |
| `unitId`                 | uuid FK -> units, `RESTRICT`                                          | indexed — derived from the tenant's active lease, never client input |
| `tenantId`               | uuid FK -> users, `RESTRICT`                                          |                                                                      |
| `status`                 | enum `OPEN / ASSIGNED / IN_PROGRESS / RESOLVED / CLOSED / CANCELLED`  | default `OPEN`, indexed                                              |
| `assignedStaffId`        | uuid FK -> users, `RESTRICT`, nullable                                | indexed                                                              |
| `scheduledDate`          | date, nullable                                                        |                                                                      |
| `completionImages`       | jsonb `{url, publicId}[]`                                             | default `[]`, up to 5, set on completion                             |
| `resolutionDescription`  | text, nullable                                                        |                                                                      |
| `resolvedAt`             | timestamptz, nullable                                                 |                                                                      |
| `createdAt`, `updatedAt` | timestamptz                                                           |                                                                      |

### `maintenance_status_history`

| Column                        | Type                                       | Notes                                                                         |
| ----------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| `id`                          | uuid PK                                    |                                                                               |
| `requestId`                   | uuid FK -> maintenance_requests, `CASCADE` | indexed                                                                       |
| `previousStatus`, `newStatus` | enum (same as above)                       |                                                                               |
| `changedById`                 | uuid FK -> users, `RESTRICT`               |                                                                               |
| `notes`                       | text, nullable                             |                                                                               |
| `createdAt`                   | timestamptz                                | one row per transition (assign/start/complete/close/cancel — not on creation) |

### `notifications`

| Column              | Type                                                                                                                                                                                                       | Notes                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `id`                | uuid PK                                                                                                                                                                                                    |                                                           |
| `recipientId`       | uuid FK -> users, `CASCADE`                                                                                                                                                                                |                                                           |
| `type`              | enum `LEASE_CREATED / LEASE_ACTIVATED / LEASE_TERMINATED / RENTAL_REQUEST_CREATED / RENTAL_REQUEST_APPROVED / RENTAL_REQUEST_REJECTED / MAINTENANCE_CREATED / MAINTENANCE_ASSIGNED / MAINTENANCE_RESOLVED` |                                                           |
| `title`             | varchar(150)                                                                                                                                                                                               |                                                           |
| `message`           | text                                                                                                                                                                                                       |                                                           |
| `isRead`            | boolean                                                                                                                                                                                                    | default `false`                                           |
| `relatedEntityType` | varchar(50), nullable                                                                                                                                                                                      | e.g. `"Lease"`, `"RentalRequest"`, `"MaintenanceRequest"` |
| `relatedEntityId`   | uuid, nullable                                                                                                                                                                                             |                                                           |
| `createdAt`         | timestamptz                                                                                                                                                                                                |                                                           |
| —                   | composite index `(recipientId, isRead)`                                                                                                                                                                    |                                                           |

### `audit_logs`

| Column      | Type                                                                                                                                                                                                                                                                                   | Notes                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `id`        | uuid PK                                                                                                                                                                                                                                                                                |                                                           |
| `userId`    | uuid FK -> users, `RESTRICT`                                                                                                                                                                                                                                                           | indexed — the actor                                       |
| `action`    | enum `PROPERTY_CREATED / PROPERTY_DELETED / LEASE_CREATED / LEASE_ACTIVATED / LEASE_TERMINATED / RENTAL_REQUEST_CREATED / RENTAL_REQUEST_APPROVED / RENTAL_REQUEST_REJECTED / UNIT_STATUS_CHANGED / MAINTENANCE_ASSIGNED / MAINTENANCE_COMPLETED / USER_STATUS_CHANGED / ROLE_CHANGED` | indexed                                                   |
| `entity`    | varchar(50)                                                                                                                                                                                                                                                                            | e.g. `"Property"`, `"Lease"`, `"RentalRequest"` — indexed |
| `entityId`  | uuid                                                                                                                                                                                                                                                                                   |                                                           |
| `metadata`  | jsonb, nullable                                                                                                                                                                                                                                                                        | e.g. `{previousStatus, newStatus}`, `{leaseId}`           |
| `ipAddress` | varchar(45), nullable                                                                                                                                                                                                                                                                  |                                                           |
| `createdAt` | timestamptz                                                                                                                                                                                                                                                                            |                                                           |

Two Postgres extensions required (auto-installed by TypeORM on connect, and also created explicitly in the initial migration): `uuid-ossp` and `btree_gist`.

## Business rules in full

### Unit status state machine

```
AVAILABLE <-> MAINTENANCE   manual, via PATCH /units/:id/status
     |
   RENTED                   only ever set by Lease activate / cleared by terminate or expiration
```

A rented unit rejects any manual status change with `400`. A unit stays `AVAILABLE` while it only has `PENDING` leases (including one created by approving a rental request); it becomes `RENTED` only when a lease is activated.

### Lease status state machine

```
PENDING -> ACTIVE -> TERMINATED
PENDING          -> TERMINATED
PENDING -> ACTIVE -> EXPIRED   (automatic)
```

- A lease can be created two ways: directly (`POST /leases`, by OWNER/ADMIN) or by approving a rental request (`POST /rental-requests/:id/approve`). Both produce a `PENDING` lease with `rentAmount` snapshotted from the unit (direct creation) or carried over from the approved request, and both go through the same lifecycle afterward.
- Creating a lease never checks unit availability beyond the exclusion constraint.
- **Activation** locks both the lease and the unit row (`pessimistic_write`), requires `PENDING` + `AVAILABLE`, then sets lease -> `ACTIVE` and unit -> `RENTED`, atomically.
- **Termination** works from `PENDING` or `ACTIVE`; if it was `ACTIVE`, the unit goes back to `AVAILABLE`.
- **Expiration is lazy, not scheduled** — a set-based transaction runs before every lease/unit/rental-request read or write.
- Only a `PENDING` lease can be edited; the exclusion constraint re-validates on that update too.

### Rental request state machine

```
PENDING -> APPROVED
PENDING -> REJECTED
```

Terminal states; no `CANCELLED`.

End-to-end flow:

```
TENANT   GET /properties            -> all properties
         GET /properties/:id        -> property + its AVAILABLE units
         POST /rental-requests      -> RentalRequest(PENDING)
OWNER / ADMIN
         approve -> RentalRequest(APPROVED) + Lease(PENDING), unit stays AVAILABLE
                    ... later, POST /leases/:id/activate -> Lease(ACTIVE) + Unit(RENTED)
         reject  -> RentalRequest(REJECTED), no lease, unit unchanged
```

- **Discovery**: a tenant finds rentable units through `GET /properties` (all properties) and `GET /properties/:id` (that property plus its `AVAILABLE` units only), or directly through `GET /units` (cross-property, `AVAILABLE`-only, filterable by `bedrooms`/`minArea`/`maxArea`/`minPrice`/`maxPrice`/`propertyId`) and `GET /units/:id` (a single `AVAILABLE` unit; a non-`AVAILABLE` unit returns `404` to a `TENANT`, not `403` — this is a deliberate enumeration-safety choice, not a bug: it avoids confirming that a specific unit exists but is rented).
- **Create**: `TENANT` only. `tenantId`/`status` in the body are rejected (`400`) by `whitelist`+`forbidNonWhitelisted`, not silently dropped. The backend re-verifies everything regardless of what the UI showed: the unit exists and its property is not soft-deleted, the unit is `AVAILABLE`, dates are valid (`startDate < endDate`), and the range doesn't overlap a `PENDING`/`ACTIVE` lease. The unit's `rentAmount` is snapshotted. The owner is notified; the action is audited (`RENTAL_REQUEST_CREATED`). A request does **not** reserve the unit — several tenants may have pending requests for the same unit/dates.
- **Approve**: OWNER (own properties) or ADMIN, in one transaction: lock the request row, authorize via `unit -> property -> ownerId`, require `PENDING`; lock the unit row (serializing concurrent approvals), require `AVAILABLE` and the tenant still an active `TENANT`; create a `PENDING` lease (tenant, unit, dates, `rentAmount` from the request); mark the request `APPROVED`; notify the tenant; audit (`RENTAL_REQUEST_APPROVED`, `metadata: {leaseId}`). Does **not** change unit status. The lease exclusion constraint is the final concurrency guard against a racing direct `POST /leases` — a constraint violation rolls the whole transaction back and the request stays `PENDING`.
- **Reject**: OWNER (own properties) or ADMIN, `PENDING` only. Request becomes `REJECTED`; no lease; tenant notified; audited (`RENTAL_REQUEST_REJECTED`).
- Acting on an already-`APPROVED`/`REJECTED` request returns `409`.

### Zombie units (soft-deleted properties)

`Property` uses soft delete (`deletedAt`); `Unit` has no soft delete of its own. TypeORM automatically excludes soft-deleted rows from direct queries against the entity itself (e.g. `PropertiesService.findOneOrFail`, which is why `GET /properties/:id` correctly `404`s for a deleted property) — but **not** from manual joins or raw subqueries against a _related_ entity. `UnitsService.findAll`, `LeasesService.findAll`, `MaintenanceService.findAll`, and `RentalRequestsService.findAll`/`create` all join or subquery through `unit -> property`, and each explicitly adds `property."deletedAt" IS NULL` to avoid surfacing units that belong to a deleted property. Without this, a unit under a deleted property would keep appearing in unit search, remain requestable via a rental request, and so on — the property is "gone" but its units are not, unless this filter is applied everywhere such a join occurs. If a new query is added that reaches `Unit` through `Property`, it must include this condition too.

### Maintenance status state machine

```
OPEN -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED
OPEN -> CANCELLED
ASSIGNED -> CANCELLED
```

- **Create**: TENANT only, unit derived from their own `ACTIVE` lease. Up to 5 images.
- **Add images**: tenant (own), owner (own property), or ADMIN may add more images while the request is still `OPEN` (not just at creation) — up to the same 5-image cap, additively.
- **Assign**: OWNER (own property) or ADMIN; target must be an active `MAINTENANCE_STAFF`; request must be `OPEN`.
- **Start / Complete**: the assigned staff member only — not even ADMIN overrides this. `complete` requires `resolutionDescription`, accepts up to 5 completion images, sets `resolvedAt`.
- **Close**: only from `RESOLVED`. **Cancel**: only from `OPEN`/`ASSIGNED`. Both: tenant, owner, or ADMIN — not staff.
- Every transition (assign/start/complete/close/cancel) writes one history row.

### Auth

- Passwords: bcrypt over a SHA-256 pre-hash.
- Login blocked (`403`) until email verified, and if deactivated.
- **Refresh rotation + reuse detection**: every refresh issues a new pair and revokes the old row; presenting an already-used token revokes the whole family. Delivered only as an httpOnly cookie.
- **OTP**: 6-digit, HMAC-hashed in Redis, single-use, 5-attempt lockout, 60s resend cooldown. `forgot-password`/`resend-verification-otp` always return the same generic message.
- **Google OAuth**: `GET /auth/google` redirects to Google; `GET /auth/google/callback` links/creates the account, sets the refresh cookie, and **redirects the browser to `FRONTEND_URL`** (no token in the URL — the frontend performs its normal silent `POST /auth/refresh` on load to pick up the session from the cookie).

### Uploads

- Property images (max 10), unit images (max 10), maintenance request images (max 5, addable while `OPEN`) and completion images (max 5), user avatar (1) — all validated by actual file bytes via `file-type`, capped at 5 MB.
- Deleting an image also deletes it from Cloudinary, not just from the database array.

## Environment variables — every one, explained

| Variable                                                               | Required                     | Purpose                                                                                               |
| ---------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                             | no (default `development`)   | `production` enables SSL for Postgres, `secure`+`sameSite=none` cookies, hides internal error details |
| `PORT`                                                                 | no (default `3000`)          | HTTP port                                                                                             |
| `CORS_ORIGINS`                                                         | yes                          | comma-separated allowed origins                                                                       |
| `DATABASE_URL`                                                         | yes                          | `postgresql://user:pass@host:port/db`                                                                 |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                           | host required                | cache, OTP storage, rate-limit storage                                                                |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                              | yes, >=32 chars, must differ | signing secrets                                                                                       |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`                      | no (default `15m` / `7d`)    | duration strings                                                                                      |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes                          | image storage                                                                                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`    | host + from required         | OTP emails                                                                                            |
| `OTP_SECRET`                                                           | yes, >=32 chars              | HMAC key for OTP hashing                                                                              |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`                              | only for `seed:admin`        | first ADMIN account                                                                                   |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`      | only if using Google OAuth   |                                                                                                       |
| `FRONTEND_URL`                                                         | yes                          | where `GET /auth/google/callback` redirects to after setting the session cookie                       |

Validated at startup with `zod` — the app refuses to boot if anything is missing or malformed.

## Installation

```bash
npm install
cp .env.example .env
npm run migration:run
npm run seed:admin
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/api/docs`

Requires: Node >= 22.12, PostgreSQL (with privileges to `CREATE EXTENSION`), Redis.

## Scripts

| Script                         | Effect                                                          |
| ------------------------------ | --------------------------------------------------------------- |
| `start:dev`                    | watch-mode dev server                                           |
| `start:prod`                   | runs `dist/`                                                    |
| `build`                        | compiles TypeScript                                             |
| `migration:generate -- <path>` | diffs entities vs. DB, writes a migration                       |
| `migration:create -- <path>`   | blank migration file                                            |
| `migration:run`                | applies pending migrations                                      |
| `migration:revert`             | rolls back the last migration                                   |
| `seed:admin`                   | creates the ADMIN from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` |

No `test` script runs any real suite — see "Testing" in `docs/testing.md`.

## Common infrastructure

- **`RedisService`** — `getJson`/`setJson` (TTL), `del`, `delByPattern` (SCAN-based).
- **`UploadService`** — `uploadImages(files, folder, maxCount)` (magic-byte check -> Cloudinary), `deleteImages(images)`. Shared verbatim between properties and units.
- **`EmailService`** — direct `nodemailer` + `ejs`, never throws.
- **`LeaseExpirationService.run()`** — lazy expiration sweep; called before every lease/unit/rental-request read and write.
- **`CacheInvalidationService`** — `invalidateUnitsAndDashboard()`, `invalidateDashboard()`.
- **`RedisThrottlerStorage`** — hand-written Lua-script `ThrottlerStorage`.
- **`AllExceptionsFilter`** — maps PG error codes to HTTP statuses; hides internal messages in production.
- **`ResponseInterceptor`** — `{ success: true, data, meta? }` envelope.
- **Guards**: `JwtAuthGuard` -> `RolesGuard` -> `ThrottlerGuard`, all global. `@Public()` bypasses the first.
- **`@CurrentUser()`** — injects the authenticated `User`.

## Full API reference

All routes are prefixed `/api/v1`. Pagination query params (`page`, `limit` max 100, `sortBy`, `sortOrder`) are available on every list endpoint unless noted.

### `/auth` — all public, rate-limited as a group (5/min)

| Method & path                   | Body / notes                                                                 | Success                                                  | Errors                          |
| ------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| `POST /register`                | `{email, password(8-128), firstName, lastName, phone?, role: TENANT\|OWNER}` | 201, user (no password)                                  | 400, 409 duplicate email        |
| `POST /login`                   | `{email, password}`                                                          | 200 `{accessToken, expiresIn, user}` + refresh cookie    | 401, 403 deactivated/unverified |
| `POST /refresh`                 | cookie only                                                                  | 200 `{accessToken, expiresIn}` + rotated cookie          | 401 missing/invalid/reused      |
| `POST /logout`                  | cookie if present                                                            | 200 always, clears cookie                                | —                               |
| `POST /verify-email`            | `{email, otp}`                                                               | 200 message                                              | 400 invalid/expired/locked      |
| `POST /resend-verification-otp` | `{email}`                                                                    | 200 generic message always                               | —                               |
| `POST /forgot-password`         | `{email}`                                                                    | 200 generic message always                               | —                               |
| `POST /reset-password`          | `{email, otp, newPassword}`                                                  | 200 message, revokes all sessions                        | 400                             |
| `GET /google`                   | —                                                                            | redirects to Google                                      | —                               |
| `GET /google/callback`          | —                                                                            | sets the refresh cookie, **redirects to `FRONTEND_URL`** | 403 deactivated                 |

### `/users`

| Method & path            | Access       | Body / query                                                                                                                 |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /me`                | self         | —                                                                                                                            |
| `PATCH /me`              | self         | `{firstName?, lastName?, phone?}`                                                                                            |
| `POST/DELETE /me/avatar` | self         | multipart `avatar` / —                                                                                                       |
| `GET /directory`         | OWNER, ADMIN | `?role=TENANT\|MAINTENANCE_STAFF&search=` + pagination — minimal `{id, firstName, lastName, email, role}`, active users only |
| `GET /`                  | ADMIN        | `?role=&isActive=` + pagination, full user objects                                                                           |
| `PATCH /:id/status`      | ADMIN        | `{isActive}` — 422 self-deactivate; audited                                                                                  |
| `PATCH /:id/role`        | ADMIN        | `{role}` — 422 self-role-change; audited                                                                                     |

### `/properties`

| Method & path             | Access                                 | Body / query                                                                                         |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /`                   | TENANT (all), OWNER (own), ADMIN (all) | `?search=&city=&propertyType=` + pagination                                                          |
| `POST /`                  | OWNER, ADMIN                           | `{name, description?, propertyType, address, city, country, ownerId?}`; audited (`PROPERTY_CREATED`) |
| `GET /:id`                | TENANT, owner, ADMIN                   | TENANT: property + its `AVAILABLE` units only. Owner/ADMIN: plain property, `403` if not the owner.  |
| `PATCH /:id`              | owner, ADMIN                           | same as create minus `ownerId`                                                                       |
| `DELETE /:id`             | owner, ADMIN                           | soft delete; `409` if any unit `RENTED`; audited (`PROPERTY_DELETED`)                                |
| `POST/DELETE /:id/images` | owner, ADMIN                           | multipart `images[]` (max 10, 5MB, jpeg/png/webp) / `{publicId}`                                     |

### Units

| Method & path                        | Access                                                                       | Body / query                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /units`                         | TENANT (`AVAILABLE` only, cross-property), OWNER (own), ADMIN (all) — cached | `?status=&bedrooms=&minArea=&maxArea=&minPrice=&maxPrice=&propertyId=` + pagination; `status` is ignored for TENANT (always `AVAILABLE`); excludes units of soft-deleted properties |
| `POST /properties/:propertyId/units` | owner, ADMIN                                                                 | `{unitNumber, building, floor?, area, rentAmount, bedrooms, bathrooms, description?}`; `409` on duplicate `(building, unitNumber)`                                                  |
| `GET /units/:id`                     | TENANT (`AVAILABLE` only — `404` otherwise), owner, ADMIN                    |                                                                                                                                                                                     |
| `PATCH /units/:id`                   | owner, ADMIN                                                                 | same fields as create, no `status`                                                                                                                                                  |
| `DELETE /units/:id`                  | owner, ADMIN                                                                 |                                                                                                                                                                                     |
| `PATCH /units/:id/status`            | owner, ADMIN                                                                 | `{status: AVAILABLE\|MAINTENANCE}`; `400` if `RENTED` or invalid transition; audited                                                                                                |
| `POST/DELETE /units/:id/images`      | owner, ADMIN                                                                 | multipart `images[]` (max 10) / `{publicId}` — identical to property images                                                                                                         |

### `/leases`

| Method & path         | Access                                            | Body / query                                                                                                                                                                       |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`               | TENANT (own), OWNER (own properties), ADMIN (all) | `?status=&unitId=&tenantId=` + pagination; excludes leases of soft-deleted properties for OWNER                                                                                    |
| `POST /`              | OWNER (own unit), ADMIN                           | `{tenantId, unitId, startDate, endDate, notes?}`; `rentAmount` is snapshotted from the unit automatically, never client-supplied; `400`/`409` as before; audited (`LEASE_CREATED`) |
| `GET /:id`            | tenant, owner, ADMIN                              |                                                                                                                                                                                    |
| `PATCH /:id`          | owner, ADMIN                                      | `PENDING` only                                                                                                                                                                     |
| `POST /:id/activate`  | owner, ADMIN                                      | audited (`LEASE_ACTIVATED`)                                                                                                                                                        |
| `POST /:id/terminate` | owner, ADMIN                                      | audited (`LEASE_TERMINATED`)                                                                                                                                                       |

### `/rental-requests`

| Method & path       | Access                                            | Body / notes                                                                                                                            |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`             | TENANT (own), OWNER (own properties), ADMIN (all) | `?status=` + pagination; excludes requests on units of soft-deleted properties for OWNER                                                |
| `POST /`            | TENANT                                            | `{unitId, startDate, endDate, message?}`; `tenantId`/`status` rejected if sent; 400/404/409 as described above; notifies owner; audited |
| `GET /:id`          | tenant (own), owner (own properties), ADMIN       |                                                                                                                                         |
| `POST /:id/approve` | owner (own properties), ADMIN                     | creates a `PENDING` lease; notifies tenant; audited                                                                                     |
| `POST /:id/reject`  | owner (own properties), ADMIN                     | notifies tenant; audited                                                                                                                |

### `/maintenance`

| Method & path                   | Access                                    | Body / notes                                                       |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `GET /`                         | scoped by role                            | `?status=&priority=&category=` + pagination                        |
| `POST /`                        | TENANT (own active lease)                 | multipart `{title, description, category, priority, images[]<=5}`  |
| `GET /:id`                      | scoped                                    |                                                                    |
| `POST /:id/images`              | tenant (own), owner (own property), ADMIN | multipart `images[]`, additive up to 5 total, only while `OPEN`    |
| `POST /:id/assign`              | owner, ADMIN                              | `{assignedStaffId, scheduledDate?, notes?}`                        |
| `POST /:id/start`               | assigned staff only                       | `{notes?}`                                                         |
| `POST /:id/complete`            | assigned staff only                       | multipart `{resolutionDescription, notes?, completionImages[]<=5}` |
| `POST /:id/close` / `/cancel`   | tenant, owner, ADMIN                      | `{notes?}`                                                         |
| `DELETE /:id/images`            | tenant, owner, ADMIN                      | `{publicId}`, only `OPEN`                                          |
| `DELETE /:id/completion-images` | assigned staff only                       | `{publicId}`, only `RESOLVED`                                      |
| `GET /:id/history`              | scoped                                    |                                                                    |

### `/notifications` — scoped to the caller

`GET /` (`?unread=true` + pagination, `meta.unreadCount`), `PATCH /:id/read`, `PATCH /read-all`.

### `/audit-logs` — ADMIN only

`GET /` — `?action=&entity=&userId=` + pagination.

### `/analytics` — OWNER (own) / ADMIN (system-wide)

`GET /dashboard` — same fields as before; unaffected by rental requests (approving one does not invalidate this cache, only activating the resulting lease does).

## Caching

| Key pattern                             | What                       | TTL | Invalidated by                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `units:search:{sha256(scope+query)}`    | `GET /units` result pages  | 60s | unit create/update/delete/status/image change; lease activate/terminate/expiration. `scope` is `admin`, the owner's own id, or the literal `tenant` (every tenant's `AVAILABLE`-only results for the same filters are identical, so they share one entry). |
| `dashboard:stats:{admin \| owner:<id>}` | `GET /analytics/dashboard` | 60s | the above, plus property create/update/delete/images, and any maintenance status transition                                                                                                                                                                |

Rental requests are not cached and invalidate nothing — creating/approving/rejecting one never changes unit status, and the `PENDING` lease an approval creates doesn't affect cached figures until activated.

## Rate limiting

Global default 100/min/IP; `/auth/*` as a group is 5/min, then a block period. Backed by `RedisThrottlerStorage`.

## Security measures

- Helmet, CORS allow-list, `trust proxy`.
- `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` globally — also what rejects `tenantId`/`status` on a rental request.
- JWT access/refresh with separate secrets; rotation + reuse detection; httpOnly refresh cookie; OAuth callback never puts a token in a URL.
- bcrypt (SHA-256 pre-hashed).
- OTPs HMAC-hashed, single-use, rate-limited, 5-attempt lockout.
- RBAC + resource-level ownership checks (two-layer IDOR defense), including the soft-delete-aware filtering described under "Zombie units."
- `GET /units/:id` returns `404` (not `403`) to a `TENANT` for a non-`AVAILABLE` unit — a deliberate enumeration-safety choice.
- Uploads validated by file content, size- and count-capped.
- Row-level locking on every concurrent state transition (lease activation, rental-request approval, maintenance transitions).
- Real database constraints (`CHECK`, `EXCLUDE`, partial unique) as the final concurrency guard, not just application checks.
- Global exception filter; no stack traces in production.

## Deployment

1. Build Command: `npm run migration:run && npm run build`.
2. Set every environment variable above, **including `FRONTEND_URL`**.
3. `NODE_ENV=production` enables Postgres SSL, `secure`+`sameSite=none` cookies, generic error messages.
4. `trust proxy` already enabled for correct client IPs/rate limiting behind Vercel.

## Complete project structure

```
api/
  index.ts
src/
  main.ts, app.module.ts, app.setup.ts
  config/env.validation.ts
  database/
    data-source.ts
    migrations/
      1790376650206-InitSchema.ts
      <timestamp>-AddGoogleAuth.ts
      <timestamp>-AddPropertyCreatedAuditAction.ts
      <timestamp>-AddRentalRequests.ts        rental_requests table + notification/audit enum values
      <timestamp>-AddUnitImages.ts
      <timestamp>-AddRentAmount.ts            rentAmount on units, leases, rental_requests
    seeds/seed-admin.ts
  common/
    decorators/ guards/ filters/ interceptors/ pagination/
    policies/   policy.utils (canManageProperty, canAccessLease, canAccessRentalRequest,
                               canAccessMaintenance, canCloseOrCancelMaintenance)
    redis/ uploads/ mail/ cache/ throttler/ lease-expiration/ types/ utils/
  auth/            incl. strategies/google.strategy.ts, utils/refresh-cookie.util.ts
  users/           incl. dto/list-user-directory-query, user-directory-response
  properties/
  units/           incl. dto/*-images (shared pattern with properties)
  leases/
  rental-requests/ controller, service, module, entities/, enums/, dto/
  maintenance/     incl. the new images-add endpoint
  notifications/
  audit-logs/
  analytics/
vercel.json
.env.example
nest-cli.json
```
