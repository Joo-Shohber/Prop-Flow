# Testing

## Current state: no automated tests exist

No unit, integration, or end-to-end test suites were written for this project. This document states that plainly and separates what exists from what is only recommended.

### Framework

- The project was generated with the NestJS CLI, which scaffolds Jest (`test`, `test:watch`, `test:cov`, `test:e2e` scripts and a Jest configuration in `package.json` / `test/jest-e2e.json`). No project-specific Jest configuration, test utilities, or test database setup was added.
- The only scaffolded spec, `app.controller.spec.ts`, was deleted together with the scaffolded `AppController` and `AppService` during initial setup.

> **Verify:** if the scaffolded `test/app.e2e-spec.ts` is still present, it asserts the scaffold's `GET /` "Hello World" response from a controller that no longer exists, and will fail.
>
> The scaffold's default Jest configuration also targets CommonJS. This codebase is ESM with `.js` extensions in relative imports, so running Jest against it needs additional configuration (an ESM-capable preset/transform and a mapping for the `.js` import suffixes) that has not been set up. Running `npm test` today should therefore not be expected to give a meaningful result.

## What does exist

### 1. Manual test-case reference

A hand-written document (`propflow-test-cases.md`, produced during development) lists request bodies and expected status codes for the endpoints of phases 1–5: auth (registration, verification, login, refresh rotation and reuse, forgot/reset password, logout), users, properties, units, and leases. It is a checklist to execute manually with an HTTP client against a running instance; it is not executable and not part of any CI process.

Coverage limits of that document:

- It does **not** cover maintenance requests, notifications, audit logs, analytics, avatar upload, image deletion endpoints, or Google OAuth.
- It predates several later changes (audit logging on property creation, rate limiting details, cache behavior) and should be re-read against the current code before being trusted as complete.

To run these checks manually you need: a migrated database, a seeded `ADMIN` (`npm run seed:admin`), Redis, and an SMTP sandbox to read OTP emails.

### 2. Ad-hoc verification performed during development (not in the repository)

These were one-off scripts run against throwaway local services, not maintained tests:

- The initial schema migration's `up()` and `down()` were replayed against an empty PostgreSQL database, then `up()` again, confirming the schema is created and fully removed.
- The `leases` constraints were exercised with real inserts: an overlapping `PENDING` lease is rejected (`23P01`), a second `ACTIVE` lease on a unit is rejected (`23505`), `startDate >= endDate` is rejected (`23514`), and the set-based expiration statement frees the unit.
- The OTP verification Lua script's behavior (single use, five-attempt lockout, replacement by a newer code, TTL, cooldown) was checked against an in-memory Redis emulator.
- The Redis throttler storage script was written but an isolated reproduction did not run to completion; its behavior was observed only through manual requests (which initially showed no rate limiting on login because the decorator had been applied to `register` only).

## Critical logic with no automated coverage

Everything below is currently protected only by code review and manual checks:

| Area           | Behavior at risk                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh tokens | Rotation, reuse detection, family revocation, concurrent refresh with the same token                                                                                                                    |
| OTP            | Single use, five-attempt lockout, resend cooldown, expiry                                                                                                                                               |
| Leases         | Overlap rejection, single active lease per unit, activation under concurrency, termination releasing the unit, lazy expiration side effects                                                             |
| Maintenance    | Every allowed and disallowed status transition, assigned-staff-only `start`/`complete` (including `ADMIN` being rejected), history rows per transition, tenant limited to their own active lease's unit |
| Authorization  | `canManageProperty`, `canAccessLease`, `canAccessMaintenance`, `canCloseOrCancelMaintenance`; IDOR attempts across owners and tenants                                                                   |
| Cache          | Scope separation in `units:search` keys, invalidation after every listed write, invalidation not happening on a rolled-back transaction                                                                 |
| Rate limiting  | Limit and block behavior of `RedisThrottlerStorage`; presence of `@Throttle` on every sensitive route                                                                                                   |
| Uploads        | Rejection of spoofed extensions/MIME types, size and count limits, Cloudinary deletion on image removal                                                                                                 |
| Transactions   | Audit and notification rows rolled back together with a failed operation                                                                                                                                |
| Users          | Admin cannot deactivate or re-role their own account                                                                                                                                                    |

## Recommended tests (not implemented)

Suggested layers, in priority order:

1. **Unit tests for pure logic**: the policy functions in `common/policies/policy.utils.ts`; `PasswordService` (pre-hash behavior with passwords longer than 72 bytes); `durationToSeconds`; `buildSearchCacheKey` determinism and scope separation.
2. **Integration tests against real PostgreSQL and Redis** (containers or a dedicated test instance; mocks would not exercise the constraints and locks that matter here):
   - the lease constraint matrix (overlap, reversed dates, second active lease);
   - concurrent `activate` calls on two leases for the same unit — exactly one succeeds;
   - concurrent `refresh` calls with the same token — exactly one succeeds and the family is revoked;
   - the OTP Lua script and the throttler Lua script against a real Redis;
   - rollback atomicity: force a failure after the state change and assert no audit or notification row remains.
3. **End-to-end tests through HTTP** (`@nestjs/testing` with the real `AppModule` and a test database): full flows — register, verify, login, create property/unit, create/activate lease, tenant files maintenance request, owner assigns, staff starts/completes, tenant closes — asserting statuses, history rows, notifications, and audit entries at each step, plus the negative paths (wrong role, wrong owner, wrong state).
4. **Configuration for ESM**: an ESM-capable Jest (or Vitest) setup, a separate test `DATABASE_URL`, and a mocked Cloudinary and SMTP transport, since those two are the only dependencies that should not be exercised for real in automated runs.

None of the above exists in the repository today.
