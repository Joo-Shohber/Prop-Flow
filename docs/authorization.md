# Authorization

Authorization is enforced in two independent layers. Both must pass for a request to succeed.

## Layer 1 — Role-based access control (RBAC)

- `@Roles(...roles)` (`src/common/decorators/roles.decorator.ts`) attaches metadata to a handler or controller class.
- `RolesGuard` (`src/common/guards/roles.guard.ts`), registered globally as `APP_GUARD`, reads that metadata with `Reflector.getAllAndOverride`. If no `@Roles()` metadata is present, the guard allows any authenticated user through. If present, it checks `request.user.role` against the list and throws `ForbiddenException` (`403`) otherwise.
- `RolesGuard` runs after `JwtAuthGuard`, which is what attaches `request.user` in the first place. `@Public()` bypasses `JwtAuthGuard` entirely (used for `/auth/register`, `/auth/login`, etc.).

## The four roles

| Role                | Description                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `TENANT`            | Rents a unit; creates and tracks their own maintenance requests.                          |
| `OWNER`             | Owns properties; manages their own properties, units, leases, and maintenance assignment. |
| `MAINTENANCE_STAFF` | Works only the maintenance requests assigned to them.                                     |
| `ADMIN`             | Unrestricted access, plus user administration and the audit log.                          |

## Layer 2 — Resource-level policies

RBAC alone cannot stop an `OWNER` from passing another owner's property ID in the URL — that requires checking the specific row, not just the caller's role. This is implemented as pure functions in `src/common/policies/policy.utils.ts`, called explicitly from services before any read or write:

| Function                                     | Rule                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isAdmin(user)`                              | `user.role === ADMIN`.                                                                                                                                                        |
| `hasRole(user, ...roles)`                    | Membership check, used sparingly.                                                                                                                                             |
| `canManageProperty(user, { ownerId })`       | `true` for ADMIN, or when `resource.ownerId === user.id`. Used for `Property` directly, and for `Unit`/`MaintenanceRequest` via their parent `Property`.                      |
| `canAccessLease(user, lease)`                | ADMIN: always. TENANT: only if `lease.tenantId === user.id`. Otherwise (OWNER): only if `lease.unit.property.ownerId === user.id`.                                            |
| `canAccessMaintenance(user, request)`        | ADMIN: always. TENANT: only their own request. `MAINTENANCE_STAFF`: only if `request.assignedStaffId === user.id`. Otherwise (OWNER): only via the unit's property ownership. |
| `canCloseOrCancelMaintenance(user, request)` | ADMIN, the request's tenant, or the property's owner — deliberately excludes `MAINTENANCE_STAFF`.                                                                             |

### Where each is applied

- `PropertiesService.findForActor` / `UnitsService.findForActorOrFail` — every read and write of a specific property or unit.
- `LeasesService.findForActorOrFail` — reads. `LeasesService.activate` / `terminate` re-check `canManageProperty` directly against the locked unit's property inside the transaction (not via `canAccessLease`, since only OWNER/ADMIN — never the tenant — may activate or terminate).
- `MaintenanceService.findForActorOrFail` — reads. `assign` checks `canManageProperty` against the unit's property. `close`/`cancel` check `canCloseOrCancelMaintenance`. `start`/`complete` intentionally bypass the general policy functions and instead check `request.assignedStaffId === actor.id` directly — this is a stricter, narrower rule than any of the policy functions express, and by design excludes even `ADMIN`.

### Why two layers

- RBAC is cheap and stops entire classes of requests (a `TENANT` can never even attempt `POST /properties`).
- Resource-level checks are what actually prevent **IDOR** (Insecure Direct Object Reference): an authenticated, correctly-roled user supplying an ID that does not belong to them.

## Operation-to-role matrix

| Operation                          | TENANT                  | OWNER          | MAINTENANCE_STAFF | ADMIN       |
| ---------------------------------- | ----------------------- | -------------- | ----------------- | ----------- |
| Manage own profile/avatar          | own                     | own            | own               | own         |
| Property/Unit CRUD                 | —                       | own            | —                 | all         |
| List/view leases                   | own                     | own properties | —                 | all         |
| Create/activate/terminate leases   | —                       | own units      | —                 | all         |
| Create maintenance request         | own active lease's unit | —              | —                 | —           |
| Assign maintenance request         | —                       | own properties | —                 | all         |
| Start/complete maintenance request | —                       | —              | only if assigned  | —           |
| Close/cancel maintenance request   | own                     | own properties | —                 | all         |
| View notifications                 | own                     | own            | own               | own         |
| View audit log                     | —                       | —              | —                 | all         |
| View analytics dashboard           | —                       | own properties | —                 | system-wide |
| List/manage all users              | —                       | —              | —                 | all         |

This table is derived directly from the `@Roles()` decorators on each controller method combined with the policy function each service calls — it is not a separate configuration.
