# Transactions

## Conventions used throughout the project

- Multi-step writes use `DataSource.transaction(async (manager) => { ... })`. Inside the callback, all persistence goes through the provided `EntityManager` (`manager.save`, `manager.insert`, `manager.update`, `manager.softDelete`, `manager.createQueryBuilder`). The injected repositories of the same service are **not** used inside these callbacks, because a repository call would run on a different connection outside the transaction.
- `NotificationsService.create(manager, data)` and `AuditLogsService.record(manager, data)` take the transaction's `EntityManager` as their first argument for exactly this reason: the notification/audit insert commits or rolls back together with the business change. A failed operation never leaves a stray audit row, and a committed operation never lacks its audit row.
- Any exception thrown inside the callback (including a `QueryFailedError` from a constraint violation) rolls the whole transaction back; TypeORM re-throws it, and `AllExceptionsFilter` translates it to an HTTP response.
- **Cache invalidation is always performed after the transaction promise resolves**, never inside the callback. Redis is not part of the PostgreSQL transaction and cannot be rolled back with it. Rental request operations invalidate no cache at all (they never change unit status or occupancy).
- Cloudinary uploads (network I/O) are performed **before** a transaction opens where one is used, so a slow external call never holds a database row lock.
- Reads that decorate a response (for example reloading a rental request with its tenant and unit summaries) happen **after** the transaction commits, using the normal repository, so the locked section stays as short as possible.

## Transaction boundaries

| Operation                  | Location                              | What is atomic                                                                                                                        | Locking                                                                                                                                                             |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create lease               | `LeasesService.create`                | lease insert + tenant notification + audit row                                                                                        | none explicit; the `EXCLUDE` constraint rejects overlapping PENDING/ACTIVE leases at commit, and the resulting `23P01` rolls the transaction back (mapped to `409`) |
| Activate lease             | `LeasesService.activate`              | lease -> `ACTIVE`, unit -> `RENTED`, tenant notification, audit row                                                                   | `pessimistic_write` on the lease row, then on the unit row                                                                                                          |
| Terminate lease            | `LeasesService.terminate`             | lease -> `TERMINATED`, unit -> `AVAILABLE` (only if the lease was `ACTIVE`), notification, audit row                                  | `pessimistic_write` on the lease row                                                                                                                                |
| Lazy expiration            | `LeaseExpirationService.run`          | set-based lease `ACTIVE -> EXPIRED` + corresponding units -> `AVAILABLE`                                                              | implicit row locks taken by the `UPDATE` statements themselves                                                                                                      |
| Create rental request      | `RentalRequestsService.create`        | request insert + owner notification + audit row (the availability/overlap checks run **before** the transaction, see gaps)            | none                                                                                                                                                                |
| Approve rental request     | `RentalRequestsService.approve`       | `PENDING` lease insert, request -> `APPROVED`, tenant notification, audit row (`leaseId` in metadata); unit status is **not** changed | `pessimistic_write` on the request row, then on the unit row; lease exclusion constraint as the final backstop                                                      |
| Reject rental request      | `RentalRequestsService.reject`        | request -> `REJECTED`, tenant notification, audit row                                                                                 | `pessimistic_write` on the request row                                                                                                                              |
| Create maintenance request | `MaintenanceService.create`           | request insert + owner notification                                                                                                   | none                                                                                                                                                                |
| Assign request             | `MaintenanceService.assign`           | status/assignee update, history row, staff + tenant notifications, audit row                                                          | `pessimistic_write` on the request row                                                                                                                              |
| Start request              | `MaintenanceService.start`            | status update, history row                                                                                                            | `pessimistic_write` on the request row                                                                                                                              |
| Complete request           | `MaintenanceService.complete`         | status/resolution update, history row, tenant + owner notifications, audit row                                                        | `pessimistic_write` on the request row                                                                                                                              |
| Close / cancel request     | `MaintenanceService.close` / `cancel` | status update, history row                                                                                                            | `pessimistic_write` on the request row                                                                                                                              |
| Create / delete property   | `PropertiesService.create` / `remove` | insert (or soft delete) + audit row                                                                                                   | none                                                                                                                                                                |
| Change unit status         | `UnitsService.setStatus`              | status update + audit row                                                                                                             | none (see gaps)                                                                                                                                                     |
| Change user status / role  | `UsersService.setStatus` / `setRole`  | update + audit row                                                                                                                    | none (see gaps)                                                                                                                                                     |
| Refresh token rotation     | `AuthService.refresh`                 | revoke old token row + insert new token row                                                                                           | conditional `UPDATE ... WHERE revoked = false` (see below)                                                                                                          |
| Password reset             | `AuthService.resetPassword`           | new password hash + revoke all of the user's refresh tokens                                                                           | none                                                                                                                                                                |

