# Architecture

This document describes the running NestJS application as implemented in this repository. Behavior that is not present in the code is not documented as if it were.

## Overview

PropFlow is a modular monolith on NestJS 12, native ESM (`"type": "module"`), Node **22.x**, PostgreSQL (TypeORM, `synchronize: false`), and Redis. Feature modules communicate through Nest dependency injection. There is no message bus and no inter-service HTTP.

Controllers are thin: no repositories, no Cloudinary/SMTP/Redis calls. Business rules, transactions, and resource-level authorization live in services.

## Folder structure

```
api/
  index.ts                   Vercel serverless entry (bootstraps AppModule once per warm instance)
vercel.json                  builds + routes + includeFiles for mail templates
nest-cli.json                copies mail templates into dist on nest build
src/
  main.ts                    Local / conventional Node bootstrap (listen on PORT, log DOMAIN)
  app.module.ts              Root module
  app.setup.ts               helmet, CORS, cookies, ValidationPipe, global prefix, Swagger
  app.controller.ts          Public GET / (under the global prefix)
  config/env.validation.ts   zod schema for environment variables
  database/
    data-source.ts           TypeORM CLI DataSource
    migrations/              see database.md
    seeds/seed-admin.ts
  common/                    Cross-cutting infrastructure
  auth/ users/ properties/ units/ leases/ rental-requests/
  maintenance/ notifications/ audit-logs/ analytics/
```

Each feature module typically has `*.controller.ts`, `*.service.ts`, `*.module.ts`, `entities/`, `enums/`, `dto/`. There are currently no `*.spec.ts` files in the tree.

## Modules and responsibilities

| Module | Responsibility |
| --- | --- |
| `AuthModule` | Registration, login, refresh rotation, logout, email verification, password reset, Google OAuth. Registers global `JwtAuthGuard` and `RolesGuard`. |
| `UsersModule` | Profile, avatar, OWNER/ADMIN directory, ADMIN user administration. |
| `PropertiesModule` | Property CRUD, soft delete, images, optional first unit on create. Imports `Unit` repository and `NotificationsModule` (pending-lease termination on delete). For a TENANT, `GET /properties/:id` returns the property plus `AVAILABLE` units. |
| `UnitsModule` | Unit CRUD, manual `AVAILABLE` ↔ `MAINTENANCE`, images, cached search. TENANT may list and open `AVAILABLE` units. |
| `LeasesModule` | Direct lease create/update, activate, terminate, lazy expiration hook. |
| `RentalRequestsModule` | Tenant requests and owner/admin approve/reject. Registers `RentalRequest`, `Unit`, and `Lease` repositories; does not import `UnitsModule` or `LeasesModule`. |
| `MaintenanceModule` | Request lifecycle, history, request and completion images. |
| `NotificationsModule` | Per-user inbox. |
| `AuditLogsModule` | Append-only trail; ADMIN read. |
| `AnalyticsModule` | Cached dashboard aggregates. |

### Common infrastructure (`src/common/`)

| Directory | Contents |
| --- | --- |
| `redis/` | Global `RedisService` (`ioredis`, `maxRetriesPerRequest: 3`). |
| `uploads/` | Global `UploadService` (`file-type` + Cloudinary). Folders: `propflow/properties`, `propflow/units`, `propflow/maintenance`, `propflow/avatars`. |
| `mail/` | `EmailService` + `templates/otp.ejs` read via `ejs.renderFile` from `import.meta.dirname`. Failures logged, never thrown. |
| `cache/` | `CacheInvalidationService` — `invalidateUnitsAndDashboard`, `invalidateDashboard`. |
| `throttler/` | `RedisThrottlerStorage` + `RateLimitModule` (global `ThrottlerGuard`). |
| `lease-expiration/` | Global `LeaseExpirationService`. |
| `policies/` | Pure policy functions (see `authorization.md`). |
| `pagination/` | `PaginationQueryDto` (`page` default 1, `limit` default 20 max 100, `sortBy`, `sortOrder` default `DESC`). |
| `guards/` | `JwtAuthGuard`, `RolesGuard`, `GoogleAuthGuard`. |
| `filters/` | `AllExceptionsFilter`. |
| `interceptors/` | `ResponseInterceptor`, `LoggingInterceptor`. |
| `decorators/` | `@Public()`, `@Roles()`, `@CurrentUser()`. |

## Module dependency graph

