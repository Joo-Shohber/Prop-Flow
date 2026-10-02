# Authorization

Authorization is enforced in two independent layers. Both must pass for a request to succeed.

## Layer 1 — Role-based access control (RBAC)

- `@Roles(...roles)` (`src/common/decorators/roles.decorator.ts`) attaches metadata to a handler or controller class.
- `RolesGuard` (`src/common/guards/roles.guard.ts`), registered globally as `APP_GUARD`, reads that metadata with `Reflector.getAllAndOverride`. If no `@Roles()` metadata is present, the guard allows any authenticated user through. If present, it checks `request.user.role` against the list and throws `ForbiddenException` (`403`) otherwise.
- `RolesGuard` runs after `JwtAuthGuard`, which is what attaches `request.user` in the first place. `JwtAuthGuard` also re-loads the user and rejects (`401`) deactivated accounts, so a deactivated user loses access immediately. `@Public()` bypasses `JwtAuthGuard` entirely (used for `/auth/register`, `/auth/login`, etc.).

## The four roles

| Role                | Description                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENANT`            | Browses all properties and `AVAILABLE` units, submits rental requests, and (once they hold an `ACTIVE` lease) creates and tracks their own maintenance requests.                                               |
| `OWNER`             | Owns properties; manages their own properties and units, reviews (approves/rejects) rental requests on them, creates and manages leases for their units, assigns maintenance, and searches the user directory. |
| `MAINTENANCE_STAFF` | Works only the maintenance requests assigned to them. Has no access to properties, units, leases, rental requests or analytics.                                                                                |
| `ADMIN`             | Broad access across all owners' data, plus user administration and the audit log. **Not unrestricted**: ADMIN cannot create rental requests or maintenance requests, and cannot start or complete maintenance. |

How accounts get their role: `POST /auth/register` accepts only `TENANT` or `OWNER`. The first `ADMIN` is created by the `seed:admin` script, and an ADMIN can change any other user's role via `PATCH /users/:id/role` (this is how `MAINTENANCE_STAFF` accounts come to exist). An ADMIN cannot change their own role or deactivate themselves (`422`).

## Layer 2 — Resource-level policies

RBAC alone cannot stop an `OWNER` from passing another owner's property ID in the URL — that requires checking the specific row, not just the caller's role. This is implemented as pure functions in `src/common/policies/policy.utils.ts`, called explicitly from services before any read or write:

| Function                                     | Rule                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isAdmin(user)`                              | `user.role === ADMIN`.                                                                                                                                                        |
| `hasRole(user, ...roles)`                    | Membership check, used sparingly.                                                                                                                                             |
| `canManageProperty(user, { ownerId })`       | `true` for ADMIN, or when `resource.ownerId === user.id`. Used for `Property` directly, and for `Unit`/`MaintenanceRequest`/`RentalRequest` via their parent `Property`.      |
| `canAccessLease(user, lease)`                | ADMIN: always. TENANT: only if `lease.tenantId === user.id`. Otherwise (OWNER): only if `lease.unit.property.ownerId === user.id`.                                            |
| `canAccessRentalRequest(user, request)`      | ADMIN: always. TENANT: only if `request.tenantId === user.id`. Otherwise (OWNER): only if the request's `unit -> property -> ownerId === user.id`.                            |
| `canAccessMaintenance(user, request)`        | ADMIN: always. TENANT: only their own request. `MAINTENANCE_STAFF`: only if `request.assignedStaffId === user.id`. Otherwise (OWNER): only via the unit's property ownership. |
| `canCloseOrCancelMaintenance(user, request)` | ADMIN, the request's tenant, or the property's owner — deliberately excludes `MAINTENANCE_STAFF`.                                                                             |

### Where each is applied

- `PropertiesService.findForActor` / `UnitsService.findForActorOrFail` — every read and write of a specific property or unit (including status changes and image upload/delete). For a `TENANT`, these reads use the tenant-visibility rules described below instead of ownership.
- `LeasesService.findForActorOrFail` — reads. `LeasesService.activate` / `terminate` re-check `canManageProperty` directly against the locked unit's property inside the transaction (not via `canAccessLease`, since only OWNER/ADMIN — never the tenant — may activate or terminate). Direct `POST /leases` by an OWNER is checked against the target unit's property.
- `RentalRequestsService` — reads use `canAccessRentalRequest`. `approve` and `reject` are OWNER/ADMIN only: inside the transaction, after locking the request row, the service authorizes via `unit -> property -> ownerId` (the same ownership rule as `canManageProperty`), then requires `PENDING`. A tenant can never approve or reject, even their own request.
- `MaintenanceService.findForActorOrFail` — reads. `assign` checks `canManageProperty` against the unit's property, and the target must be an active `MAINTENANCE_STAFF`. `close`/`cancel` check `canCloseOrCancelMaintenance`. Adding or deleting request images (only while `OPEN`) is open to the same actors as close/cancel (the tenant, the property's owner, ADMIN) and never to staff. `start`/`complete` (and deleting completion images, only while `RESOLVED`) intentionally bypass the general policy functions and instead check `request.assignedStaffId === actor.id` directly — this is a stricter, narrower rule than any of the policy functions express, and by design excludes even `ADMIN`.

