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
| `@nestjs-modules/mailer`, `nodemailer`, `ejs`                | OTP emails, HTML templates                                                                                                     |
| `@nestjs/platform-express` (Multer integration), `multer`    | Multipart file uploads                                                                                                         |
| `file-type`                                                  | Magic-byte image validation (rejects spoofed extensions/MIME types)                                                            |
| `cloudinary`                                                 | Image storage (property photos, maintenance photos, avatars)                                                                   |
| `@nestjs/throttler`                                          | Rate limiting, with a **custom Redis-backed storage** (the community Redis storage packages don't declare Nest 12 support yet) |
| `@nestjs/passport`, `passport`, `passport-google-oauth20`    | Google OAuth                                                                                                                   |

Dev-only: `@nestjs/cli`, `@types/*` packages, `typeorm-ts-node-esm` (via the `migration:*` scripts).

## Roles & permission matrix

| Action                                |            TENANT             |        OWNER         |       MAINTENANCE_STAFF        |       ADMIN       |
| ------------------------------------- | :---------------------------: | :------------------: | :----------------------------: | :---------------: |
| Manage own profile / avatar           |              Yes              |         Yes          |              Yes               |        Yes        |
| Create/manage properties & units      |              No               |      Yes (own)       |               No               |     Yes (all)     |
| View leases                           |           Yes (own)           | Yes (own properties) |               No               |     Yes (all)     |
| Create/activate/terminate leases      |              No               |   Yes (own units)    |               No               |        Yes        |
| Create maintenance requests           | Yes (own active lease's unit) |          No          |               No               |        No         |
| Assign maintenance requests           |              No               | Yes (own properties) |               No               |        Yes        |
| Start / complete maintenance requests |              No               |          No          | Yes (only if assigned to them) |        No         |
| Close / cancel maintenance requests   |           Yes (own)           | Yes (own properties) |               No               |        Yes        |
| Receive notifications                 |              Yes              |         Yes          |              Yes               |        Yes        |
| View analytics dashboard              |              No               | Yes (own properties) |               No               | Yes (system-wide) |
| List/manage all users, view audit log |              No               |          No          |               No               |        Yes        |

Enforced two ways: a global `RolesGuard` (coarse, `@Roles()` on each route) **and** a resource-level policy check inside the service for every read/write (`canManageProperty`, `canAccessLease`, `canAccessMaintenance`, `canCloseOrCancelMaintenance` in `common/policies/policy.utils.ts`) — this second layer is what stops IDOR (an OWNER passing another owner's property/unit/lease ID).

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
        +-- Leases -------- Maintenance ---- Notifications -------- AuditLogs
        +-- Analytics
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

| Column                   | Type                                              | Notes                                                                          |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`                     | uuid PK                                           |                                                                                |
| `email`                  | varchar(255)                                      | unique                                                                         |
| `passwordHash`           | varchar(255), nullable                            | `select: false` (never returned by default); nullable for Google-only accounts |
| `firstName`, `lastName`  | varchar(100)                                      |                                                                                |
| `phone`                  | varchar(30), nullable                             |                                                                                |
| `role`                   | enum `TENANT / OWNER / MAINTENANCE_STAFF / ADMIN` | default `TENANT`                                                               |
| `isActive`               | boolean                                           | default `true`                                                                 |
| `isEmailVerified`        | boolean                                           | default `false`                                                                |
| `avatar`                 | jsonb `{url, publicId}`, nullable                 |                                                                                |
| `googleId`               | varchar(255), nullable                            | unique                                                                         |
| `createdAt`, `updatedAt` | timestamptz                                       |                                                                                |

### `refresh_tokens`

| Column      | Type                        | Notes                                                       |
| ----------- | --------------------------- | ----------------------------------------------------------- |
| `id`        | uuid PK                     | doubles as the JWT `jti` claim                              |
| `userId`    | uuid FK -> users, `CASCADE` | indexed                                                     |
| `family`    | uuid                        | indexed; shared across all tokens issued from one login     |
| `tokenHash` | varchar(64)                 | SHA-256 of the raw token — the token itself is never stored |
| `expiresAt` | timestamptz                 |                                                             |
| `revoked`   | boolean                     | default `false`                                             |
| `createdAt` | timestamptz                 |                                                             |

### `properties`

| Column                   | Type                                                               | Notes        |
| ------------------------ | ------------------------------------------------------------------ | ------------ |
| `id`                     | uuid PK                                                            |              |
| `name`                   | varchar(150)                                                       |              |
| `description`            | text, nullable                                                     |              |
| `propertyType`           | enum `APARTMENT / VILLA / STUDIO / TOWNHOUSE / COMMERCIAL / OTHER` | indexed      |
| `address`                | varchar(255)                                                       |              |
| `city`                   | varchar(100)                                                       | indexed      |
| `country`                | varchar(100)                                                       |              |
| `ownerId`                | uuid FK -> users, `CASCADE`                                        | indexed      |
| `images`                 | jsonb `{url, publicId}[]`                                          | default `[]` |
| `createdAt`, `updatedAt` | timestamptz                                                        |              |
| `deletedAt`              | timestamptz, nullable                                              | soft delete  |

### `units`

| Column                   | Type                                        | Notes                        |
| ------------------------ | ------------------------------------------- | ---------------------------- |
| `id`                     | uuid PK                                     |                              |
| `unitNumber`             | varchar(50)                                 |                              |
| `building`               | varchar(100)                                | free-text label              |
| `floor`                  | int, nullable                               |                              |
| `area`                   | numeric(10,2)                               |                              |
| `bedrooms`               | smallint                                    | indexed                      |
| `bathrooms`              | smallint                                    |                              |
| `description`            | text, nullable                              |                              |
| `propertyId`             | uuid FK -> properties, `CASCADE`            | indexed                      |
| `status`                 | enum `AVAILABLE / RENTED / MAINTENANCE`     | default `AVAILABLE`, indexed |
| `createdAt`, `updatedAt` | timestamptz                                 |                              |
| —                        | `UNIQUE (propertyId, building, unitNumber)` |                              |

### `leases`

| Column                   | Type                                                                                                                   | Notes                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                     | uuid PK                                                                                                                |                                                                                        |
| `tenantId`               | uuid FK -> users, `RESTRICT`                                                                                           | indexed                                                                                |
| `unitId`                 | uuid FK -> units, `RESTRICT`                                                                                           | indexed                                                                                |
| `startDate`, `endDate`   | date                                                                                                                   |                                                                                        |
| `status`                 | enum `PENDING / ACTIVE / TERMINATED / EXPIRED`                                                                         | default `PENDING`, indexed                                                             |
| `notes`                  | text, nullable                                                                                                         |                                                                                        |
| `createdAt`, `updatedAt` | timestamptz                                                                                                            |                                                                                        |
| —                        | `CHECK (startDate < endDate)`                                                                                          |                                                                                        |
| —                        | `EXCLUDE USING gist (unitId WITH =, daterange(startDate, endDate, '[]') WITH &&) WHERE status IN ('PENDING','ACTIVE')` | requires `btree_gist`; no two PENDING/ACTIVE leases of the same unit can overlap dates |
| —                        | partial `UNIQUE (unitId) WHERE status = 'ACTIVE'`                                                                      | at most one ACTIVE lease per unit                                                      |
| —                        | composite index `(status, endDate)`                                                                                    | used by the lazy-expiration sweep                                                      |

### `maintenance_requests`

| Column                   | Type                                                                  | Notes                                                                |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `id`                     | uuid PK                                                               |                                                                      |
| `title`                  | varchar(150)                                                          |                                                                      |
| `description`            | text                                                                  |                                                                      |
| `category`               | enum `PLUMBING / ELECTRICITY / HVAC / CARPENTRY / APPLIANCES / OTHER` |                                                                      |
| `priority`               | enum `LOW / MEDIUM / HIGH / URGENT`                                   | indexed                                                              |
| `images`                 | jsonb `{url, publicId}[]`                                             | default `[]`, up to 5, set at creation                               |
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

| Column              | Type                                                                                                                          | Notes                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `id`                | uuid PK                                                                                                                       |                                        |
| `recipientId`       | uuid FK -> users, `CASCADE`                                                                                                   |                                        |
| `type`              | enum `LEASE_CREATED / LEASE_ACTIVATED / LEASE_TERMINATED / MAINTENANCE_CREATED / MAINTENANCE_ASSIGNED / MAINTENANCE_RESOLVED` |                                        |
| `title`             | varchar(150)                                                                                                                  |                                        |
| `message`           | text                                                                                                                          |                                        |
| `isRead`            | boolean                                                                                                                       | default `false`                        |
| `relatedEntityType` | varchar(50), nullable                                                                                                         | e.g. `"Lease"`, `"MaintenanceRequest"` |
| `relatedEntityId`   | uuid, nullable                                                                                                                |                                        |
| `createdAt`         | timestamptz                                                                                                                   |                                        |
| —                   | composite index `(recipientId, isRead)`                                                                                       |                                        |

### `audit_logs`

| Column      | Type                                                                                                                                                                                   | Notes                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `id`        | uuid PK                                                                                                                                                                                |                                        |
| `userId`    | uuid FK -> users, `RESTRICT`                                                                                                                                                           | indexed — the actor                    |
| `action`    | enum `PROPERTY_DELETED / LEASE_CREATED / LEASE_ACTIVATED / LEASE_TERMINATED / UNIT_STATUS_CHANGED / MAINTENANCE_ASSIGNED / MAINTENANCE_COMPLETED / USER_STATUS_CHANGED / ROLE_CHANGED` | indexed                                |
| `entity`    | varchar(50)                                                                                                                                                                            | e.g. `"Property"`, `"Lease"` — indexed |
| `entityId`  | uuid                                                                                                                                                                                   |                                        |
| `metadata`  | jsonb, nullable                                                                                                                                                                        | e.g. `{previousStatus, newStatus}`     |
| `ipAddress` | varchar(45), nullable                                                                                                                                                                  |                                        |
| `createdAt` | timestamptz                                                                                                                                                                            |                                        |

Two Postgres extensions required (auto-installed by TypeORM on connect, and also created explicitly as the first two statements of the initial migration): `uuid-ossp` (uuid generation) and `btree_gist` (the leases exclusion constraint).

## Business rules in full

### Unit status state machine

```
AVAILABLE <-> MAINTENANCE   manual, via PATCH /units/:id/status
     |
   RENTED                   only ever set by Lease activate / cleared by terminate or expiration
```

A rented unit rejects any manual status change with `400`.

### Lease status state machine

```
PENDING -> ACTIVE -> TERMINATED
PENDING          -> TERMINATED
PENDING -> ACTIVE -> EXPIRED   (automatic)
```

- Creating a lease never checks unit availability beyond the exclusion constraint (dates can't overlap another PENDING/ACTIVE lease of the same unit).
- **Activation** locks both the lease and the unit row (`pessimistic_write`), requires the lease to be `PENDING` and the unit to be `AVAILABLE`, then sets lease -> `ACTIVE` and unit -> `RENTED`, atomically.
- **Termination** works from `PENDING` or `ACTIVE`; if it was `ACTIVE`, the unit goes back to `AVAILABLE`.
- **Expiration is lazy, not scheduled.** A single set-based transaction — `UPDATE leases SET status='EXPIRED' WHERE status='ACTIVE' AND endDate < CURRENT_DATE`, then free the affected units — runs before every lease read/write and before every unit search. No cron job, no worker.
- Only a `PENDING` lease can be edited (dates/notes); the exclusion constraint re-validates on that update too.

### Maintenance status state machine

```
OPEN -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED
OPEN -> CANCELLED
ASSIGNED -> CANCELLED
```

- **Create**: TENANT only, for the unit of their own currently-`ACTIVE` lease (never taken from the request body). Up to 5 images.
- **Assign**: OWNER (own property) or ADMIN. Requires an active `MAINTENANCE_STAFF` user. Request must be `OPEN`.
- **Start** / **Complete**: the assigned staff member only — not even ADMIN can override this (deliberate reading of the spec). Complete requires `resolutionDescription` and accepts up to 5 completion images; sets `resolvedAt`.
- **Close**: only once `RESOLVED`. **Cancel**: only from `OPEN` or `ASSIGNED`. Both allowed for the tenant, the property owner, or ADMIN — not staff.
- Every transition (assign/start/complete/close/cancel — not creation) writes one `maintenance_status_history` row inside the same transaction as the update.

### Auth

- Passwords: bcrypt over a SHA-256 pre-hash of the raw password (bcrypt silently truncates at 72 bytes; pre-hashing makes the entire password count, including multi-byte characters).
- Login is blocked (`403`) until the email is verified, and again if the account is deactivated.
- **Refresh token rotation**: every `/auth/refresh` call issues a brand-new access+refresh pair and marks the old refresh token `revoked`, keeping the same `family`. If an already-revoked (reused) token is presented, the entire family is revoked — forcing a fresh login. Refresh tokens are delivered only as an httpOnly cookie (`secure`+`sameSite=none` in production, `sameSite=lax` in dev behind a same-site proxy), never in the response body.
- **OTP** (email verification, password reset): 6-digit, generated with `crypto.randomInt`, HMAC-SHA256-hashed with a server secret before being stored in Redis under `otp:{purpose}:{email}` (10-minute TTL). Verifying is a single atomic Lua script: correct code deletes the key (single use); wrong code increments an attempt counter; the 5th wrong attempt deletes the key even though the real code was never used. A 60-second cooldown (a separate Redis key with `NX`) limits how often a new code can be requested. `forgot-password` and `resend-verification-otp` always return the same generic message regardless of whether the email exists, to prevent enumeration.
- **Google OAuth**: on success, links to an existing account by email (or creates a new `TENANT`, pre-verified) and issues our own token pair — Google is only used to authenticate, not as a session mechanism.

### Uploads

- Property images (max 10), maintenance request images and completion images (max 5 each), user avatar (1) — all validated by actual file bytes via `file-type` (magic numbers), not by client-supplied filename or MIME type, and capped at 5 MB.
- Deleting an image also deletes it from Cloudinary (`uploader.destroy`), not just from the database array.

## Environment variables — every one, explained

| Variable                                                               | Required                     | Purpose                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                             | no (default `development`)   | `production` enables SSL for Postgres, `secure`+`sameSite=none` cookies, and hides internal error details |
| `PORT`                                                                 | no (default `3000`)          | HTTP port                                                                                                 |
| `CORS_ORIGINS`                                                         | yes                          | comma-separated list of allowed origins                                                                   |
| `DATABASE_URL`                                                         | yes                          | `postgresql://user:pass@host:port/db`                                                                     |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                           | host required                | cache, OTP storage, rate-limit storage                                                                    |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                              | yes, >=32 chars, must differ | signing secrets                                                                                           |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`                      | no (default `15m` / `7d`)    | duration strings like `15m`, `12h`, `7d`                                                                  |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes                          | image storage                                                                                             |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`    | host + from required         | OTP emails                                                                                                |
| `OTP_SECRET`                                                           | yes, >=32 chars              | HMAC key for hashing OTP codes                                                                            |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`                              | only for `seed:admin`        | first ADMIN account                                                                                       |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`      | only if using Google OAuth   | Phase 10                                                                                                  |

Validated at startup with `zod` (`src/config/env.validation.ts`) — the app refuses to boot with a clear error if anything is missing or malformed.

## Installation

```bash
npm install
cp .env.example .env          # fill in every value above
npm run migration:run          # creates the schema on an empty database
npm run seed:admin              # creates the first ADMIN
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

## Common infrastructure

- **`RedisService`** — thin `ioredis` wrapper: `getJson`/`setJson` (with TTL), `del`, `delByPattern` (SCAN-based, non-blocking).
- **`UploadService`** — `uploadImages(files, folder, maxCount)` (magic-byte check -> Cloudinary `upload_stream`), `deleteImages(images)`.
- **`EmailService`** — wraps `MailerService`, never throws (a failed send is logged, not surfaced to the caller — the OTP flow always returns the same response either way).
- **`LeaseExpirationService.run()`** — the lazy-expiration sweep described above; called at the top of every lease/unit read and write.
- **`CacheInvalidationService`** — `invalidateUnitsAndDashboard()`, `invalidateDashboard()`; thin wrappers around `RedisService.delByPattern`.
- **`RedisThrottlerStorage`** — a from-scratch implementation of `@nestjs/throttler`'s `ThrottlerStorage` interface, using a single Lua script (fixed window + optional block period) so the increment-and-check is atomic.
- **`AllExceptionsFilter`** — maps Postgres error codes to HTTP statuses: `23505`/`23P01` -> 409, `23503` -> 409, `23514`/`23502` -> 422, `22001`/`22P02` -> 400; hides internal messages in production.
- **`ResponseInterceptor`** — every success response is `{ success: true, data, meta? }`; paginated endpoints get `meta: { page, limit, total, totalPages, ...extra }`.
- **Guards**: `JwtAuthGuard` (global, verifies the access token, loads the user, checks `isActive` on every request) -> `RolesGuard` (global, checks `@Roles()`) -> `ThrottlerGuard` (global). `@Public()` bypasses the JWT guard.
- **`@CurrentUser()`** decorator injects the authenticated `User` entity into any handler.

## Full API reference

All routes are prefixed `/api/v1`. Pagination query params (`page`, `limit` max 100, `sortBy`, `sortOrder`) are available on every list endpoint unless noted.

### `/auth` — all public

| Method & path                   | Body / notes                                                                 | Success                                               | Errors                                                            |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /register`                | `{email, password(8-128), firstName, lastName, phone?, role: TENANT\|OWNER}` | 201, user (no password)                               | 400 validation, 409 duplicate email                               |
| `POST /login`                   | `{email, password}` — throttled 5/60s                                        | 200 `{accessToken, expiresIn, user}` + refresh cookie | 401 invalid creds, 403 deactivated/unverified                     |
| `POST /refresh`                 | reads the `refresh_token` cookie                                             | 200 `{accessToken, expiresIn}` + rotated cookie       | 401 missing/invalid/reused (reuse kills the whole session family) |
| `POST /logout`                  | reads the cookie if present                                                  | 200 (always, idempotent), clears cookie               | —                                                                 |
| `POST /verify-email`            | `{email, otp}` — throttled                                                   | 200 message                                           | 400 invalid/expired/locked-out code                               |
| `POST /resend-verification-otp` | `{email}` — throttled, 60s cooldown                                          | 200 generic message always                            | —                                                                 |
| `POST /forgot-password`         | `{email}` — throttled                                                        | 200 generic message always                            | —                                                                 |
| `POST /reset-password`          | `{email, otp, newPassword(8-128)}` — throttled                               | 200 message, revokes all sessions                     | 400 invalid code/validation                                       |
| `GET /google`                   | —                                                                            | redirects to Google                                   | —                                                                 |
| `GET /google/callback`          | —                                                                            | 200 same shape as login                               | 403 deactivated                                                   |

### `/users`

| Method & path       | Access | Body / query                                                        |
| ------------------- | ------ | ------------------------------------------------------------------- |
| `GET /me`           | self   | —                                                                   |
| `PATCH /me`         | self   | `{firstName?, lastName?, phone?}`                                   |
| `POST /me/avatar`   | self   | multipart `avatar` file                                             |
| `DELETE /me/avatar` | self   | —                                                                   |
| `GET /`             | ADMIN  | `?role=&isActive=` + pagination                                     |
| `PATCH /:id/status` | ADMIN  | `{isActive}` — 422 self-deactivate; audited (`USER_STATUS_CHANGED`) |
| `PATCH /:id/role`   | ADMIN  | `{role}` — 422 self-role-change; audited (`ROLE_CHANGED`)           |

### `/properties`

| Method & path        | Access                    | Body / query                                                                                              |
| -------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /`              | OWNER (own) / ADMIN (all) | `?search=&city=&propertyType=` + pagination                                                               |
| `POST /`             | OWNER / ADMIN             | `{name, description?, propertyType, address, city, country, ownerId?}` (`ownerId` only honored for ADMIN) |
| `GET /:id`           | owner or ADMIN            | —                                                                                                         |
| `PATCH /:id`         | owner or ADMIN            | same fields as create, all optional, no `ownerId`                                                         |
| `DELETE /:id`        | owner or ADMIN            | 409 if any unit is `RENTED`; soft delete; audited (`PROPERTY_DELETED`)                                    |
| `POST /:id/images`   | owner or ADMIN            | multipart `images[]`, max 10 total, <=5MB each, jpeg/png/webp                                             |
| `DELETE /:id/images` | owner or ADMIN            | `{publicId}`                                                                                              |

### Units — nested for creation, flat elsewhere

| Method & path                        | Access                             | Body / query                                                                                                               |
| ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /units`                         | OWNER (own) / ADMIN (all) — cached | `?status=&bedrooms=&minArea=&maxArea=&propertyId=` + pagination                                                            |
| `POST /properties/:propertyId/units` | owner of that property or ADMIN    | `{unitNumber, building, floor?, area, bedrooms, bathrooms, description?}` — 409 on duplicate `(building, unitNumber)`      |
| `GET /units/:id`                     | owner or ADMIN                     | —                                                                                                                          |
| `PATCH /units/:id`                   | owner or ADMIN                     | same fields as create, all optional (status excluded)                                                                      |
| `DELETE /units/:id`                  | owner or ADMIN                     | —                                                                                                                          |
| `PATCH /units/:id/status`            | owner or ADMIN                     | `{status: AVAILABLE\|MAINTENANCE}` — 400 if unit is `RENTED` or the transition is invalid; audited (`UNIT_STATUS_CHANGED`) |

### `/leases`

| Method & path         | Access                                              | Body / query                                                                                                                         |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`               | TENANT (own) / OWNER (own properties) / ADMIN (all) | `?status=&unitId=&tenantId=` + pagination                                                                                            |
| `POST /`              | OWNER (own unit) / ADMIN                            | `{tenantId, unitId, startDate, endDate, notes?}` — 400 invalid dates/tenant, 409 overlap; notifies tenant, audited (`LEASE_CREATED`) |
| `GET /:id`            | tenant, owner, or ADMIN                             | —                                                                                                                                    |
| `PATCH /:id`          | owner or ADMIN                                      | `{startDate?, endDate?, notes?}` — only while `PENDING`, 409 otherwise or on new overlap                                             |
| `POST /:id/activate`  | owner or ADMIN                                      | 409 if not `PENDING` or unit not `AVAILABLE`; notifies tenant, audited (`LEASE_ACTIVATED`), invalidates unit/dashboard cache         |
| `POST /:id/terminate` | owner or ADMIN                                      | 409 if not `PENDING`/`ACTIVE`; notifies tenant, audited (`LEASE_TERMINATED`), invalidates cache                                      |

### `/maintenance`

| Method & path                   | Access                    | Body / query                                                                                                               |
| ------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                         | scoped by role            | `?status=&priority=&category=` + pagination                                                                                |
| `POST /`                        | TENANT (own active lease) | multipart `{title, description, category, priority, images[]<=5}` — 400 no active lease; notifies owner                    |
| `GET /:id`                      | scoped by role            | —                                                                                                                          |
| `POST /:id/assign`              | owner or ADMIN            | `{assignedStaffId, scheduledDate?, notes?}` — 400 bad staff, 409 not `OPEN`; notifies staff+tenant, audited                |
| `POST /:id/start`               | assigned staff only       | `{notes?}` — 409 not `ASSIGNED`                                                                                            |
| `POST /:id/complete`            | assigned staff only       | multipart `{resolutionDescription, notes?, completionImages[]<=5}` — 409 not `IN_PROGRESS`; notifies tenant+owner, audited |
| `POST /:id/close`               | tenant, owner, or ADMIN   | `{notes?}` — 409 not `RESOLVED`                                                                                            |
| `POST /:id/cancel`              | tenant, owner, or ADMIN   | `{notes?}` — 409 not `OPEN`/`ASSIGNED`                                                                                     |
| `DELETE /:id/images`            | tenant, owner, or ADMIN   | `{publicId}` — only while `OPEN`                                                                                           |
| `DELETE /:id/completion-images` | assigned staff only       | `{publicId}` — only while `RESOLVED`                                                                                       |
| `GET /:id/history`              | scoped by role            | ordered list of every transition                                                                                           |

### `/notifications` — always scoped to the caller

| Method & path     | Body / query                                                    |
| ----------------- | --------------------------------------------------------------- |
| `GET /`           | `?unread=true` + pagination; `meta.unreadCount` always included |
| `PATCH /:id/read` | —                                                               |
| `PATCH /read-all` | —                                                               |

### `/audit-logs` — ADMIN only

| Method & path | Query                                   |
| ------------- | --------------------------------------- |
| `GET /`       | `?action=&entity=&userId=` + pagination |

### `/analytics` — OWNER (own) / ADMIN (system-wide)

| Method & path    | Returns                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /dashboard` | `totalProperties, totalUnits, occupiedUnits, availableUnits, occupancyRate, activeLeases, expiredLeases, openMaintenanceRequests, resolvedMaintenanceRequests, avgMaintenanceResolutionHours, mostCommonMaintenanceCategories[]` — cached |

## Caching

| Key pattern                             | What                       | TTL | Invalidated by                                                                              |
| --------------------------------------- | -------------------------- | --- | ------------------------------------------------------------------------------------------- |
| `units:search:{sha256(scope+query)}`    | `GET /units` result pages  | 60s | any unit create/update/delete/status change; lease activate/terminate/expiration            |
| `dashboard:stats:{admin \| owner:<id>}` | `GET /analytics/dashboard` | 60s | the above, plus property create/update/delete/images, and any maintenance status transition |

TTL is a safety net; invalidation is explicit (`CacheInvalidationService.delByPattern`) — deliberately a full-pattern flush rather than surgical per-key invalidation, to keep it simple.

## Rate limiting

Global default: 100 requests/minute per IP. Stricter on `/auth/register`, `/login`, `/verify-email`, `/resend-verification-otp`, `/forgot-password`, `/reset-password`: 5/minute, then a block period. Backed by `RedisThrottlerStorage` (custom Lua-script implementation) so limits are shared across all app instances, not per-process.

## Security measures

- Helmet, CORS restricted to `CORS_ORIGINS`, `trust proxy` enabled for correct client IPs behind a reverse proxy.
- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` globally.
- JWT access/refresh with separate secrets; refresh token rotation + reuse detection; httpOnly refresh cookie.
- bcrypt password hashing (SHA-256 pre-hashed).
- OTPs are HMAC-hashed at rest in Redis, single-use, rate-limited, with a lockout after 5 wrong attempts.
- RBAC (`@Roles`) and resource-level ownership checks on every read/write — the two-layer defense against IDOR.
- Uploads validated by file content (magic bytes), not filename/MIME type; size- and count-capped.
- Row-level locking (`SELECT ... FOR UPDATE` via `pessimistic_write`) on every concurrent state transition (lease activation, maintenance transitions).
- Database-level constraints doing real work: `CHECK`, `EXCLUDE` (via `btree_gist`), partial unique indexes — invariants hold even under concurrent requests or an app bug, not just at the application layer.
- Global exception filter normalizes every error, never leaks stack traces or internal messages in production.
- Rate limiting on brute-forceable endpoints.

## Deployment

Configured for Vercel (`api/index.ts` + `vercel.json`), works on any Node host otherwise.

1. Build Command: `npm run migration:run && npm run build` — migrations apply before the new version serves traffic.
2. Set every environment variable from the table above in the host's dashboard.
3. `NODE_ENV=production` turns on Postgres SSL, `secure`+`sameSite=none` cookies, and hides internal error detail.
4. `trust proxy` is already enabled so rate limiting and audit-log IPs are correct behind Vercel's edge network.

## Complete project structure

```
api/
  index.ts                         Vercel serverless entry point (caches the bootstrapped Nest app)
src/
  main.ts, app.module.ts, app.setup.ts
  config/
    env.validation.ts               zod schema for every env var
  database/
    data-source.ts
    migrations/
      1790376650206-InitSchema.ts   full schema, verified up()/down() on an empty DB
      <timestamp>-AddGoogleAuth.ts   nullable passwordHash + googleId
    seeds/
      seed-admin.ts
  common/
    decorators/                     public, roles, current-user
    guards/                         jwt-auth, roles, google-auth
    filters/                        all-exceptions
    interceptors/                   response, logging
    pagination/                     pagination-query.dto, pagination.utils
    policies/                       policy.utils (canManageProperty, canAccessLease, canAccessMaintenance, canCloseOrCancelMaintenance)
    redis/                          redis.service, redis.module
    uploads/                        upload.service, upload.constants, image-ref.interface, dto/delete-image.dto
    mail/                           email.service, mail.module, templates/otp.ejs
    cache/                          cache-invalidation.service, cache.constants
    throttler/                      redis-throttler-storage.service, rate-limit.module
    lease-expiration/               lease-expiration.service
    types/                          authenticated-request.type
    utils/                          duration, hash, transform, decimal.transformer
  auth/
    auth.controller.ts, auth.service.ts, auth.module.ts, auth.constants.ts
    password.service.ts, otp.service.ts, otp.constants.ts
    entities/refresh-token.entity.ts
    enums/otp-purpose.enum.ts
    strategies/google.strategy.ts
    utils/refresh-cookie.util.ts
    types/token.types.ts
    dto/                            register, login, email, verify-email, reset-password,
                                     message-response, auth-response
  users/
    users.controller.ts, users.service.ts, users.module.ts
    entities/user.entity.ts
    enums/user-role.enum.ts
    dto/                            update-profile, update-user-status, update-user-role,
                                     list-users-query, user-response
  properties/
    properties.controller.ts, properties.service.ts, properties.module.ts
    entities/property.entity.ts
    enums/property-type.enum.ts
    dto/                            create-property, update-property, list-properties-query, property-response
  units/
    units.controller.ts, units.service.ts, units.module.ts
    entities/unit.entity.ts
    enums/unit-status.enum.ts
    dto/                            create-unit, update-unit, update-unit-status, list-units-query, unit-response
  leases/
    leases.controller.ts, leases.service.ts, leases.module.ts
    entities/lease.entity.ts
    enums/lease-status.enum.ts
    dto/                            create-lease, update-lease, list-leases-query, lease-response
  maintenance/
    maintenance.controller.ts, maintenance.service.ts, maintenance.module.ts
    entities/                       maintenance-request, maintenance-status-history
    enums/                          maintenance-category, maintenance-priority, maintenance-status
    dto/                            create-maintenance-request, assign-maintenance, complete-maintenance,
                                     transition-notes, list-maintenance-query, maintenance-response,
                                     maintenance-status-history-response
  notifications/
    notifications.controller.ts, notifications.service.ts, notifications.module.ts
    entities/notification.entity.ts
    enums/notification-type.enum.ts
    dto/                            list-notifications-query, notification-response
  audit-logs/
    audit-logs.controller.ts, audit-logs.service.ts, audit-logs.module.ts
    entities/audit-log.entity.ts
    enums/audit-action.enum.ts
    dto/                            list-audit-logs-query, audit-log-response
  analytics/
    analytics.controller.ts, analytics.service.ts, analytics.module.ts
    dto/dashboard-stats.dto.ts
vercel.json
.env.example
nest-cli.json                       assets: common/mail/templates copied to dist
```