```
AuthModule            -> UsersModule, MailModule, PassportModule, JwtModule
PropertiesModule      -> UsersModule, AuditLogsModule, NotificationsModule, TypeORM Property+Unit
UnitsModule           -> PropertiesModule, AuditLogsModule
LeasesModule          -> UnitsModule, UsersModule, NotificationsModule, AuditLogsModule
RentalRequestsModule  -> NotificationsModule, AuditLogsModule, TypeORM RentalRequest+Unit+Lease
MaintenanceModule     -> LeasesModule, UsersModule, NotificationsModule, AuditLogsModule
AnalyticsModule       -> TypeORM Property, Unit, Lease, MaintenanceRequest
```

`RedisModule`, `UploadsModule`, `CacheInvalidationModule`, and `LeaseExpirationModule` are `@Global()` and imported once in `AppModule`.

`RentalRequestsModule` loads units without `UnitsService` so a tenant is not subjected to owner-only unit access checks, and inserts a `PENDING` lease inside its own transaction instead of calling `LeasesService.create` (which would open a nested transaction and emit `LEASE_CREATED` side effects).

## Request lifecycle

```
Client
  -> Helmet ({ contentSecurityPolicy: false })
  -> CORS (CORS_ORIGINS, credentials: true)
  -> cookie-parser
  -> ValidationPipe ({ whitelist, forbidNonWhitelisted, transform })
  -> global APP_GUARD, in registration order:
       ThrottlerGuard     -- RateLimitModule is imported first
       JwtAuthGuard       -- skips @Public(); Bearer access token; reloads User; requires isActive
       RolesGuard         -- @Roles() metadata; if absent, any authenticated user
  -> Controller
  -> Service
  -> LoggingInterceptor (success timing)
  -> ResponseInterceptor  -- { success: true, data, meta? }
  -> AllExceptionsFilter  -- { success: false, statusCode, error, message, details?, path, timestamp }
```

`AppModule.imports` order (relevant for guards): Redis, CacheInvalidation, **RateLimit**, Uploads, LeaseExpiration, **Auth**, Users, Properties, Units, Leases, RentalRequests, Maintenance, Notifications, AuditLogs, Analytics, Config, TypeORM.

Global prefix is `api/v1`. Swagger is mounted at `api/docs` (not under the prefix).

## Rental request flow

```
TENANT  GET /properties, GET /properties/:id, GET /units, GET /units/:id
TENANT  POST /rental-requests                   -> RentalRequest(PENDING)
OWNER/ADMIN  POST /rental-requests/:id/approve  -> APPROVED + Lease(PENDING), unit AVAILABLE
OWNER/ADMIN  POST /rental-requests/:id/reject   -> REJECTED
OWNER/ADMIN  POST /leases/:id/activate          -> Lease(ACTIVE) + Unit(RENTED)
```

Approval lock order is request row then unit row. Direct `POST /leases` does not lock the unit; the lease `EXCLUDE` constraint is the race backstop.

## Global configuration

- **ConfigModule**: `isGlobal: true`, `validate: validateEnv`.
- **TypeOrmModule**: `DATABASE_URL`, `autoLoadEntities: true`, `synchronize: false`, SSL when `NODE_ENV=production` with `rejectUnauthorized: false`.
- **Swagger**: title “PropFlow API”, Bearer auth, CSS/JS from jsDelivr (useful on hosts that do not serve swagger-ui static files).

## Deployment packaging of runtime-read files

`EmailService` reads `otp.ejs` from disk. Bundlers that only follow imports will miss it.

- **`nest build`:** `nest-cli.json` `compilerOptions.assets` copies `common/mail/templates/**/*`.
- **Vercel:** `vercel.json` `includeFiles`: `src/common/mail/templates/**` so the file is at `/var/task/src/common/mail/templates`. Because `sendOtp` swallows errors, a missing template still yields `201` on register with no email.

## Architectural decisions

- Modular monolith, migrations only, database constraints as the final concurrency guard.
- Lazy lease expiration instead of a scheduler (fits serverless).
- Soft-deleted properties require explicit `deletedAt` handling on queries that do not go through TypeORM’s entity soft-delete filter.
- `rentAmount` is an integer snapshot, never client-supplied on leases/requests.
- Custom Redis throttler storage for Nest 12.
- Direct `nodemailer` + `ejs` after dropping `@nestjs-modules/mailer` (ESM/`require` incompatibility).
- Mail failures are non-fatal by design.
- Two entry points: `src/main.ts` and `api/index.ts`.
- A rental request does not reserve a unit; uniqueness is per tenant+unit, not per date range.
