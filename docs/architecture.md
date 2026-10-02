# Architecture

> **Scope and source of truth.** This documentation set was written from the implementation history of the project (the code, DTOs, and decisions produced and discussed while building it), not from an automated scan of a checked-out repository. Where a detail could not be confirmed as present in the final codebase, the relevant document says so explicitly under a "Verify" note rather than asserting it.

## Overview

PropFlow is a modular monolith built on NestJS 12, running as native ECMAScript modules (no CommonJS build) on Node >= 22.12, with PostgreSQL (TypeORM) and Redis. It is a single deployable application composed of independent feature modules that communicate through explicit service injection — there is no message bus, no inter-service network calls, and no shared mutable state outside of PostgreSQL and Redis.

Controllers are intentionally thin: they perform no business logic, no direct repository access, and no direct calls to external services (Cloudinary, SMTP, Redis). Every controller method delegates immediately to a service method. All business rules, transaction boundaries, and authorization checks live in services.

## Folder structure

```
api/
  index.ts                   Vercel serverless entry point
vercel.json                  Vercel build/route config (+ includeFiles for mail templates)
nest-cli.json                Nest CLI config (copies mail templates into dist on `nest build` only)
.env.example                 Documented environment variables
src/
  main.ts                    Local/standard Nest bootstrap
  app.module.ts               Root module — wires every feature and common module
  app.setup.ts                 Shared app configuration (helmet, cookies, validation, Swagger, trust proxy)
  config/
    env.validation.ts          zod schema; the single source of truth for required environment variables
  database/
    data-source.ts              TypeORM CLI DataSource (migrations only, no synchronize)
    migrations/                  InitSchema, AddGoogleAuth, AddPropertyCreatedAuditAction,
                                 AddRentalRequests, AddUnitImages, AddRentAmount
    seeds/seed-admin.ts          One-off script to create the first ADMIN account
  common/                       Cross-cutting infrastructure (see below)
    decorators/ guards/ filters/ interceptors/ pagination/ policies/
    redis/ uploads/ cache/ throttler/ lease-expiration/ types/ utils/
    mail/
      email.service.ts           nodemailer + ejs
      templates/otp.ejs          OTP email template, read from disk at runtime
  auth/                         incl. strategies/google.strategy.ts, utils/refresh-cookie.util.ts
  users/  properties/  units/  leases/  rental-requests/  maintenance/
  notifications/  audit-logs/  analytics/     Feature modules
```

Each feature module follows the same internal layout: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `entities/`, `enums/`, `dto/`. Modules with unit tests keep a `*.service.spec.ts` next to the service (currently `rental-requests.service.spec.ts`).

## Modules and responsibilities