## Pessimistic locking in practice

`LeasesService.activate` is the clearest example. Inside one transaction it:

1. Loads and locks the lease row (`createQueryBuilder(Lease).setLock('pessimistic_write')`, i.e. `SELECT ... FOR UPDATE`).
2. Loads the unit with its property (used for the ownership policy check).
3. Verifies the lease is `PENDING`.
4. Loads and locks the **unit** row the same way, then verifies its status is `AVAILABLE`.
5. Updates both rows, inserts the notification and audit row, and commits.

Because the unit row is locked before its status is checked, two concurrent activations targeting the same unit serialize: the second waits, then sees `RENTED` and fails with `409`. The database constraints (partial unique index on `ACTIVE` leases per unit, and the `EXCLUDE` constraint) act as a second line of defense should the application-level check ever be bypassed.

Maintenance transitions use the same pattern through the private `lockOrFail` helper, which serializes concurrent transitions on the same request (for example, two simultaneous `assign` calls).

## Rental request approval

`RentalRequestsService.approve` is the most involved transaction after lease activation. Before the transaction it runs `LeaseExpirationService.run()` (its own separate transaction, so already-lapsed leases are not seen as blocking). Inside one `DataSource.transaction` it then:

1. Loads and locks the **request** row (`createQueryBuilder(RentalRequest).setLock('pessimistic_write')`), with no joins. A join would make `FOR UPDATE` target the nullable side of an outer join, which PostgreSQL rejects.
2. Loads the unit with its property (separate query, unlocked) and verifies the caller may manage the property with `canManageProperty` (`403`). A missing unit or a soft-deleted property is a `404`.
3. Verifies the request is `PENDING` (`409`).
4. Loads and locks the **unit** row the same way, then verifies its status is `AVAILABLE` (`409`).
5. Loads the requesting tenant and verifies they are still an active `TENANT` (`409`).
6. Re-checks for a `PENDING`/`ACTIVE` lease overlapping the requested range, with inclusive bounds matching the exclusion constraint (`409`).
7. Inserts a `PENDING` lease (tenant, unit, dates, `rentAmount` from the request) using `manager.create(Lease, ...)` and `manager.save`, sets the request to `APPROVED`, and saves it.
8. Inserts the tenant notification and the audit row through the same `manager`, and commits.

The unit row is never updated: approval leaves the unit `AVAILABLE`, and only the existing lease activation flips it to `RENTED`.

**Why this is safe under concurrency.**

- Two approvals for the same unit serialize on the unit row lock. The second waits, then its overlap check in step 6 sees the first approval's `PENDING` lease (the first transaction has committed) and fails with `409`.
- Approve and reject on the same request serialize on the request row lock; whichever runs second sees a non-`PENDING` status and fails with `409`.
- A direct `POST /leases` does **not** take the unit row lock (see the "Create lease" row), so it can race with an approval on the same unit. The application-level overlap check cannot close that window; the `EXCLUDE` constraint does. If PostgreSQL rejects the lease insert (`23P01`, or `23505` from the partial unique index), the transaction rolls back: the request stays `PENDING`, and no lease, notification or audit row persists. The error propagates out of the service unchanged and `AllExceptionsFilter` maps it to `409`.

