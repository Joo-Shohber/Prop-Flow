import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsOrder,
  FindOptionsWhere,
  ILike,
  Repository,
} from 'typeorm';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import { canManageProperty } from '../common/policies/policy.utils.js';
import { CacheInvalidationService } from '../common/cache/cache-invalidation.service.js';
import { PROPERTY_MAX_IMAGES } from '../common/uploads/upload.constants.js';
import { UploadService } from '../common/uploads/upload.service.js';
import { AuditAction } from '../audit-logs/enums/audit-action.enum.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { Lease } from '../leases/entities/lease.entity.js';
import { LeaseStatus } from '../leases/enums/lease-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Unit } from '../units/entities/unit.entity.js';
import { UnitStatus } from '../units/enums/unit-status.enum.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UsersService } from '../users/users.service.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { ListPropertiesQueryDto } from './dto/list-properties-query.dto.js';
import { UpdatePropertyDto } from './dto/update-property.dto.js';
import { Property } from './entities/property.entity.js';
import { RentalRequest } from '../rental-requests/entities/rental-request.entity.js';
import { RentalRequestStatus } from '../rental-requests/enums/rental-request-status.enum.js';

const PROPERTY_SORT_FIELDS = ['createdAt', 'name', 'city'] as const;
const DEFAULT_UNIT_NUMBER = '1';

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
    private readonly notificationsService: NotificationsService,
    private readonly cache: CacheInvalidationService,
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
   * Retrieves a property by ID and returns available units for tenants.
   * @param actor The authenticated user requesting the property.
   * @param id Property ID.
   * @returns The property, with available units for tenants.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor does not have access to manage the property.
   */
  async findForActor(actor: User, id: string) {
    const property = await this.findOne(id);

    if (actor.role === UserRole.TENANT) {
      const units = await this.unitsRepo.find({
        where: { propertyId: property.id, status: UnitStatus.AVAILABLE },
      });
      return { ...property, units };
    }

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
   * Creates a new property and optionally its first unit in a single transaction.
   * @param actor The authenticated user creating the property.
   * @param dto Property creation data, with an optional initial unit.
   * @param ip The user ip performing the action.
   * @returns The created property.
   * @throws BadRequestException If an admin provides an invalid ownerId.
   */
  async create(
    actor: User,
    dto: CreatePropertyDto,
    ip?: string,
  ): Promise<Property> {
    const { ownerId, unit: initialUnit, ...rest } = dto;
    let resolvedOwnerId = actor.id;

    if (actor.role === UserRole.ADMIN && !ownerId) {
      throw new BadRequestException(
        'ownerId is required when an admin creates a property',
      );
    }

    if (actor.role === UserRole.ADMIN && ownerId) {
      const owner = await this.usersService.findById(ownerId);
      if (!owner || owner.role !== UserRole.OWNER || !owner.isActive) {
        throw new BadRequestException(
          'ownerId must be an active user with the OWNER role',
        );
      }
      resolvedOwnerId = ownerId;
    }

    const property = await this.dataSource.transaction(async (manager) => {
      const created = manager.create(Property, {
        ...rest,
        ownerId: resolvedOwnerId,
      });
      await manager.save(Property, created);

      if (initialUnit) {
        const { unitNumber, ...unitFields } = initialUnit;
        await manager.save(
          manager.create(Unit, {
            ...unitFields,
            unitNumber: unitNumber ?? DEFAULT_UNIT_NUMBER,
            propertyId: created.id,
          }),
        );
      }

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.PROPERTY_CREATED,
        entity: 'Property',
        entityId: created.id,
        ipAddress: ip,
      });

      return created;
    });

    if (initialUnit) {
      await this.cache.invalidateUnitsAndDashboard();
    } else {
      await this.cache.invalidateDashboard();
    }
    return property;
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
    const saved = await this.propertyRepo.save(property);

    await this.cache.invalidateDashboard();
    return saved;
  }

  /**
   * Soft-deletes a property after verifying that the actor has permission
   * to manage it. A property with RENTED units cannot be removed.
   * Any PENDING leases on its units are terminated and any PENDING
   * rental requests are rejected in the same transaction. Affected
   * tenants are notified and each state change is audited.
   * @param actor The authenticated user performing the deletion.
   * @param id Property ID.
   * @param ip The user IP performing the action.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   * @throws ConflictException If the property has one or more rented units.
   */
  async remove(actor: User, id: string, ip?: string): Promise<void> {
    const property = await this.findForActor(actor, id);

    await this.dataSource.transaction(async (manager) => {
      const rentedCount = await manager.count(Unit, {
        where: { propertyId: property.id, status: UnitStatus.RENTED },
      });
      if (rentedCount > 0) {
        throw new ConflictException(
          'Cannot delete a property with rented units',
        );
      }

      const pendingLeases = await manager
        .createQueryBuilder(Lease, 'lease')
        .innerJoinAndSelect('lease.unit', 'unit')
        .where('unit.propertyId = :propertyId', { propertyId: property.id })
        .andWhere('lease.status = :status', {
          status: LeaseStatus.PENDING,
        })
        .setLock('pessimistic_write', undefined, ['lease'])
        .getMany();

      for (const lease of pendingLeases) {
        await manager.update(Lease, lease.id, {
          status: LeaseStatus.TERMINATED,
        });

        await this.notificationsService.create(manager, {
          recipientId: lease.tenantId,
          type: NotificationType.LEASE_TERMINATED,
          title: 'Lease terminated',
          message: `Your pending lease for unit ${lease.unit.unitNumber} was terminated because the property was removed.`,
          relatedEntityType: 'Lease',
          relatedEntityId: lease.id,
        });

        await this.auditLogsService.record(manager, {
          userId: actor.id,
          action: AuditAction.LEASE_TERMINATED,
          entity: 'Lease',
          entityId: lease.id,
          metadata: {
            reason: 'PROPERTY_DELETED',
            propertyId: property.id,
            unitId: lease.unitId,
          },
          ipAddress: ip,
        });
      }

      await manager.softDelete(Property, property.id);

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.PROPERTY_DELETED,
        entity: 'Property',
        entityId: property.id,
        ipAddress: ip,
      });
    });

    await this.cache.invalidateUnitsAndDashboard();
  }

  /**
   * Adds images to an existing property.
   * @param actor The authenticated user performing the upload.
   * @param id Property ID.
   * @param files Images to upload.
   * @returns The updated property.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   * @throws BadRequestException If no file was sent.
   * @throws ConflictException If the image limit would be exceeded.
   */
  async addImages(
    actor: User,
    id: string,
    files: Express.Multer.File[],
  ): Promise<Property> {
    const property = await this.findForActor(actor, id);

    if (!files?.length) {
      throw new BadRequestException('At least one image is required');
    }
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

    let saved: Property;

    try {
      saved = await this.propertyRepo.save(property);
    } catch (error) {
      try {
        await this.uploadService.deleteImages(uploadedImages);
      } catch {}

      throw error;
    }

    await this.cache.invalidateDashboard();

    return saved;
  }

  /**
   * Removes a single image from a property, both from Cloudinary and from the record.
   * @param actor The authenticated user performing the removal.
   * @param id Property ID.
   * @param publicId The Cloudinary publicId of the image to remove.
   * @returns The updated property.
   * @throws NotFoundException If the property or the image does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   */
  async removeImage(
    actor: User,
    id: string,
    publicId: string,
  ): Promise<Property> {
    const property = await this.findForActor(actor, id);
    const image = property.images.find((img) => img.publicId === publicId);
    if (!image) throw new NotFoundException('Image not found on this property');

    const originalImages = property.images;

    property.images = property.images.filter(
      (img) => img.publicId !== publicId,
    );

    let saved: Property;

    try {
      saved = await this.propertyRepo.save(property);
    } catch (error) {
      property.images = originalImages;
      throw error;
    }

    try {
      await this.uploadService.deleteImages([image]);
    } catch {
      // Cloudinary cleanup can be retried later, The database is already the source of truth.
    }

    await this.cache.invalidateDashboard();

    return saved;
  }

  private baseWhere(
    actor: User,
    query: ListPropertiesQueryDto,
  ): FindOptionsWhere<Property> {
    const where: FindOptionsWhere<Property> = {};
    if (actor.role === UserRole.OWNER) where.ownerId = actor.id;
    if (query.city) where.city = query.city;
    if (query.propertyType) where.propertyType = query.propertyType;
    return where;
  }
}