| Module                 | Responsibility                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AuthModule`           | Registration, login, refresh rotation, logout, email verification, password reset, Google OAuth. Owns the global `JwtAuthGuard` and `RolesGuard` (registered here as `APP_GUARD`).                                             |
| `UsersModule`          | Profile management, avatar upload, the OWNER/ADMIN user directory (`GET /users/directory`, minimal fields, active users only), and admin user administration (activate/deactivate, role changes).                              |
| `PropertiesModule`     | Property CRUD, soft delete, image management (max 10). For a TENANT, `GET /properties/:id` returns the property plus its `AVAILABLE` units only — this is how tenants discover rentable units.                                 |
| `UnitsModule`          | Unit CRUD, manual status transitions (`AVAILABLE` <-> `MAINTENANCE`), image management (max 10), and cached search. `GET /units` gives tenants a cross-property, `AVAILABLE`-only, price-filterable search.                    |
| `LeasesModule`         | Lease lifecycle: creation, activation, termination, lazy expiration.                                                                                                                                                           |
| `RentalRequestsModule` | Tenant-initiated rental requests and the owner/admin approve/reject workflow. Approval creates a `PENDING` lease inside one transaction and never changes unit status; activation remains the exclusive job of `LeasesModule`. |
| `MaintenanceModule`    | Maintenance request lifecycle and status history, including request images (addable while `OPEN`) and completion images.                                                                                                       |
| `NotificationsModule`  | Per-user notification inbox (read/unread).                                                                                                                                                                                     |
| `AuditLogsModule`      | Append-only audit trail, ADMIN-only read access.                                                                                                                                                                               |
| `AnalyticsModule`      | Aggregated dashboard statistics, cached.                                                                                                                                                                                       |

### Common infrastructure (`src/common/`)

| Directory           | Contents                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis/`            | `RedisService` — thin `ioredis` wrapper (`getJson`, `setJson` with TTL, `del`, `delByPattern` via non-blocking `SCAN`). Registered as a global module. Backs the cache, OTP storage and rate-limit storage.                                                                                                                                                                                                          |
| `uploads/`          | `UploadService` — `uploadImages(files, folder, maxCount)` (magic-byte validation via `file-type`, then Cloudinary) and `deleteImages(images)`. Shared by property, unit and maintenance images and user avatars; deleting an image also deletes it from Cloudinary. Global module.                                                                                                                                   |
| `mail/`             | `EmailService` — direct `nodemailer` + `ejs` template rendering. No wrapper library. Templates live in `mail/templates/*.ejs` and are read from disk at runtime with `ejs.renderFile`, so they must be shipped explicitly in every deployment target (see "Deployment packaging of runtime-read files"). `sendOtp` never throws: failures are logged and swallowed, so a mail failure does not fail the API request. |
| `cache/`            | `CacheInvalidationService` — two methods (`invalidateUnitsAndDashboard`, `invalidateDashboard`) wrapping `RedisService.delByPattern`. Global module.                                                                                                                                                                                                                                                                 |
| `throttler/`        | `RedisThrottlerStorage` — a from-scratch implementation of `@nestjs/throttler`'s storage interface (one atomic Lua script), plus `RateLimitModule` which registers the global `ThrottlerGuard`. Limits: 100 requests/min/IP globally; `/auth/*` as a group is 5/min, followed by a block period.                                                                                                                     |
| `lease-expiration/` | `LeaseExpirationService` — the lazy lease-expiration sweep (`run()`). Global module. Called before every lease, unit and rental-request read and write, so availability checks never see already-expired leases.                                                                                                                                                                                                     |
| `policies/`         | `policy.utils.ts` — pure functions used by services for resource-level authorization (`canManageProperty`, `canAccessLease`, `canAccessRentalRequest`, `canAccessMaintenance`, `canCloseOrCancelMaintenance`).                                                                                                                                                                                                       |
| `pagination/`       | `PaginationQueryDto` and helpers (`resolveSort`, `toSkip`, `Paginated.of`). Query params: `page`, `limit` (max 100), `sortBy`, `sortOrder`.                                                                                                                                                                                                                                                                          |
| `guards/`           | `JwtAuthGuard`, `RolesGuard`, `GoogleAuthGuard`.                                                                                                                                                                                                                                                                                                                                                                     |
| `filters/`          | `AllExceptionsFilter` — normalizes every thrown error, maps PostgreSQL error codes to HTTP statuses (including `23P01` exclusion and `23505` unique violations -> 409, which is how a lease constraint hit during rental request approval surfaces), and hides internal error details in production.                                                                                                                 |
| `interceptors/`     | `ResponseInterceptor` (wraps success responses as `{ success: true, data, meta? }`), `LoggingInterceptor`.                                                                                                                                                                                                                                                                                                           |
| `decorators/`       | `@Public()`, `@Roles()`, `@CurrentUser()`.                                                                                                                                                                                                                                                                                                                                                                           |

## Module dependency graph

Dependencies flow one direction; there are no circular module imports:

```
AuthModule            -> UsersModule, MailModule, PassportModule, JwtModule
PropertiesModule      -> UsersModule, AuditLogsModule
UnitsModule           -> PropertiesModule, AuditLogsModule
LeasesModule          -> UnitsModule, UsersModule, NotificationsModule, AuditLogsModule
RentalRequestsModule  -> NotificationsModule, AuditLogsModule
                         (+ TypeORM repositories for RentalRequest, Unit, Lease — no UnitsModule/LeasesModule dependency)
MaintenanceModule     -> LeasesModule, UsersModule, NotificationsModule, AuditLogsModule
AnalyticsModule       -> (TypeORM repositories for Property, Unit, Lease, MaintenanceRequest — no service-level dependency)
```

