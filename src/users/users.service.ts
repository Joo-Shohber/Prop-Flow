import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FindOptionsOrder, FindOptionsWhere, Repository } from 'typeorm';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { User, userAvatar } from './entities/user.entity.js';
import { UserRole } from './enums/user-role.enum.js';
import { InjectRepository } from '@nestjs/typeorm';
import { UploadService } from '../common/uploads/upload.service.js';
import { DataSource } from 'typeorm';
import { AuditAction } from '../audit-logs/enums/audit-action.enum.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';

const USER_SORT_FIELDS = [
  'createdAt',
  'email',
  'firstName',
  'lastName',
  'role',
] as const;

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly uploadService: UploadService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Finds a user by ID and throws an exception if the user does not exist.
   * @param id - The user's unique identifier.
   * @returns The requested user.
   * @throws NotFoundException If no user exists with the given ID.
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Finds a user by their email address.
   * @param email - The user's email address.
   * @returns The user if found, otherwise `null`.
   */
  findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOneBy({ email });
  }

  /**
   * Finds the credentials required for authentication.
   * @param email - The email address used for authentication.
   * @returns The user's ID, password hash, and active status if found.
   */
  findCredentialsByEmail(
    email: string,
  ): Promise<Pick<
    User,
    'id' | 'passwordHash' | 'isActive' | 'isEmailVerified'
  > | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.passwordHash',
        'user.isActive',
        'user.isEmailVerified',
      ])
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Creates and persists a new user.
   * @param data - The data required to create the user.
   * @returns The newly created user.
   */
  async create(data: CreateUserData): Promise<User> {
    const saved = await this.userRepo.save(this.userRepo.create(data));

    return this.findById(saved.id);
  }

  /**
   * Sets a new avatar for the user.
   * @param user The user whose avatar will be updated.
   * @param file The new avatar image file.
   * @returns The updated user.
   * @throws BadRequestException if no avatar file is provided.
   */
  async setAvatar(user: User, file?: Express.Multer.File): Promise<User> {
    if (!file) throw new BadRequestException('You do not have an avatar');

    const [uploaded] = await this.uploadService.uploadImages(
      [file],
      'propflow/avatars',
      1,
    );
    if (user.avatar.publicId !== 'null')
      await this.uploadService.deleteImages([user.avatar]);
    user.avatar = uploaded;
    return this.userRepo.save(user);
  }

  /**
   * Removes the user's current avatar and restores the default avatar.
   * @param user The user whose avatar will be removed.
   * @returns The updated user with the default avatar.
   */
  async removeAvatar(user: User): Promise<User> {
    if (user.avatar.publicId === 'null') {
      throw new BadRequestException('You hava not avatar');
    }
    await this.uploadService.deleteImages([user.avatar]);

    user.avatar = userAvatar;
    return this.userRepo.save(user);
  }

  /**
   * Marks a user's email address as verified.
   * @param id - The ID of the user whose email should be marked as verified.
   * @returns A promise that resolves when the update is completed.
   */
  async makeEmailVerified(id: string): Promise<void> {
    await this.userRepo.update({ id }, { isEmailVerified: true });
  }

  /**
   * Updates a user's profile information.
   * @param user - The user whose profile should be updated.
   * @param dto - The profile fields to update.
   * @returns The updated user.
   */
  updateProfile(user: User, dto: UpdateProfileDto): Promise<User> {
    this.userRepo.merge(user, dto);

    return this.userRepo.save(user);
  }

  /**
   * Retrieves users with optional filtering, sorting, and pagination.
   * @param query - Filtering, sorting, and pagination parameters.
   * @returns A paginated list of users and the total number of matching users.
   */
  async findAll(query: ListUsersQueryDto): Promise<Paginated<User>> {
    const where: FindOptionsWhere<User> = {};

    const { sortBy, sortOrder } = resolveSort(
      query,
      USER_SORT_FIELDS,
      'createdAt',
    );

    if (query.role) {
      where.role = query.role;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [data, total] = await this.userRepo.findAndCount({
      where,
      order: { [sortBy]: sortOrder } as FindOptionsOrder<User>, // EX:- order: { email: DESC }
      skip: toSkip(query),
      take: query.limit,
    });

    return Paginated.of(data, total, query);
  }

  /**
   * Activates or deactivates a user account.
   * A user cannot deactivate their own account.
   * @param id - The ID of the user whose status should be changed.
   * @param isActive - Whether the account should be active.
   * @param actor - The user performing the action.
   * @param ip - The user ip who performing the action.
   * @returns The updated user.
   * @throws UnprocessableEntityException If the actor tries to deactivate
   * their own account.
   * @throws NotFoundException If the target user does not exist.
   */
  async setStatus(
    id: string,
    isActive: boolean,
    actor: User,
    ip?: string,
  ): Promise<User> {
    if (actor.id === id && !isActive) {
      throw new UnprocessableEntityException(
        'You cannot deactivate your own account',
      );
    }

    const user = await this.findById(id);
    user.isActive = isActive;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(user);
      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.USER_STATUS_CHANGED,
        entity: 'User',
        entityId: user.id,
        metadata: { isActive },
        ipAddress: ip,
      });
      return saved;
    });
  }

  /**
   * Changes a user's role.
   * A user cannot change their own role.
   * @param id - The ID of the user whose role should be changed.
   * @param role - The new role to assign.
   * @param actor - The user performing the action.
   * @param ip - The user ip who performing the action.
   * @returns The updated user.
   * @throws UnprocessableEntityException If the actor tries to change
   * their own role.
   * @throws NotFoundException If the target user does not exist.
   */
  async setRole(
    id: string,
    role: UserRole,
    actor: User,
    ip?: string,
  ): Promise<User> {
    if (actor.id === id) {
      throw new UnprocessableEntityException('You cannot change your own role');
    }

    const user = await this.findById(id);
    user.role = role;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(user);
      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.ROLE_CHANGED,
        entity: 'User',
        entityId: user.id,
        metadata: { role },
        ipAddress: ip,
      });
      return saved;
    });
  }

  /**
   * Finds a user by their Google account ID.
   * @param googleId - The unique Google account ID.
   * @returns The matching user, or null if no user is found.
   */
  findByGoogleId(googleId: string): Promise<User | null> {
    return this.userRepo.findOneBy({ googleId });
  }

  /**
   * Links a Google account to an existing user.
   * @param user - The user to link the Google account to.
   * @param googleId - The unique Google account ID.
   * @returns The updated user.
   */
  async linkGoogleAccount(user: User, googleId: string): Promise<User> {
    user.googleId = googleId;
    return this.userRepo.save(user);
  }

  /**
   * Creates a new user from Google account information.
   * The user's email is automatically marked as verified because it
   * has been verified by Google during the OAuth flow.
   * @param data - Google account and user profile data.
   * @returns The newly created user.
   */
  async createFromGoogle(data: {
    email: string;
    googleId: string;
    firstName: string;
    lastName: string;
  }): Promise<User> {
    const saved = await this.userRepo.save(
      this.userRepo.create({
        ...data,
        passwordHash: null,
        role: UserRole.TENANT,
        isEmailVerified: true,
      }),
    );
    return this.findById(saved.id);
  }
}
