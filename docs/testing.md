# Testing

## Current state: one unit test suite; everything else is manual

Automated coverage is minimal and this document states that plainly, separating what exists from what is only recommended.

### Framework

- The test runner is **Vitest** (`vitest`, `@vitest/coverage-v8` in `devDependencies`). The relevant scripts in `package.json` are `test` (`vitest run`), `test:watch`, `test:cov`, `test:debug`, and `test:e2e` (`vitest run --config ./vitest.config.e2e.ts`). Vitest handles this ESM codebase (with `.js` suffixes in relative imports) without the extra transform configuration the NestJS CLI's scaffolded Jest setup would have needed. The project does not use Jest.
- Path resolution is provided by the `vite-tsconfig-paths` plugin; current Vite prints a notice that this can be replaced by the native `resolve.tsconfigPaths` option, which is cosmetic.
- The scaffolded spec, `app.controller.spec.ts`, was deleted together with the scaffolded `AppController` and `AppService` during initial setup.

> **Verify:** `test:e2e` points at `vitest.config.e2e.ts`. Confirm that file and a `test/` directory exist and that any scaffolded `test/app.e2e-spec.ts` was removed; the scaffold's version asserts a `GET /` "Hello World" response from a controller that no longer exists and would fail.

## What exists

### 1. Unit tests: `RentalRequestsService`

`src/rental-requests/rental-requests.service.spec.ts` contains 54 tests, all passing at the time of writing (`npm run test -- rental-requests`). The service is constructed directly (no `Test.createTestingModule`) with hand-written mocks for the repositories, `DataSource` (including `transaction`, which runs the callback against a fake `EntityManager` and its query builders), `LeaseExpirationService`, `NotificationsService` and `AuditLogsService`.

| Area               | What is asserted                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create             | Request is `PENDING` with `tenantId` taken from the caller; a smuggled `tenantId`/`status` in the body is ignored; no lease is created and the unit is untouched; lease sweep runs first; response exposes only whitelisted tenant/unit fields; owner notification and audit row are written |
| Create validation  | `404` for a missing unit and for a soft-deleted property; `409` for `RENTED`/`MAINTENANCE` units and for an overlapping lease; `400` for `startDate == endDate`, `startDate > endDate`, and an impossible calendar date (`2026-02-31`)                                                       |
| Authorization      | Single-request read allowed for the owning tenant, the property owner and an admin, forbidden for another tenant and another owner; list queries scoped in SQL (tenant: `tenantId`, owner: `property.ownerId`, admin: unscoped); status filter; `sortBy` whitelist                           |
| Approve            | `PENDING` lease created with the request's tenant, unit and dates; request becomes `APPROVED`; unit status untouched and never saved; exactly one tenant notification and one audit row with `leaseId`; request row locked before unit row, both `pessimistic_write`; lease sweep runs first |
| Approve rejections | `403` for another owner and for a tenant (nothing written); `409` for already `APPROVED`/`REJECTED`, unit no longer `AVAILABLE`, inactive tenant, tenant no longer `TENANT`, application-level lease overlap; `404` for missing request, unit, or property                                   |
| Constraint errors  | A `23P01` or `23505` raised while saving the lease propagates unchanged (the global `AllExceptionsFilter` maps it to `409`); the request stays `PENDING` and no notification or audit row is written; other database and non-database errors propagate unchanged                             |
| Reject             | Request becomes `REJECTED`; no lease created; unit untouched and not locked; tenant notification and audit row; `403` for another owner/tenant; `409` for non-`PENDING`; `404` for missing request                                                                                           |

What these tests **cannot** prove: anything that depends on PostgreSQL behavior. They run against mocks, so they do not exercise row locks, the `EXCLUDE` and partial unique constraints, transaction rollback, the `CHECK` constraint, or the real SQL produced by the query builders. They show that the service calls the right operations in the right order and maps states correctly; they do not show that two concurrent approvals are actually serialized. A mock `transaction` also does not roll anything back, so "the request stays `PENDING`" is asserted by checking that the service never reached the status change, not by observing a rollback.