`RedisModule`, `UploadsModule`, `CacheInvalidationModule`, and `LeaseExpirationModule` are declared `@Global()` and imported once in `AppModule`; every other module consumes them by dependency injection without re-importing.

`RentalRequestsModule` is deliberately decoupled from `UnitsModule` and `LeasesModule`. It needs to load a unit regardless of the caller's role (a tenant may not go through `UnitsService`'s ownership-based access check) and to insert a `PENDING` lease inside its own transaction, so it registers the `Unit` and `Lease` repositories directly via `TypeOrmModule.forFeature` instead of reusing those services. Existing lease and unit logic is therefore untouched.

## Request lifecycle

```
Client
  -> Helmet (security headers)
  -> CORS (CORS_ORIGINS allow-list)
  -> cookie-parser
  -> ValidationPipe (whitelist, forbidNonWhitelisted, transform)
  -> global guards (all registered with APP_GUARD):
       JwtAuthGuard    -- verifies access token, reloads the User, checks isActive; @Public() skips this
       RolesGuard      -- checks @Roles() metadata against the authenticated user's role
       ThrottlerGuard  -- Redis-backed rate limit check, tracked by client IP
  -> Controller method
  -> Service method (business logic, transactions, resource-level policy checks)
  -> ResponseInterceptor        -- wraps the return value as { success: true, data, meta? }
  -> (on any thrown exception) AllExceptionsFilter -- normalizes to { success: false, statusCode, error, message, ... }
```

Ordering: `JwtAuthGuard` must run before `RolesGuard`, since `RolesGuard` reads `request.user`, which `JwtAuthGuard` attaches; both are provided by `AuthModule`, in that order. `ThrottlerGuard` is provided by a different module (`RateLimitModule`), and global guards run in module registration order, so its position relative to the other two follows the order of the modules in `AppModule.imports`. The README documents the order as `JwtAuthGuard` -> `RolesGuard` -> `ThrottlerGuard`. It does not depend on `request.user` (it tracks by IP), so either relative order is functionally correct; the actual order was not verified against the final `AppModule`.

## Rental request flow

Rental requests add a tenant-facing entry point to lease creation without changing the lease workflow:

```
TENANT  GET /properties, GET /properties/:id   -> property + AVAILABLE units   (or GET /units, AVAILABLE-only)
TENANT  POST /rental-requests                   -> RentalRequest(PENDING)   (no lease, unit untouched)
OWNER/ADMIN  POST /rental-requests/:id/approve  -> RentalRequest(APPROVED) + Lease(PENDING), unit stays AVAILABLE
OWNER/ADMIN  POST /rental-requests/:id/reject   -> RentalRequest(REJECTED)
OWNER/ADMIN  POST /leases/:id/activate (existing, unchanged) -> Lease(ACTIVE) + Unit(RENTED)
```

Creation re-verifies everything server-side: the unit exists and its property is not soft-deleted, the unit is `AVAILABLE`, `startDate < endDate`, and the range does not overlap a `PENDING`/`ACTIVE` lease. `tenantId` and `status` are never client input (sending them returns `400`). The unit's `rentAmount` is snapshotted onto the request, the owner is notified, and the action is audited.

Approval runs in a single database transaction with a fixed lock order — the request row (no joins), then the unit row — followed by authorization, state, unit-availability, tenant-validity and lease-overlap re-checks, then creation of the `PENDING` lease, the status change, one tenant notification and one audit entry. The lease exclusion constraint remains the final concurrency guard against a concurrent direct `POST /leases`; a violation rolls the transaction back (the request stays `PENDING`) and `AllExceptionsFilter` returns 409. The lock order (request -> unit) cannot deadlock with lease activation (lease -> unit), because approval never locks a lease row. Acting on a request that is already `APPROVED` or `REJECTED` also returns 409.