**Lock ordering.** Approval locks request -> unit and never locks a lease row. `LeasesService.activate` locks lease -> unit. Both acquire the unit lock last, and approval never holds a lock that activation needs first, so the two cannot deadlock against each other. Reject locks only the request row.

**What is deliberately not done.** The lease is created directly with the transaction's manager instead of calling `LeasesService.create`, because that method opens its own transaction (it could not join this one) and emits `LEASE_CREATED` notification/audit entries that approval should not duplicate. Approval writes exactly one `RENTAL_REQUEST_APPROVED` notification and one `RENTAL_REQUEST_APPROVED` audit row.

`RentalRequestsService.reject` is the simple version of the same pattern: lock the request row, check authorization and `PENDING`, update, notify, audit.

## Optimistic/conditional atomicity without an explicit lock

Refresh-token rotation (`AuthService.refresh`) relies on a conditional update rather than a row lock: `UPDATE refresh_tokens SET revoked = true WHERE id = :id AND revoked = false`. Only one of two concurrent requests presenting the same token can observe `affected = 1`; the other sees `0` and is treated as token reuse (the whole family is revoked). This makes "use a refresh token exactly once" atomic without holding a lock across the request.

## Raw `QueryRunner` usage

`LeaseExpirationService.run` manages its own transaction through `DataSource.createQueryRunner()` (connect, start, commit/rollback, release) because it issues raw SQL. A driver-specific detail confirmed by testing against PostgreSQL: with the TypeORM version in use, `queryRunner.query()` on an `UPDATE ... RETURNING` statement resolves to a `[rows, affectedCount]` tuple rather than the rows array, so the code destructures the first element. Treating the result as a plain array silently produces wrong results (no exception is thrown).

## Not atomic — known gaps

These are stated plainly because they are behaviors of the current implementation, not recommendations:

- **Manual unit status change and user status/role changes read the row before the transaction opens and do not lock it.** `UnitsService.setStatus` verifies the current status outside its transaction; if a lease is activated for that unit between the read and the write, the manual change can overwrite `RENTED`. Similarly, `UsersService.setStatus` / `setRole` are last-write-wins.
- **Rental request creation checks availability outside its transaction and without locks.** `RentalRequestsService.create` runs the lease sweep, loads the unit, and checks status and lease overlap before opening the transaction that inserts the request. A lease created in that window is not detected at creation time. This is intentional: a request does not reserve the unit, so the creation-time check is only an early filter, and the authoritative check (with locks and the `EXCLUDE` constraint as backstop) happens at approval.
- **Approval re-reads for the response outside the transaction.** The approved/rejected/created request is reloaded with its tenant and unit summaries after commit, so the response reflects committed data but is not part of the locked section.
- **Cloudinary uploads are not compensated.** In `MaintenanceService.complete` (and in property image upload), images are uploaded first; if the subsequent database step fails (for example a `409` because the request is not `IN_PROGRESS`), the uploaded assets remain in Cloudinary. No cleanup step exists.
- **Registration is not a single transaction.** `AuthService.register` creates the user row, then requests the OTP and sends the email as separate steps. A failure between them leaves a created, unverified account; the user can recover through `resend-verification-otp`.
- **Single-statement writes are not wrapped.** Property update/image changes, unit create/update/delete, and notification read-marking are individual statements and are atomic only at the statement level. They do not write audit rows.
- **A direct `POST /leases` and a rental request approval can race without an application-level lock.** Only the database constraint resolves it (one wins, the other gets `409`). This is deliberate — adding a unit-row lock to direct lease creation would change the existing lease workflow — but it means correctness in that case rests on the constraint, not on the service code.