### 2. Manual test-case reference

A hand-written document (`propflow-test-cases.md`, produced during development) lists request bodies and expected status codes for the endpoints of phases 1–5: auth (registration, verification, login, refresh rotation and reuse, forgot/reset password, logout), users, properties, units, and leases. It is a checklist to execute manually with an HTTP client against a running instance; it is not executable and not part of any CI process.

Coverage limits of that document:

- It does **not** cover maintenance requests, rental requests, notifications, audit logs, analytics, avatar upload, image deletion endpoints, or Google OAuth.
- It predates several later changes (audit logging on property creation, rate limiting details, cache behavior, tenant access to properties and available units) and should be re-read against the current code before being trusted as complete.

To run these checks manually you need: a migrated database, a seeded `ADMIN` (`npm run seed:admin`), Redis, and an SMTP sandbox to read OTP emails.

### 3. Manual verification still required for rental requests

The following cannot be covered by the mocked suite and must be run against a real database (after the `AddRentalRequests` migration has been generated, reviewed and applied):

1. **Happy path**: a tenant opens `GET /properties/:id` and sees only `AVAILABLE` units; `POST /rental-requests` returns `PENDING`; the owner approves; a `PENDING` lease exists for the same tenant, unit and dates; the unit is still `AVAILABLE`; `POST /leases/:id/activate` then makes the lease `ACTIVE` and the unit `RENTED`.
2. **Reject path**: rejecting a `PENDING` request leaves no lease and the unit unchanged; rejecting or approving it again returns `409`.
3. **Isolation**: a second tenant cannot read or list the first tenant's request; a second owner gets `403` on read, approve and reject for a property they do not own and sees nothing in their list.
4. **Conflicts**: creating a request that overlaps an existing `PENDING` or `ACTIVE` lease returns `409`; creating one for a `RENTED` unit returns `409`; approving after a conflicting lease was created returns `409` and leaves the request `PENDING`.
5. **Concurrency (two simultaneous approvals on the same unit)**: create two requests for overlapping dates, send both `approve` calls at the same moment (for example two `curl` commands backgrounded with `&` and `wait`), and expect one `200` and one `409`; the `leases` table must contain exactly one `PENDING` lease for that unit, and the losing request must still be `PENDING`. Repeat several times.
6. **Race against a direct lease**: send `POST /rental-requests/:id/approve` and a direct `POST /leases` for overlapping dates on the same unit at the same time; exactly one should succeed and the other should return `409` (this exercises the `EXCLUDE` constraint, since direct lease creation takes no row lock).
7. **Side effects**: one notification to the owner on creation; one to the tenant on approve and on reject; one audit row per action, with `leaseId` in the approval's metadata and no extra `LEASE_CREATED` row.

### 4. Ad-hoc verification performed during development (not in the repository)

These were one-off scripts run against throwaway local services, not maintained tests:

- The initial schema migration's `up()` and `down()` were replayed against an empty PostgreSQL database, then `up()` again, confirming the schema is created and fully removed.
- The `leases` constraints were exercised with real inserts: an overlapping `PENDING` lease is rejected (`23P01`), a second `ACTIVE` lease on a unit is rejected (`23505`), `startDate >= endDate` is rejected (`23514`), and the set-based expiration statement frees the unit.
- The OTP verification Lua script's behavior (single use, five-attempt lockout, replacement by a newer code, TTL, cooldown) was checked against an in-memory Redis emulator.
- The Redis throttler storage script was written but an isolated reproduction did not run to completion; its behavior was observed only through manual requests (which initially showed no rate limiting on login because the decorator had been applied to `register` only).

## Critical logic and its coverage

