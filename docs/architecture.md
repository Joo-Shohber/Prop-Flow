# Architecture

> **Scope and source of truth.** This documentation set was written from the implementation history of the project (the code, DTOs, and decisions produced and discussed while building it), not from an automated scan of a checked-out repository. Where a detail could not be confirmed as present in the final codebase, the relevant document says so explicitly under a "Verify" note rather than asserting it.

## Overview

PropFlow is a modular monolith built on NestJS 12, running as native ECMAScript modules (no CommonJS build). It is a single deployable application composed of independent feature modules that communicate through explicit service injection — there is no message bus, no inter-service network calls, and no shared mutable state outside of PostgreSQL and Redis.

Controllers are intentionally thin: they perform no business logic, no direct repository access, and no direct calls to external services (Cloudinary, SMTP, Redis). Every controller method delegates immediately to a service method. All business rules, transaction boundaries, and authorization checks live in services.

## Folder structure

```
api/
  index.ts                   Vercel serverless entry point
src/
  main.ts                    Local/standard Nest bootstrap
  app.module.ts               Root module — wires every feature and common module
  app.setup.ts                 Shared app configuration (helmet, cookies, validation, Swagger, trust proxy)
  config/
    env.validation.ts          zod schema; the single source of truth for required environment variables
  database/
    data-source.ts              TypeORM CLI DataSource (migrations only, no synchronize)
    migrations/                  InitSchema, AddGoogleAuth, and any subsequent schema migrations
    seeds/seed-admin.ts          One-off script to create the first ADMIN account
  common/                       Cross-cutting infrastructure (see below)
  auth/  users/  properties/  units/  leases/  maintenance/
  notifications/  audit-logs/  analytics/     Feature modules
```

Each feature module follows the same internal layout: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `entities/`, `enums/`, `dto/`.

## Modules and responsibilities

| Module                | Responsibility                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthModule`          | Registration, login, refresh rotation, logout, email verification, password reset, Google OAuth. Owns the global `JwtAuthGuard` and `RolesGuard` (registered here as `APP_GUARD`). |
| `UsersModule`         | Profile management, avatar upload, admin user administration (activate/deactivate, role changes).                                                                                  |
| `PropertiesModule`    | Property CRUD, soft delete, image management.                                                                                                                                      |
| `UnitsModule`         | Unit CRUD, manual status transitions, cached search.                                                                                                                               |
| `LeasesModule`        | Lease lifecycle: creation, activation, termination, lazy expiration.                                                                                                               |
| `MaintenanceModule`   | Maintenance request lifecycle and status history.                                                                                                                                  |
| `NotificationsModule` | Per-user notification inbox (read/unread).                                                                                                                                         |
| `AuditLogsModule`     | Append-only audit trail, ADMIN-only read access.                                                                                                                                   |
| `AnalyticsModule`     | Aggregated dashboard statistics, cached.                                                                                                                                           |

### Common infrastructure (`src/common/`)

| Directory           | Contents                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis/`            | `RedisService` — thin `ioredis` wrapper (`getJson`, `setJson`, `del`, `delByPattern` via non-blocking `SCAN`). Registered as a global module.                           |
| `uploads/`          | `UploadService` — Cloudinary upload/delete with magic-byte validation via `file-type`. Global module.                                                                   |
| `mail/`             | `EmailService` — direct `nodemailer` + `ejs` template rendering. No wrapper library.                                                                                    |
| `cache/`            | `CacheInvalidationService` — two methods (`invalidateUnitsAndDashboard`, `invalidateDashboard`) wrapping `RedisService.delByPattern`. Global module.                    |
| `throttler/`        | `RedisThrottlerStorage` — a from-scratch implementation of `@nestjs/throttler`'s storage interface, plus `RateLimitModule` which registers the global `ThrottlerGuard`. |
| `lease-expiration/` | `LeaseExpirationService` — the lazy lease-expiration sweep. Global module.                                                                                              |
| `policies/`         | `policy.utils.ts` — pure functions used by services for resource-level authorization.                                                                                   |
| `pagination/`       | `PaginationQueryDto` and helpers (`resolveSort`, `toSkip`, `Paginated.of`).                                                                                             |
| `guards/`           | `JwtAuthGuard`, `RolesGuard`, `GoogleAuthGuard`.                                                                                                                        |
| `filters/`          | `AllExceptionsFilter` — normalizes every thrown error, maps PostgreSQL error codes to HTTP statuses.                                                                    |
| `interceptors/`     | `ResponseInterceptor` (wraps success responses), `LoggingInterceptor`.                                                                                                  |
| `decorators/`       | `@Public()`, `@Roles()`, `@CurrentUser()`.                                                                                                                              |

## Module dependency graph

Dependencies flow one direction; there are no circular module imports:

```
AuthModule        -> UsersModule, MailModule, PassportModule, JwtModule
PropertiesModule  -> UsersModule, AuditLogsModule
UnitsModule       -> PropertiesModule, AuditLogsModule
LeasesModule      -> UnitsModule, UsersModule, NotificationsModule, AuditLogsModule
MaintenanceModule -> LeasesModule, UsersModule, NotificationsModule, AuditLogsModule
AnalyticsModule   -> (TypeORM repositories for Property, Unit, Lease, MaintenanceRequest — no service-level dependency)
```

`RedisModule`, `UploadsModule`, `CacheInvalidationModule`, and `LeaseExpirationModule` are declared `@Global()` and imported once in `AppModule`; every other module consumes them by dependency injection without re-importing.

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

Ordering: `JwtAuthGuard` must run before `RolesGuard`, since `RolesGuard` reads `request.user`, which `JwtAuthGuard` attaches; both are provided by `AuthModule`, in that order. `ThrottlerGuard` is provided by a different module (`RateLimitModule`), and global guards run in module registration order, so its position relative to the other two follows the order of the modules in `AppModule.imports`. It does not depend on `request.user` (it tracks by IP), so either relative order is functionally correct; which one applies was not verified against the final `AppModule`.

## Global configuration

- **`ConfigModule`**: loaded once (`isGlobal: true`), validated against a `zod` schema in `env.validation.ts`. The application refuses to boot if any required variable is missing or malformed.
- **`TypeOrmModule`**: configured via `DATABASE_URL`, `synchronize: false` unconditionally (schema changes only via migrations), SSL enabled when `NODE_ENV=production`.
- **Swagger**: generated at `/api/docs` from decorators on controllers and DTOs. This document intentionally does not describe Swagger further.

## Architectural decisions worth calling out

- **Modular monolith over microservices.** All modules share one process and one database connection pool; chosen for a single-team, single-deployable project of this size.
- **Migrations only, no `synchronize` in any environment.** The schema is defined by `src/database/migrations/*`, verified end-to-end (up then down then up again) against an empty database before being treated as final.
- **A hand-written Redis-backed throttler storage.** The community Redis storage adapters for `@nestjs/throttler` do not declare compatibility with NestJS 12's peer dependency range, so `RedisThrottlerStorage` implements the `ThrottlerStorage` interface directly with a single atomic Lua script.
- **No `@nestjs-modules/mailer`.** It was removed after a production incompatibility: NestJS 12's `@nestjs/common` ships as pure ESM with no CommonJS build, and the mailer package's compiled output still calls `require('@nestjs/common')` internally, which throws `ERR_REQUIRE_ESM` in environments without Node's `require(esm)` interop. `EmailService` now calls `nodemailer` and `ejs` directly.
- **Two coexisting entry points.** `src/main.ts` for local development and traditional hosting, and `api/index.ts` for Vercel, which bootstraps the same `AppModule` once and reuses it across warm serverless invocations.
