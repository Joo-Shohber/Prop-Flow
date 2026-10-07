# Authorization

Authorization is enforced in two independent layers. Both must pass.

## Layer 1 — Role-based access control (RBAC)

- `@Roles(...roles)` attaches metadata.
- Global `RolesGuard` uses `Reflector.getAllAndOverride`. No metadata → any **authenticated** user. Otherwise `request.user.role` must be in the list (`403`).
- `JwtAuthGuard` runs after `ThrottlerGuard` and before `RolesGuard`. It attaches `request.user` and rejects inactive accounts. `@Public()` skips JWT (all `/auth/*` and `GET /`).

## The four roles

| Role | Description |
| --- | --- |
| `TENANT` | Browses all properties and `AVAILABLE` units, submits rental requests, and with an `ACTIVE` lease creates/tracks maintenance. |
| `OWNER` | Manages own properties/units, rental requests, leases, maintenance assignment, user directory, own-scoped analytics. |
| `MAINTENANCE_STAFF` | Only maintenance assigned to them. No properties, units, leases, rental requests, or analytics. |
| `ADMIN` | Cross-owner data, user admin, audit log. **Not unrestricted**: cannot create rental or maintenance requests; cannot start or complete maintenance. |

`POST /auth/register` accepts only `TENANT` or `OWNER`. First admin: `seed:admin`. Other roles: `PATCH /users/:id/role`. An admin cannot change their own role or deactivate themselves (`422`).

## Layer 2 — Resource-level policies

`src/common/policies/policy.utils.ts`:

| Function | Rule |
| --- | --- |
| `isAdmin(user)` | `role === ADMIN` |
| `hasRole(user, ...roles)` | Membership |
| `canManageProperty(user, { ownerId })` | ADMIN, or `ownerId === user.id` |
| `canAccessLease(user, lease)` | ADMIN always; TENANT if `lease.tenantId === user.id`; otherwise `lease.unit.property?.ownerId === user.id` |
| `canAccessRentalRequest(user, request)` | ADMIN always; TENANT if `request.tenantId === user.id`; otherwise `request.unit.property?.ownerId === user.id` |
| `canAccessMaintenance(user, request)` | ADMIN always; TENANT own request; staff if `assignedStaffId === user.id`; owner via property |
| `canCloseOrCancelMaintenance(user, request)` | ADMIN, the tenant, or the property owner — not staff |

`property` may be `null` after a soft delete; optional chaining is intentional.

### Where each is applied

- `PropertiesService.findForActor` / `UnitsService.findForActor` — every targeted property/unit read or write. TENANT property detail uses visibility rules (available units), not ownership. TENANT unit detail requires `AVAILABLE`.
- `LeasesService.findForActor` uses `canAccessLease`. `activate` / `terminate` / direct create use `canManageProperty` on the unit’s property (tenants cannot activate/terminate; those routes are OWNER/ADMIN).
- `RentalRequestsService` reads: `canAccessRentalRequest`. Approve/reject: `canManageProperty` after lock (`loadManagedUnit`).
- `MaintenanceService.findForActor`: `canAccessMaintenance`. Assign: `canManageProperty`. Close/cancel and OPEN image add/delete: `canCloseOrCancelMaintenance`. Start/complete and completion-image delete: `assignedStaffId === actor.id` only.

## Tenant visibility

- `GET /properties` — all properties. `GET /properties/:id` — property plus **only** `AVAILABLE` units.
- `GET /units` — always `AVAILABLE`; `status` query ignored.
- `GET /units/:id` — if the unit is not `AVAILABLE`, TENANT receives **`409 Conflict`** (`Unit not AVAILABLE`), not 404. That confirms the unit exists (weaker against enumeration than a 404).
- Soft-deleted properties are excluded from unit search, rental-request listing (join condition), and owner-scoped lease/maintenance subqueries (`deletedAt IS NULL`).

## Server-derived identity fields

- Rental requests: `tenantId` and `status` are never accepted from the client (`forbidNonWhitelisted`).
- Maintenance: `unitId` comes from the tenant’s `ACTIVE` lease.
- Leases and rental requests: `rentAmount` is snapshotted server-side.

## User directory and administration

- `GET /users/directory` — OWNER/ADMIN. **`role` is required** (`TENANT` or `MAINTENANCE_STAFF`). Optional `search` on first name, last name, or email. Active users only. Fields: `{id, firstName, lastName, email, role}`.
- `GET /users`, `PATCH /users/:id/status`, `PATCH /users/:id/role` — ADMIN. Self-deactivate / self-role-change → `422`. Both writes are audited.

## Operation-to-role matrix

See the README table. It is derived from `@Roles()` plus the policy each service calls, not from a separate configuration.
