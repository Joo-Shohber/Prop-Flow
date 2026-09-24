import {
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
import { User } from './entities/user.entity.js';
import { UserRole } from './enums/user-role.enum.js';
import { InjectRepository } from '@nestjs/typeorm';

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
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Finds a user by ID and throws an exception if the user does not exist.
   * @param id - The user's unique identifier.
   * @returns The requested user.
   * @throws NotFoundException If no user exists with the given ID.
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });

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
    return this.userRepository.findOneBy({ email });
  }

  /**
   * Finds the credentials required for authentication.
   * The password hash is explicitly selected because it is excluded
   * from normal queries through the entity's `select: false` setting.
   * @param email - The email address used for authentication.
   * @returns The user's ID, password hash, and active status if found.
   */
  findCredentialsByEmail(
    email: string,
  ): Promise<Pick<User, 'id' | 'passwordHash' | 'isActive' | 'isEmailVerified'> | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.passwordHash', 'user.isActive', 'user.isEmailVerified'])
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Creates and persists a new user.
   * The user is re-read after creation so the password hash,
   * which is excluded from normal queries, is not returned.
   * @param data - The data required to create the user.
   * @returns The newly created user.
   */
  async create(data: CreateUserData): Promise<User> {
    const saved = await this.userRepository.save(
      this.userRepository.create(data),
    );

    return this.findById(saved.id);
  }

  /**
   * Marks a user's email address as verified.
   * @param id - The ID of the user whose email should be marked as verified.
   * @returns A promise that resolves when the update is completed.
   */
  async makeEmailVerified(id: string): Promise<void> {
    await this.userRepository.update({ id }, { isEmailVerified: true });
  }

  /**
   * Updates a user's profile information.
   * @param user - The user whose profile should be updated.
   * @param dto - The profile fields to update.
   * @returns The updated user.
   */
  updateProfile(user: User, dto: UpdateProfileDto): Promise<User> {
    this.userRepository.merge(user, dto);

    return this.userRepository.save(user);
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

    const [data, total] = await this.userRepository.findAndCount({
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
   * @returns The updated user.
   * @throws UnprocessableEntityException If the actor tries to deactivate
   * their own account.
   * @throws NotFoundException If the target user does not exist.
   */
  async setStatus(id: string, isActive: boolean, actor: User): Promise<User> {
    if (actor.id === id && !isActive) {
      throw new UnprocessableEntityException(
        'You cannot deactivate your own account',
      );
    }

    const user = await this.findById(id);
    user.isActive = isActive;

    return this.userRepository.save(user);
  }

  /**
   * Changes a user's role.
   * A user cannot change their own role.
   * @param id - The ID of the user whose role should be changed.
   * @param role - The new role to assign.
   * @param actor - The user performing the action.
   * @returns The updated user.
   * @throws UnprocessableEntityException If the actor tries to change
   * their own role.
   * @throws NotFoundException If the target user does not exist.
   */
  async setRole(id: string, role: UserRole, actor: User): Promise<User> {
    if (actor.id === id) {
      throw new UnprocessableEntityException('You cannot change your own role');
    }

    const user = await this.findById(id);
    user.role = role;

    return this.userRepository.save(user);
  }
}
