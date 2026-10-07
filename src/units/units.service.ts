import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import { canManageProperty } from '../common/policies/policy.utils.js';
import { PropertiesService } from '../properties/properties.service.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { CreateUnitDto } from './dto/create-unit.dto.js';
import { ListUnitsQueryDto } from './dto/list-units-query.dto.js';
import { UpdateUnitDto } from './dto/update-unit.dto.js';
import { Unit } from './entities/unit.entity.js';
import { UnitStatus } from './enums/unit-status.enum.js';
import { LeaseExpirationService } from '../common/lease-expiration/lease-expiration.service.js';
import { DataSource } from 'typeorm';
import { AuditAction } from '../audit-logs/enums/audit-action.enum.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { createHash } from 'node:crypto';
import { CacheInvalidationService } from '../common/cache/cache-invalidation.service.js';
import { UNITS_SEARCH_CACHE_TTL_SECONDS } from '../common/cache/cache.constants.js';
import { RedisService } from '../common/redis/redis.service.js';
import { UploadService } from '../common/uploads/upload.service.js';
import { UNIT_MAX_IMAGES } from '../common/uploads/upload.constants.js';

const UNIT_SORT_FIELDS = [
  'createdAt',
  'unitNumber',
  'area',
  'bedrooms',
] as const;

const MANUAL_TRANSITIONS: Partial<Record<UnitStatus, UnitStatus>> = {
  [UnitStatus.AVAILABLE]: UnitStatus.MAINTENANCE,
  [UnitStatus.MAINTENANCE]: UnitStatus.AVAILABLE,
};

@Injectable()
export class UnitsService {
  private readonly logger = new Logger(UnitsService.name);

