import type { User } from '../../users/entities/user.entity.js';
import { UserRole } from '../../users/enums/user-role.enum.js';

export const isAdmin = (user: Pick<User, 'role'>): boolean =>
  user.role === UserRole.ADMIN;

export const hasRole = (
  user: Pick<User, 'role'>,
  ...roles: UserRole[]
): boolean => roles.includes(user.role);

// Owner-or-admin check for any resource that carries an ownerId.
export const canManageProperty = (
  user: Pick<User, 'id' | 'role'>,
  resource: { ownerId: string },
): boolean => isAdmin(user) || resource.ownerId === user.id;

/** TENANT: only their own lease. OWNER: leases of their own properties. ADMIN: all. */
export const canAccessLease = (
  user: Pick<User, 'id' | 'role'>,
  lease: { tenantId: string; unit: { property: { ownerId: string } } },
): boolean => {
  if (isAdmin(user)) return true;
  if (user.role === UserRole.TENANT) return lease.tenantId === user.id;
  return lease.unit.property.ownerId === user.id;
};
