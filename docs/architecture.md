# Architecture

This document describes the running NestJS application as implemented in this repository. Behavior that is not present in the code is not documented as if it were.

## Overview

PropFlow is a modular monolith on NestJS 12, native ESM (`"type": "module"`), Node **>= 22.12**, PostgreSQL (TypeORM, `synchronize: false`), and Redis. Feature modules communicate through Nest dependency injection. There is no message bus and no inter-service HTTP.

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
    migrations/               see database.md
    seeds/seed-admin.ts
  common/                    Cross-cutting infrastructure
  auth/
  users/
  properties/
  units/
  leases/
  rental-requests/
  maintenance/
  notifications/
  audit-logs/
  analytics/
```

Each feature module typically has `*.controller.ts`, `*.service.ts`, `*.module.ts`, `entities/`, `enums/`, and `dto/`. There are currently no `*.spec.ts` files in the tree.

## Modules and responsibilities

| Module                 | Responsibility                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AuthModule`           | Registration, login, refresh rotation, logout, email verification, password reset, Google OAuth. Registers global `JwtAuthGuard` and `RolesGuard`.                                                                                               |
| `UsersModule`          | Profile, avatar, OWNER/ADMIN directory, ADMIN user administration.                                                                                                                                                                               |
| `PropertiesModule`     | Property CRUD, soft delete, images, optional first unit on create. Imports `Unit` repository and `NotificationsModule` for pending-lease termination on delete. For a TENANT, `GET /properties/:id` returns the property plus `AVAILABLE` units. |
| `UnitsModule`          | Unit CRUD, manual `AVAILABLE` ↔ `MAINTENANCE`, images, cached search. TENANT may list and open `AVAILABLE` units.                                                                                                                                |
| `LeasesModule`         | Direct lease create/update, activate, terminate, lazy expiration hook.                                                                                                                                                                           |
| `RentalRequestsModule` | Tenant requests and owner/admin approve/reject. Registers `RentalRequest`, `Unit`, and `Lease` repositories; does not import `UnitsModule` or `LeasesModule`.                                                                                    |
| `MaintenanceModule`    | Request lifecycle, history, request and completion images.                                                                                                                                                                                       |
| `NotificationsModule`  | Per-user inbox.                                                                                                                                                                                                                                  |
| `AuditLogsModule`      | Append-only trail; ADMIN read.                                                                                                                                                                                                                   |
| `AnalyticsModule`      | Cached dashboard aggregates.                                                                                                                                                                                                                     |

### Common infrastructure (`src/common/`)

| Directory           | Contents                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redis/`            | Global `RedisService` (`ioredis`, `maxRetriesPerRequest: 3`).                                                                                    |
| `uploads/`          | Global `UploadService` (`file-type` + Cloudinary). Folders: `propflow/properties`, `propflow/units`, `propflow/maintenance`, `propflow/avatars`. |
| `mail/`             | `EmailService` + `templates/otp.ejs` read via `ejs.renderFile` from `import.meta.dirname`. Failures logged, never thrown.                        |
| `cache/`            | `CacheInvalidationService` — `invalidateUnitsAndDashboard`, `invalidateDashboard`.                                                               |
| `throttler/`        | `RedisThrottlerStorage` + `RateLimitModule` (global `ThrottlerGuard`).                                                                           |
| `lease-expiration/` | Global `LeaseExpirationService`.                                                                                                                 |
| `policies/`         | Pure policy functions (see `authorization.md`).                                                                                                  |
| `pagination/`       | `PaginationQueryDto` (`page` default 1, `limit` default 20 max 100, `sortBy`, `sortOrder` default `DESC`).                                       |
| `guards/`           | `JwtAuthGuard`, `RolesGuard`, `GoogleAuthGuard`.                                                                                                 |
| `filters/`          | `AllExceptionsFilter`.                                                                                                                           |
| `interceptors/`     | `ResponseInterceptor`, `LoggingInterceptor`.                                                                                                     |
| `decorators/`       | `@Public()`, `@Roles()`, `@CurrentUser()`.                                                                                                       |

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

`RentalRequestsModule` loads units directly through its repository instead of `UnitsService`, so a tenant is not subjected to owner-only unit access checks. It also inserts the resulting `PENDING` lease inside its own transaction instead of calling `LeasesService.create`, which would introduce another transaction boundary and emit the direct-lease `LEASE_CREATED` side effects.

## Request lifecycle

```
Client

  -> Helmet ({ contentSecurityPolicy: false })

  -> CORS (CORS_ORIGINS, credentials: true)

  -> cookie-parser

  -> ValidationPipe ({ whitelist, forbidNonWhitelisted, transform })

  -> global APP_GUARDs

       JwtAuthGuard
         -- skips @Public()
         -- validates Bearer access token
         -- reloads User
         -- requires isActive

       RolesGuard
         -- reads @Roles() metadata
         -- if absent, any authenticated user is allowed

       ThrottlerGuard
         -- global IP-based rate limiting
         -- Redis-backed storage

  -> Controller

  -> Service

  -> LoggingInterceptor
         -- request logging / timing

  -> ResponseInterceptor
         -- { success: true, data, meta? }

  -> AllExceptionsFilter
         -- { success: false, statusCode, error, message, details?, path, timestamp }