  constructor(
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    private readonly propertiesService: PropertiesService,
    private readonly leaseExpiration: LeaseExpirationService,
    private readonly auditLogsService: AuditLogsService,
    private readonly uploadService: UploadService,
    private readonly redis: RedisService,
    private readonly cache: CacheInvalidationService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retrieves a unit by its ID, including its associated property.
   * A unit whose property was soft-deleted is treated as not found.
   * @param id - The unique ID of the unit.
   * @returns The requested unit with its property.
   * @throws NotFoundException If the unit does not exist.
   */
  async findOne(id: string): Promise<Unit> {
    const unit = await this.unitRepo.findOne({
      where: { id },
      relations: { property: true },
    });
    if (!unit?.property) throw new NotFoundException('Unit not found');
    return unit;
  }

  /**
   * Retrieves a unit after verifying that the actor has permission
   * to manage the property that owns the unit.
   * A TENANT can only see AVAILABLE units (anything else is a 404).
   * @param actor - The user requesting access.
   * @param id - The unique ID of the unit.
   * @returns The unit if the actor is authorized.
   * @throws NotFoundException If the unit does not exist.
   * @throws ForbiddenException If the actor is not allowed to access the unit.
   */
  async findForActor(actor: User, id: string): Promise<Unit> {
    const unit = await this.findOne(id);

    if (actor.role === UserRole.TENANT) {
      if (unit.status !== UnitStatus.AVAILABLE) {
        throw new NotFoundException('Unit not found');
      }

      return unit;
    }

    if (!canManageProperty(actor, unit.property)) {
      throw new ForbiddenException('You do not have access to this unit');
    }

    return unit;
  }

  /**
   * Retrieves a paginated list of units visible to the actor.
   * Redis is used as a best-effort cache: if it is down, the query
   * falls back to the database instead of failing the request.
   * @param actor - The user requesting the units.
   * @param query - Filtering, sorting, and pagination parameters.
   * @returns A paginated collection of units.
   */
  async findAll(
    actor: User,
    query: ListUnitsQueryDto,
  ): Promise<Paginated<Unit>> {
    await this.leaseExpiration.run();

    const cacheKey = this.buildSearchCacheKey(actor, query);

    let cached: Paginated<Unit> | null = null;
    try {
      cached = await this.redis.getJson<Paginated<Unit>>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `Units cache read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (cached) return cached;

    const { sortBy, sortOrder } = resolveSort(
      query,
      UNIT_SORT_FIELDS,
      'createdAt',
    );

    const queryBuilder = this.unitRepo
      .createQueryBuilder('unit')
      .innerJoin('unit.property', 'property')
      .andWhere('property."deletedAt" IS NULL');

    if (actor.role === UserRole.TENANT) {
      queryBuilder.andWhere('unit.status = :status', {
        status: UnitStatus.AVAILABLE,
      });
    } else {
      if (actor.role !== UserRole.ADMIN) {
        queryBuilder.andWhere('property.ownerId = :ownerId', {
          ownerId: actor.id,
        });
      }
      if (query.status)
        queryBuilder.andWhere('unit.status = :status', {
          status: query.status,
        });
    }

    if (query.propertyId) {
      queryBuilder.andWhere('unit.propertyId = :propertyId', {
        propertyId: query.propertyId,
      });
    }
    if (query.bedrooms !== undefined) {
      queryBuilder.andWhere('unit.bedrooms = :bedrooms', {
        bedrooms: query.bedrooms,
      });
    }
    if (query.minArea !== undefined)
      queryBuilder.andWhere('unit.area >= :minArea', {
        minArea: query.minArea,
      });
    if (query.maxArea !== undefined)
      queryBuilder.andWhere('unit.area <= :maxArea', {
        maxArea: query.maxArea,
      });
    if (query.minPrice !== undefined) {
      queryBuilder.andWhere('unit.rentAmount >= :minPrice', {
        minPrice: query.minPrice,
      });
    }
    if (query.maxPrice !== undefined) {
      queryBuilder.andWhere('unit.rentAmount <= :maxPrice', {
        maxPrice: query.maxPrice,
      });
    }

    const [data, total] = await queryBuilder
      .orderBy(`unit.${sortBy}`, sortOrder)
      .skip(toSkip(query))
      .take(query.limit)
      .getManyAndCount();

    const result = Paginated.of(data, total, query);

    try {
      await this.redis.setJson(
        cacheKey,
        result,
        UNITS_SEARCH_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Units cache write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  /**
   * Creates a new unit under a property after verifying that the actor
   * has permission to manage that property.
   * @param actor The authenticated user creating the unit.
   * @param propertyId The ID of the property that will contain the unit.
   * @param dto The unit creation data.
   * @param ip The user IP performing the action.
   * @returns The newly created unit.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   */
  async create(
    actor: User,
    propertyId: string,
    dto: CreateUnitDto,
    ip?: string,
  ): Promise<Unit> {
    const property = await this.propertiesService.findForActor(
      actor,
      propertyId,
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const created = manager.create(Unit, {
        ...dto,
        propertyId: property.id,
      });
      await manager.save(Unit, created);

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.UNIT_CREATED,
        entity: 'Unit',
        entityId: created.id,
        metadata: {
          propertyId: property.id,
        },
        ipAddress: ip,
      });

      return created;
    });

    await this.cache.invalidateUnitsAndDashboard();

    return saved;
  }

  /**
   * Updates a unit after verifying that the actor has permission to manage its property.
   * A RENTED unit cannot be updated.
   * @param actor - The user updating the unit.
   * @param id - The unique ID of the unit.
   * @param dto - The fields to update.
   * @returns The updated unit.
   * @throws NotFoundException If the unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the unit.
   * @throws ConflictException If the unit is currently RENTED.
   */
  async update(actor: User, id: string, dto: UpdateUnitDto): Promise<Unit> {
    const unit = await this.findForActor(actor, id);
    this.assertNotRented(unit, 'updated');

    this.unitRepo.merge(unit, dto);
    const saved = await this.unitRepo.save(unit);
    await this.cache.invalidateUnitsAndDashboard();
    return saved;
  }

  /**
   * Removes a unit after verifying that the actor has permission
   * to manage its property. A RENTED unit cannot be removed.
   * @param actor - The user removing the unit.
   * @param id - The unique ID of the unit.
   * @throws NotFoundException If the unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the unit.
   * @throws ConflictException If the unit is currently RENTED.
   */
  async remove(actor: User, id: string, ip?: string): Promise<void> {
    const unit = await this.findForActor(actor, id);

    await this.dataSource.transaction(async (manager) => {
      const currentUnit = await manager
        .createQueryBuilder(Unit, 'unit')
        .where('unit.id = :id', { id: unit.id })
        .setLock('pessimistic_write')
        .getOne();
      if (!currentUnit) {
        throw new NotFoundException('Unit not found');
      }

      this.assertNotRented(currentUnit, 'removed');

      await manager.remove(Unit, currentUnit);

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.UNIT_DELETED,
        entity: 'Unit',
        entityId: unit.id,
        ipAddress: ip,
      });
    });

    await this.cache.invalidateUnitsAndDashboard();
  }

  /**
   * Manually changes a unit's status between AVAILABLE and MAINTENANCE.
   * RENTED units cannot be changed manually because their status is controlled by the lease lifecycle.
   * @param actor - The user requesting the status change.
   * @param id - The unique ID of the unit.
   * @param status - The target unit status.
   * @param ip - The user ip who performing the action.
   * @returns The unit with its updated status.
   * @throws NotFoundException If the unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the unit.
   * @throws ConflictException If the current status is RENTED or the
   * requested transition is not allowed.
   */
  async setStatus(
    actor: User,
    id: string,
    status: UnitStatus,
    ip?: string,
  ): Promise<Unit> {
    const unit = await this.findForActor(actor, id);

    if (unit.status === UnitStatus.RENTED) {
      throw new ConflictException(
        'A rented unit can only change status through the lease flow',
      );
    }
    if (MANUAL_TRANSITIONS[unit.status] !== status) {
      throw new ConflictException(
        `Cannot change status from ${unit.status} to ${status}`,
      );
    }

    const previousStatus = unit.status;
    unit.status = status;

    const saved = await this.dataSource.transaction(async (manager) => {
      const result = await manager.save(unit);

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.UNIT_STATUS_CHANGED,
        entity: 'Unit',
        entityId: unit.id,
        metadata: { previousStatus, newStatus: status },
        ipAddress: ip,
      });
      return result;
    });

    await this.cache.invalidateUnitsAndDashboard();
    return saved;
  }

  /**
   * Adds images to a unit. Images may be changed even while the unit is RENTED.
   * @param actor - The user uploading the images.
   * @param id - The unique ID of the unit.
   * @param files - The images to upload.
   * @returns The updated unit.
   * @throws BadRequestException If no file was sent.
   * @throws ConflictException If the image limit would be exceeded.
   */
  async addImages(
    actor: User,
    id: string,
    files: Express.Multer.File[],
  ): Promise<Unit> {
    const unit = await this.findForActor(actor, id);

    if (!files?.length) {
      throw new BadRequestException('At least one image is required');
    }
    if (unit.images.length + files.length > UNIT_MAX_IMAGES) {
      throw new ConflictException(
        `A unit can have at most ${UNIT_MAX_IMAGES} images`,
      );
    }

    const uploaded = await this.uploadService.uploadImages(
      files,
      'propflow/units',
      UNIT_MAX_IMAGES,
    );
    unit.images = [...unit.images, ...uploaded];

    let saved: Unit;

    try {
      saved = await this.unitRepo.save(unit);
    } catch (error) {
      try {
        await this.uploadService.deleteImages(uploaded);
      } catch {}

      throw error;
    }

    await this.cache.invalidateUnitsAndDashboard();

    return saved;
  }

  /**
   * Removes an image from a unit. Images may be changed even while the unit is RENTED.
   * @param actor - The user removing the image.
   * @param id - The unique ID of the unit.
   * @param publicId - The Cloudinary publicId of the image to remove.
   * @returns The updated unit.
   * @throws NotFoundException If the unit or the image does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   */
  async removeImage(actor: User, id: string, publicId: string): Promise<Unit> {
    const unit = await this.findForActor(actor, id);
    const image = unit.images.find((img) => img.publicId === publicId);
    if (!image) throw new NotFoundException('Image not found on this unit');

    const originalImages = unit.images;
    unit.images = unit.images.filter((img) => img.publicId !== publicId);

    let saved: Unit;

    try {
      saved = await this.unitRepo.save(unit);
    } catch (error) {
      unit.images = originalImages;
      throw error;
    }

    try {
      await this.uploadService.deleteImages([image]);
    } catch {
      // Cloudinary cleanup can be retried later, The database is already the source of truth.
    }

    await this.cache.invalidateUnitsAndDashboard();

    return saved;
  }

  private assertNotRented(unit: Unit, action: 'updated' | 'removed'): void {
    if (unit.status === UnitStatus.RENTED) {
      throw new ConflictException(`A rented unit cannot be ${action}`);
    }
  }

  private buildSearchCacheKey(actor: User, query: ListUnitsQueryDto): string {
    const scope =
      actor.role === UserRole.ADMIN
        ? 'admin'
        : actor.role === UserRole.TENANT
          ? 'tenant'
          : actor.id;
    const canonical = {
      scope,
      status:
        actor.role === UserRole.TENANT
          ? UnitStatus.AVAILABLE
          : (query.status ?? null),
      propertyId: query.propertyId ?? null,
      bedrooms: query.bedrooms ?? null,
      minArea: query.minArea ?? null,
      maxArea: query.maxArea ?? null,
      minPrice: query.minPrice ?? null,
      maxPrice: query.maxPrice ?? null,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy ?? null,
      sortOrder: query.sortOrder,
    };
    const hash = createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex');
    return `units:search:${hash}`;
  }
}