| Area            | Behavior at risk                                                                                                                                                                                        | Automated coverage                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Rental requests | State machine, authorization (tenant/owner/admin, IDOR), creation validation, approval invariants (`PENDING` lease, unit untouched, single notification/audit), lock order, error propagation           | **Unit-tested with mocks** (54 tests). Real locking, constraints and rollback are **not** covered                                      |
| Rental requests | Two concurrent approvals on the same unit; approval racing a direct lease creation; rollback leaving the request `PENDING`                                                                              | None — manual check only (see above)                                                                                                   |
| Refresh tokens  | Rotation, reuse detection, family revocation, concurrent refresh with the same token                                                                                                                    | None                                                                                                                                   |
| OTP             | Single use, five-attempt lockout, resend cooldown, expiry                                                                                                                                               | None                                                                                                                                   |
| Leases          | Overlap rejection, single active lease per unit, activation under concurrency, termination releasing the unit, lazy expiration side effects                                                             | None                                                                                                                                   |
| Maintenance     | Every allowed and disallowed status transition, assigned-staff-only `start`/`complete` (including `ADMIN` being rejected), history rows per transition, tenant limited to their own active lease's unit | None                                                                                                                                   |
| Authorization   | `canManageProperty`, `canAccessLease`, `canAccessMaintenance`, `canCloseOrCancelMaintenance`; IDOR attempts across owners and tenants                                                                   | `canAccessRentalRequest` and `canManageProperty` are exercised indirectly through the rental request suite; the others are not covered |
| Cache           | Scope separation in `units:search` keys, invalidation after every listed write, invalidation not happening on a rolled-back transaction                                                                 | None                                                                                                                                   |
| Rate limiting   | Limit and block behavior of `RedisThrottlerStorage`; presence of `@Throttle` on every sensitive route                                                                                                   | None                                                                                                                                   |
| Uploads         | Rejection of spoofed extensions/MIME types, size and count limits, Cloudinary deletion on image removal                                                                                                 | None                                                                                                                                   |
| Transactions    | Audit and notification rows rolled back together with a failed operation                                                                                                                                | None (mocks cannot demonstrate rollback)                                                                                               |
| Users           | Admin cannot deactivate or re-role their own account                                                                                                                                                    | None                                                                                                                                   |

## Recommended tests (not implemented)

Suggested layers, in priority order:

1. **Unit tests for pure logic**, following the style of the rental request suite: the policy functions in `common/policies/policy.utils.ts`; `PasswordService` (pre-hash behavior with passwords longer than 72 bytes); `durationToSeconds`; `buildSearchCacheKey` determinism and scope separation.
2. **Integration tests against real PostgreSQL and Redis** (containers or a dedicated test instance; mocks would not exercise the constraints and locks that matter here):
   - the lease constraint matrix (overlap, reversed dates, second active lease);
   - concurrent `activate` calls on two leases for the same unit — exactly one succeeds;
   - concurrent rental request `approve` calls for the same unit — exactly one succeeds, the other gets `409` and its request stays `PENDING`;
   - `approve` racing a direct `POST /leases` — the `EXCLUDE` constraint resolves it;
   - concurrent `refresh` calls with the same token — exactly one succeeds and the family is revoked;
   - the OTP Lua script and the throttler Lua script against a real Redis;
   - rollback atomicity: force a failure after the state change and assert no audit or notification row remains.
3. **End-to-end tests through HTTP** (`@nestjs/testing` with the real `AppModule` and a test database, run through `test:e2e`): full flows — register, verify, login, create property/unit, tenant discovers the unit and files a rental request, owner approves, lease is activated, tenant files a maintenance request, owner assigns, staff starts/completes, tenant closes — asserting statuses, history rows, notifications, and audit entries at each step, plus the negative paths (wrong role, wrong owner, wrong state).
4. **Test environment**: a separate test `DATABASE_URL`, and mocked Cloudinary and SMTP transports, since those two are the only dependencies that should not be exercised for real in automated runs.

Only the rental request unit suite from the first layer exists in the repository today.
