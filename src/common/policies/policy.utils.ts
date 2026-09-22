import { UserRole } from '../../users/enums/user-role.enum.js';
import { User } from '../../users/entities/user.entity.js';

export const isAdmin = (user: Pick<User, 'role'>): boolean =>
  user.role === UserRole.ADMIN;

export const hasRole = (
  user: Pick<User, 'role'>,
  ...roles: UserRole[]
): boolean => roles.includes(user.role);
