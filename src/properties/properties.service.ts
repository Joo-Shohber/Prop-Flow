import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, FindOptionsWhere, ILike, Repository } from 'typeorm';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import { canManageProperty } from '../common/policies/policy.utils.js';
import { PROPERTY_MAX_IMAGES } from '../common/uploads/upload.constants.js';
import { UploadService } from '../common/uploads/upload.service.js';
import { Unit } from '../units/entities/unit.entity.js';
import { UnitStatus } from '../units/enums/unit-status.enum.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UsersService } from '../users/users.service.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { ListPropertiesQueryDto } from './dto/list-properties-query.dto.js';
import { UpdatePropertyDto } from './dto/update-property.dto.js';
import { Property } from './entities/property.entity.js';
import { DataSource } from 'typeorm';
import { AuditAction } from '../audit-logs/enums/audit-action.enum.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';

const PROPERTY_SORT_FIELDS = ['createdAt', 'name', 'city'] as const;

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    private readonly usersService: UsersService,
    private readonly uploadService: UploadService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retrieves a property by its ID.
   * @param id Property ID.
   * @returns The requested property.
   * @throws NotFoundException If the property does not exist.
   */
  async findOne(id: string): Promise<Property> {
    const property = await this.propertyRepo.findOneBy({ id });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  /**
   * Retrieves a property by ID and verifies that the actor has permission to manage it.
   * @param actor The authenticated user performing the operation.
   * @param id Property ID.
   * @returns The property if the actor has access.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor does not have access to the property.
   */
  async findForActor(actor: User, id: string): Promise<Property> {
    const property = await this.findOne(id);
    if (!canManageProperty(actor, property)) {
      throw new ForbiddenException('You do not have access to this property');
    }
    return property;
  }

  /**
   * Retrieves a paginated list of properties visible to the actor.
   * @param actor The authenticated user requesting the properties.
   * @param query Filtering, sorting, searching, and pagination options.
   * @returns A paginated list of properties.
   */
  async findAll(
    actor: User,
    query: ListPropertiesQueryDto,
  ): Promise<Paginated<Property>> {
    const { sortBy, sortOrder } = resolveSort(
      query,
      PROPERTY_SORT_FIELDS,
      'createdAt',
    );
    const base = this.baseWhere(actor, query);

    const where: FindOptionsWhere<Property> | FindOptionsWhere<Property>[] =
      query.search
        ? [
            { ...base, name: ILike(`%${query.search}%`) },
            { ...base, address: ILike(`%${query.search}%`) },
          ]
        : base;

    const [data, total] = await this.propertyRepo.findAndCount({
      where,
      order: { [sortBy]: sortOrder } as FindOptionsOrder<Property>,
      skip: toSkip(query),
      take: query.limit,
    });

    return Paginated.of(data, total, query);
  }

  /**
   * Creates a new property.
   * @param actor The authenticated user creating the property.
   * @param dto Property creation data.
   * @param ip - The user ip who performing the action.
   * @returns The created property.
   * @throws BadRequestException If an admin provides an invalid ownerId.
   */
  async create(
    actor: User,
    dto: CreatePropertyDto,
    ip?: string,
  ): Promise<Property> {
    const { ownerId, ...rest } = dto;
    let resolvedOwnerId = actor.id;

    if (actor.role === UserRole.ADMIN && ownerId) {
      const owner = await this.usersService.findById(ownerId);
      if (!owner || owner.role !== UserRole.OWNER || !owner.isActive) {
        throw new BadRequestException(
          'ownerId must be an active user with the OWNER role',
        );
      }
      resolvedOwnerId = ownerId;
    }

    return this.dataSource.transaction(async (manager) => {
      const property = manager.create(Property, {
        ...rest,
        ownerId: resolvedOwnerId,
      });

      await manager.save(Property, property);

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.PROPERTY_CREATED,
        entity: 'Property',
        entityId: property.id,
        ipAddress: ip,
      });

      return property;
    });
  }

  /**
   * Updates an existing property.
   * @param actor The authenticated user performing the update.
   * @param id Property ID.
   * @param dto Property update data.
   * @returns The updated property.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   */

  async update(
    actor: User,
    id: string,
    dto: UpdatePropertyDto,
  ): Promise<Property> {
    const property = await this.findForActor(actor, id);
    this.propertyRepo.merge(property, dto);
    return this.propertyRepo.save(property);
  }

  /**
   * Soft-deletes a property if none of its units are currently rented.
   * @param actor The authenticated user performing the deletion.
   * @param id Property ID.
   * @param ip - The user ip who performing the action.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   * @throws ConflictException If the property has one or more rented units.
   */
  async remove(actor: User, id: string, ip?: string): Promise<void> {
    const property = await this.findForActor(actor, id);
    const rentedCount = await this.unitsRepo.count({
      where: { propertyId: property.id, status: UnitStatus.RENTED },
    });
    if (rentedCount > 0) {
      throw new ConflictException('Cannot delete a property with rented units');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(Property, property.id);
      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.PROPERTY_DELETED,
        entity: 'Property',
        entityId: property.id,
        ipAddress: ip,
      });
    });
  }

  /**
   * Adds images to an existing property.
   * @param actor The authenticated user performing the upload.
   * @param id Property ID.
   * @param files Images to upload.
   * @returns The updated property.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   * @throws ConflictException If the image limit would be exceeded.
   */
  async addImages(
    actor: User,
    id: string,
    files: Express.Multer.File[],
  ): Promise<Property> {
    const property = await this.findForActor(actor, id);
    if (property.images.length + files.length > PROPERTY_MAX_IMAGES) {
      throw new ConflictException(
        `A property can have at most ${PROPERTY_MAX_IMAGES} images`,
      );
    }

    const uploadedImages = await this.uploadService.uploadImages(
      files,
      'propflow/properties',
      PROPERTY_MAX_IMAGES,
    );

    property.images = [...property.images, ...uploadedImages];
    return this.propertyRepo.save(property);
  }

  async removeImage(
    actor: User,
    id: string,
    publicId: string,
  ): Promise<Property> {
    const property = await this.findForActor(actor, id);
    const image = property.images.find((img) => img.publicId === publicId);
    if (!image) throw new NotFoundException('Image not found on this property');

    await this.uploadService.deleteImages([image]);
    property.images = property.images.filter(
      (img) => img.publicId !== publicId,
    );
    const saved = await this.propertyRepo.save(property);
    // await this.cache.invalidateDashboard();
    return saved;
  }

  private baseWhere(
    actor: User,
    query: ListPropertiesQueryDto,
  ): FindOptionsWhere<Property> {
    const where: FindOptionsWhere<Property> = {};
    if (actor.role !== UserRole.ADMIN) where.ownerId = actor.id;
    if (query.city) where.city = query.city;
    if (query.propertyType) where.propertyType = query.propertyType;
    return where;
  }
}