### Why two layers

- RBAC is cheap and stops entire classes of requests (a `TENANT` can never even attempt `POST /properties`).
- Resource-level checks are what actually prevent **IDOR** (Insecure Direct Object Reference): an authenticated, correctly-roled user supplying an ID that does not belong to them.

## Tenant visibility and enumeration safety

Tenants are the one role that can read data they do not own, so their visibility is restricted by _state_ rather than by ownership:

- `GET /properties` returns all properties to a `TENANT`; `GET /properties/:id` returns the property plus its `AVAILABLE` units only. For OWNER/ADMIN the same endpoint returns the plain property and responds `403` if the caller is not the owner (ADMIN excepted).
- `GET /units` for a `TENANT` is cross-property and always `AVAILABLE`-only; a `status` filter is ignored for tenants.
- `GET /units/:id` for a `TENANT` returns `404` (not `403`) when the unit is not `AVAILABLE`. This is deliberate: a `403` would confirm that a specific unit exists but is rented.
- Units that belong to a soft-deleted property are hidden everywhere a unit is reached through its property (unit search, leases, rental requests, maintenance). A policy check on a row is not enough here, because TypeORM's automatic soft-delete filtering does not apply to manual joins or subqueries; each such query adds `property."deletedAt" IS NULL` explicitly, and any new query that reaches `Unit` through `Property` must too.

## Server-derived identity fields

Several fields that decide _who_ an action applies to are never taken from the client:

- Rental requests: `tenantId` is always the authenticated tenant, and `status` is server-controlled. Sending either in the body is rejected with `400` (`whitelist` + `forbidNonWhitelisted`), not silently ignored.
- Maintenance requests: `unitId` is derived from the tenant's own `ACTIVE` lease, never from input.
- Leases and rental requests: `rentAmount` is snapshotted from the unit (or carried over from the approved request) and is never client-supplied.

## User directory and user administration

- `GET /users/directory` (OWNER, ADMIN) lets owners find tenants and maintenance staff (for creating leases and assigning maintenance). It returns only `{id, firstName, lastName, email, role}`, active users only, filterable by `role=TENANT|MAINTENANCE_STAFF` and `search`. Tenants and staff cannot use it.
- `GET /users`, `PATCH /users/:id/status` and `PATCH /users/:id/role` are ADMIN only, with full user objects. Self-deactivation and self-role-change return `422`, and both actions are audited.

## Operation-to-role matrix

| Operation                                           | TENANT                           | OWNER          | MAINTENANCE_STAFF | ADMIN       |
| --------------------------------------------------- | -------------------------------- | -------------- | ----------------- | ----------- |
| Manage own profile/avatar                           | own                              | own            | own               | own         |
| View properties                                     | all                              | own            | —                 | all         |
| View units                                          | `AVAILABLE` only, cross-property | own            | —                 | all         |
| Property/Unit create/update/delete, incl. images    | —                                | own            | —                 | all         |
| Change unit status (`AVAILABLE`/`MAINTENANCE`)      | —                                | own            | —                 | all         |
| Search user directory                               | —                                | yes            | —                 | yes         |
| Create rental request                               | `AVAILABLE` units                | —              | —                 | —           |
| View rental requests                                | own                              | own properties | —                 | all         |
| Approve/reject rental request                       | —                                | own properties | —                 | all         |
| List/view leases                                    | own                              | own properties | —                 | all         |
| Create/activate/terminate leases directly           | —                                | own units      | —                 | all         |
| Create maintenance request                          | own active lease's unit          | —              | —                 | —           |
| Add/delete images on a maintenance request (`OPEN`) | own                              | own properties | —                 | all         |
| Assign maintenance request                          | —                                | own properties | —                 | all         |
| Start/complete maintenance request                  | —                                | —              | only if assigned  | —           |
| Close/cancel maintenance request                    | own                              | own properties | —                 | all         |
| View notifications                                  | own                              | own            | own               | own         |
| View audit log                                      | —                                | —              | —                 | all         |
| View analytics dashboard                            | —                                | own properties | —                 | system-wide |
| List/manage all users (status, role)                | —                                | —              | —                 | all         |

This table is derived directly from the `@Roles()` decorators on each controller method combined with the policy function each service calls — it is not a separate configuration.

## Verify

- `approve`/`reject` in `RentalRequestsService` and the maintenance image add/delete endpoints are described by the rule they enforce (property ownership, or tenant/owner/ADMIN). Confirm against the final service code whether they call `canManageProperty` / `canCloseOrCancelMaintenance` or inline equivalents, and update the "Where each is applied" list accordingly.
- `canAccessRentalRequest` is listed in the README as part of `policy.utils.ts`; its exact branch order was not confirmed against the final file.