## Global configuration

- **`ConfigModule`**: loaded once (`isGlobal: true`), validated against a `zod` schema in `env.validation.ts`. The application refuses to boot if any required variable is missing or malformed.
- **`TypeOrmModule`**: configured via `DATABASE_URL`, `synchronize: false` unconditionally (schema changes only via migrations), SSL enabled when `NODE_ENV=production`. Two Postgres extensions are required, `uuid-ossp` and `btree_gist` (the latter for the lease exclusion constraint); they are auto-installed on connect and also created explicitly in the initial migration, so the database role needs `CREATE EXTENSION` privileges.
- **Swagger**: generated at `/api/docs` from decorators on controllers and DTOs. This document intentionally does not describe Swagger further.

## Deployment packaging of runtime-read files

`EmailService` resolves its template directory with `import.meta.dirname` and reads `otp.ejs` through `ejs.renderFile`. That is a runtime filesystem read, not an import, so bundlers that trace imports do not see it.

- **Local / `nest build`:** `nest-cli.json` declares `common/mail/templates/**/*` under `compilerOptions.assets`, so the files are copied into `dist/`. This setting has **no effect on Vercel**, because Vercel does not run `nest build` for the function.
- **Vercel:** `@vercel/node` compiles `api/index.ts` and includes only files reachable through imports. Without extra config, the function bundle lacks `otp.ejs` and sending fails with `ENOENT: no such file or directory, open '/var/task/src/common/mail/templates/otp.ejs'`. Because `EmailService` swallows errors, the symptom is `POST /auth/register` returning `201` while no verification email is sent.
- **Fix in place:** `vercel.json` uses the `builds` form, so `includeFiles` is set inside that build's `config`:

  ```json
  {
    "version": 2,
    "builds": [
      {
        "src": "api/index.ts",
        "use": "@vercel/node",
        "config": {
          "includeFiles": ["src/common/mail/templates/**"]
        }
      }
    ],
    "routes": [{ "src": "/(.*)", "dest": "api/index.ts" }]
  }
  ```

  The template directory is then present at `/var/task/src/common/mail/templates`, which is the path `import.meta.dirname` + `templates` resolves to at runtime.

- **Caveat:** `includeFiles` is Vercel-specific bundling behavior. Any new runtime-read file (another `.ejs` template, a static asset) must be added to the glob, and moving to another host requires an equivalent step.
- **Alternative (not applied):** embed templates as TypeScript string constants and render with `ejs.render`. That removes the filesystem dependency entirely and works on any platform; it is the fallback if `includeFiles` ever stops matching the runtime path.

## Testing

Unit tests run with Vitest (`npm run test`). The rental request service is covered by `rental-requests.service.spec.ts`, which constructs the service directly with mocked repositories, a mocked `DataSource.transaction`, and mocked notification/audit services. It covers creation validation, resource-level authorization (tenant/owner/admin, IDOR cases), the request state machine, the approval invariants (lease created as `PENDING`, unit status untouched, single notification and audit entry), lock ordering, and error propagation on constraint violations.

The true concurrency guarantees (two simultaneous approvals on the same unit, approval racing a direct lease creation) depend on PostgreSQL row locks and the lease exclusion constraint and therefore cannot be proven by these mocks; they need to be exercised against a real database (e.g. two parallel `approve` requests, expecting one `200` and one `409`).

## Architectural decisions worth calling out

