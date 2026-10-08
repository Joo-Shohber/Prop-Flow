# Authorization

Authorization is enforced in two independent layers. Both must pass.

## Layer 1 — Role-based access control (RBAC)

- `@Roles(...roles)` attaches metadata.
- Global `RolesGuard` uses `Reflector.getAllAndOverride`. No metadata → any **authenticated** user. Otherwise `request.user.role` must be in the list (`403`).
- `JwtAuthGuard` authenticates the request before `RolesGuard`, attaches `request.user`, and rejects inactive accounts. `@Public()` skips JWT (`/auth/*` and `GET /`).

## The four roles

| Role                | Description                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENANT`            | Browses all properties and `AVAILABLE` units, submits rental requests, and with an `ACTIVE` lease creates/tracks maintenance.                                        |
| `OWNER`             | Manages own properties/units, rental requests, leases, maintenance assignment, user directory, and own-scoped analytics.                                             |
| `MAINTENANCE_STAFF` | Accesses only maintenance requests assigned to them. No properties, units, leases, rental requests, or analytics.                                                    |
| `ADMIN`             | Cross-owner data, user administration, and audit logs. **Not unrestricted**: cannot create rental or maintenance requests, and cannot start or complete maintenance. |

`POST /auth/register` accepts only `TENANT` or `OWNER`. The first admin is created with `seed:admin`. Other roles are assigned through `PATCH /users/:id/role`.

An admin cannot change their own role or deactivate themselves (`422`).

## Layer 2 — Resource-level policies

`src/common/policies/policy.utils.ts`:

| Function                                     | Rule                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `isAdmin(user)`                              | `role === ADMIN`                                                                                               |
| `hasRole(user, ...roles)`                    | Membership                                                                                                     |
| `canManageProperty(user, { ownerId })`       | ADMIN, or `ownerId === user.id`                                                                                |
| `canAccessLease(user, lease)`                | ADMIN always; TENANT if `lease.tenantId === user.id`; otherwise `lease.unit.property?.ownerId === user.id`     |
| `canAccessRentalRequest(user, request)`      | ADMIN always; TENANT if `request.tenantId === user.id`; otherwise `request.unit.property?.ownerId === user.id` |
| `canAccessMaintenance(user, request)`        | ADMIN always; TENANT owns the request; staff if `assignedStaffId === user.id`; owner via property              |
| `canCloseOrCancelMaintenance(user, request)` | ADMIN, the tenant, or the property owner, but not maintenance staff                                            |

`property` may be `null` after a soft delete; optional chaining is intentional.

### Where each is applied

- `PropertiesService.findForActor` / `UnitsService.findForActor` — every targeted property/unit read or write. TENANT property detail uses visibility rules and returns only available units. TENANT unit detail requires `AVAILABLE`.
- `LeasesService.findForActor` uses `canAccessLease`. `activate` / `terminate` / direct create use `canManageProperty` on the unit’s property. Tenants cannot activate or terminate leases; those routes are OWNER/ADMIN.
- `RentalRequestsService` reads use `canAccessRentalRequest`. Approve/reject use `canManageProperty` after locking the request and unit through `loadManagedUnit`.
- `MaintenanceService.findForActor` uses `canAccessMaintenance`. Assign uses `canManageProperty`. Close/cancel and OPEN image add/delete use `canCloseOrCancelMaintenance`. Start/complete and completion-image deletion require `assignedStaffId === actor.id`.

## Tenant visibility

- `GET /properties` — all non-deleted properties. `GET /properties/:id` — property plus **only** `AVAILABLE` units.
- `GET /units` — always returns `AVAILABLE` units; the `status` query is ignored for TENANT.
- `GET /units/:id` — if the unit is not `AVAILABLE`, TENANT receives **`409 Conflict`** (`Unit not AVAILABLE`), not `404`. This confirms that the unit exists and therefore provides weaker protection against enumeration than a `404`.
- Soft-deleted properties are excluded from unit search, rental-request listing joins, and owner-scoped lease/maintenance subqueries through explicit `deletedAt IS NULL` conditions where raw/query-builder joins are used.

## Server-derived identity fields

- Rental requests: `tenantId` and `status` are never accepted from the client (`forbidNonWhitelisted`).
- Maintenance: `unitId` is derived from the tenant’s `ACTIVE` lease.
- Leases and rental requests: `rentAmount` is snapshotted server-side.

## User directory and administration

- `GET /users/directory` — OWNER/ADMIN. **`role` is required** (`TENANT` or `MAINTENANCE_STAFF`). Optional `search` matches first name, last name, or email. Active users only. Fields: `{id, firstName, lastName, email, role}`.
- `GET /users`, `PATCH /users/:id/status`, `PATCH /users/:id/role` — ADMIN. Self-deactivation and self-role-change return `422`. Both writes are audited.

## Operation-to-role matrix

See the README table. It is derived from `@Roles()` plus the resource-level policy each service calls, not from a separate authorization configuration.
