import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/enums/user-role.enum.js';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
