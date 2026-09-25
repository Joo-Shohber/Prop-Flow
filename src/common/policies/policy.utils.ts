import type { User } from '../../users/entities/user.entity.js';
import { UserRole } from '../../users/enums/user-role.enum.js';

export const isAdmin = (user: Pick<User, 'role'>): boolean =>
  user.role === UserRole.ADMIN;

export const hasRole = (
  user: Pick<User, 'role'>,
  ...roles: UserRole[]
): boolean => roles.includes(user.role);

export const canManageProperty = (
  user: Pick<User, 'id' | 'role'>,
  resource: { ownerId: string },
): boolean => isAdmin(user) || resource.ownerId === user.id;

export const canAccessLease = (
  user: Pick<User, 'id' | 'role'>,
  lease: { tenantId: string; unit: { property: { ownerId: string } } },
): boolean => {
  if (isAdmin(user)) return true;
  if (user.role === UserRole.TENANT) return lease.tenantId === user.id;
  return lease.unit.property.ownerId === user.id;
};

export const canAccessMaintenance = (
  user: Pick<User, 'id' | 'role'>,
  request: {
    tenantId: string;
    assignedStaffId: string | null;
    unit: { property: { ownerId: string } };
  },
): boolean => {
  if (isAdmin(user)) return true;
  if (user.role === UserRole.TENANT) return request.tenantId === user.id;
  if (user.role === UserRole.MAINTENANCE_STAFF)
    return request.assignedStaffId === user.id;
  return request.unit.property.ownerId === user.id;
};

export const canCloseOrCancelMaintenance = (
  user: Pick<User, 'id' | 'role'>,
  request: { tenantId: string; unit: { property: { ownerId: string } } },
): boolean =>
  isAdmin(user) ||
  request.tenantId === user.id ||
  request.unit.property.ownerId === user.id;