- **Modular monolith over microservices.** All modules share one process and one database connection pool; chosen for a single-team, single-deployable project of this size.
- **Migrations only, no `synchronize` in any environment.** The schema is defined by `src/database/migrations/*`, verified end-to-end (up then down then up again) against an empty database before being treated as final. Later migrations (such as `AddRentalRequests`) are produced with `migration:generate` and reviewed before being run.
- **Real database constraints as the final concurrency guard.** Beyond application checks and row locks, `CHECK (startDate < endDate)`, the lease `EXCLUDE USING gist` overlap constraint, and the partial unique index (at most one `ACTIVE` lease per unit) make invalid states unrepresentable even under races.
- **Lazy lease expiration instead of a scheduler.** `LeaseExpirationService.run()` is a set-based transaction executed before every lease/unit/rental-request read and write, so no cron or background worker is needed. This suits the serverless (Vercel) deployment, where there is no long-lived process to host a scheduler.
- **Soft-deleted properties and "zombie units".** `Property` uses soft delete, `Unit` does not. TypeORM filters soft-deleted rows only for direct entity queries, not for manual joins or subqueries, so every query that reaches `Unit` through `Property` (unit search, leases, maintenance, rental requests) explicitly adds `property."deletedAt" IS NULL`. Any new such query must include it too.
- **`rentAmount` is snapshotted.** The unit's current asking rent is copied onto rental requests and leases when they are created (and never client-supplied), so later rent changes do not alter existing agreements.
- **A hand-written Redis-backed throttler storage.** The community Redis storage adapters for `@nestjs/throttler` do not declare compatibility with NestJS 12's peer dependency range, so `RedisThrottlerStorage` implements the `ThrottlerStorage` interface directly with a single atomic Lua script.
- **No `@nestjs-modules/mailer`.** It was removed after a production incompatibility: NestJS 12's `@nestjs/common` ships as pure ESM with no CommonJS build, and the mailer package's compiled output still calls `require('@nestjs/common')` internally, which throws `ERR_REQUIRE_ESM` in environments without Node's `require(esm)` interop. `EmailService` now calls `nodemailer` and `ejs` directly.
- **Mail templates are files shipped explicitly, not bundled code.** Templates are `.ejs` files read at runtime, so each deployment target must include them (`nest-cli.json` assets for `nest build`, `includeFiles` in `vercel.json` for Vercel). This was discovered in production when Vercel omitted `otp.ejs`.
- **Mail failures are non-fatal by design.** `EmailService.sendOtp` logs and swallows errors, so registration succeeds even if the email cannot be sent. The trade-off is that failures are only visible in logs; affected users must use `resend-verification-otp` once the cause is fixed.
- **Two coexisting entry points.** `src/main.ts` for local development and traditional hosting, and `api/index.ts` for Vercel, which bootstraps the same `AppModule` once and reuses it across warm serverless invocations.
- **A rental request does not reserve a unit.** The unit stays `AVAILABLE` until a lease is activated, and several tenants can hold pending requests for the same dates. Conflicts are settled at approval time by the existing lease constraints rather than by a second availability system or an extra constraint on `rental_requests`.
- **Approval creates the lease directly instead of reusing `LeasesService.create`.** `LeasesService.create` owns its own transaction and emits `LEASE_CREATED` notifications/audit entries; approval needs to join its own transaction and emit exactly one `RENTAL_REQUEST_APPROVED` notification and audit entry. Creating the `PENDING` lease with the transaction manager keeps `LeasesService` unchanged.
- **Constraint violations are translated centrally.** `RentalRequestsService` lets Postgres errors propagate; the global `AllExceptionsFilter` maps `23P01`/`23505` to 409, so conflict handling is consistent with the rest of the API.

## Verify

- The README documents `rentAmount` as `numeric(10,2)` on `units`, `leases` and `rental_requests`, added by the `AddRentAmount` migration. Confirm the final entities and the generated migration match.
- The `AddRentalRequests` migration's generated SQL should be reviewed (new `rental_requests` table, extended `notifications.type` and `audit_logs.action` enums, and no unintended change to the `leases` constraints) before it is run in a new environment.
- After deploying the `includeFiles` change, confirm on Vercel that `POST /api/v1/auth/register` no longer logs `ENOENT` for `otp.ejs` and that the verification email actually arrives. If `ENOENT` persists, the runtime path does not match the included path; adjust the glob or switch to the TypeScript-embedded template.
- Confirm `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (and `FRONTEND_URL`) are set in Vercel's Production environment variables, and that a redeploy followed any change to them.