```

The guards are global. `JwtAuthGuard` handles authentication, `RolesGuard` handles coarse role authorization, and resource-level policies inside services provide the second authorization layer.

`AppModule` imports `RateLimitModule` before the feature modules so the global throttling infrastructure is initialized with the rest of the application infrastructure.

Global prefix is `api/v1`. Swagger is mounted at `api/docs` and is not under the API prefix.

## Rental request flow

```
TENANT

  GET /properties
  GET /properties/:id
  GET /units
  GET /units/:id

  POST /rental-requests
        |
        v
  RentalRequest(PENDING)


OWNER / ADMIN

  POST /rental-requests/:id/approve
        |
        +--> RentalRequest(APPROVED)
        +--> Lease(PENDING)
        +--> Unit remains AVAILABLE

  POST /rental-requests/:id/reject
        |
        +--> RentalRequest(REJECTED)


OWNER / ADMIN

  POST /leases/:id/activate
        |
        +--> Lease(ACTIVE)
        +--> Unit(RENTED)
```

Rental-request approval locks the request row first and then the unit row.

Direct `POST /leases` validates and locks the target unit with a `pessimistic_write` lock inside its transaction before requiring the unit to be `AVAILABLE`. The lease `EXCLUDE` constraint remains the final database-level guard against overlapping `PENDING`/`ACTIVE` lease ranges.

`RentalRequestsModule` creates the `PENDING` lease directly inside the approval transaction so the rental request update, lease creation, notification, and audit entry can participate in the same transaction.

## Global configuration

- **ConfigModule**: `isGlobal: true`, `validate: validateEnv`.
- **TypeOrmModule**: uses `DATABASE_URL`, `autoLoadEntities: true`, `synchronize: false`, and SSL when `NODE_ENV=production` with `rejectUnauthorized: false`.
- **Swagger**: title “PropFlow API”, Bearer authentication, CSS/JS from jsDelivr.

## Deployment packaging of runtime-read files

`EmailService` reads `otp.ejs` from disk. Bundlers that only follow imports will miss it.

- **`nest build`**: `nest-cli.json` `compilerOptions.assets` copies `common/mail/templates/**`.
- **Vercel**: `vercel.json` `includeFiles` includes `src/common/mail/templates/**` so the template is available at `/var/task/src/common/mail/templates`.

Because `EmailService.sendOtp()` swallows email/template errors, a missing template can still result in a successful API response while the email is not delivered.

## Architectural decisions

- Modular monolith with dependency-injection-based module communication.
- Migrations only, with `synchronize: false`.
- Database constraints are the final concurrency and integrity guard.
- Lazy lease expiration instead of a scheduler, which fits the serverless deployment model.
- Soft-deleted properties require explicit `deletedAt` handling on queries that do not rely on TypeORM's entity-level soft-delete behavior.
- `rentAmount` is an integer snapshot and is never client-supplied when creating a lease or rental request.
- Custom Redis throttler storage is used because the project targets Nest 12.
- Direct `nodemailer` + `ejs` is used instead of `@nestjs-modules/mailer`.
- Mail failures are non-fatal by design.
- Two application entry points exist: `src/main.ts` and `api/index.ts`.
- A rental request does not reserve a unit. Multiple tenants can request the same available unit, while the database lease constraints prevent conflicting leases from being created.
- Rental-request approval creates a `PENDING` lease but does not change the unit status. Only lease activation changes the unit to `RENTED`.
- Resource-level authorization is enforced inside services in addition to global role guards, providing the main IDOR protection.
