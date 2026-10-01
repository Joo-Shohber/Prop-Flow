import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
  constructor(
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    private readonly propertiesService: PropertiesService,
    private readonly leaseExpiration: LeaseExpirationService,
    private readonly auditLogsService: AuditLogsService,
    private readonly uploads: UploadService,
    private readonly redis: RedisService,
    private readonly cache: CacheInvalidationService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retrieves a unit by its ID, including its associated property.
   * @param id - The unique ID of the unit.
   * @returns The requested unit with its property.
   * @throws NotFoundException If the unit does not exist.
   */
  async findOne(id: string): Promise<Unit> {
    const unit = await this.unitRepo.findOne({
      where: { id },
      relations: { property: true },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  /**
   * Retrieves a unit after verifying that the actor has permission
   * to manage the property that owns the unit.
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
    const cached = await this.redis.getJson<Paginated<Unit>>(cacheKey);
    if (cached) return cached;

    const { sortBy, sortOrder } = resolveSort(
      query,
      UNIT_SORT_FIELDS,
      'createdAt',
    );
    const queryBuilder = this.unitRepo
      .createQueryBuilder('unit')
      .innerJoin('unit.property', 'property');

    if (actor.role === UserRole.TENANT) {
      // Tenants only ever browse what's actually rentable — never RENTED/MAINTENANCE
      // units, and never scoped to a particular owner.
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
    await this.redis.setJson(cacheKey, result, UNITS_SEARCH_CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * Creates a new unit under a property after verifying that the actor
   * has permission to manage that property.
   * @param actor - The user creating the unit.
   * @param propertyId - The ID of the property that will contain the unit.
   * @param dto - The unit creation data.
   * @returns The newly created unit.
   * @throws NotFoundException If the property does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   */

  async create(
    actor: User,
    propertyId: string,
    dto: CreateUnitDto,
  ): Promise<Unit> {
    const property = await this.propertiesService.findForActor(
      actor,
      propertyId,
    );
    const saved = await this.unitRepo.save(
      this.unitRepo.create({ ...dto, propertyId: property.id }),
    );
    await this.cache.invalidateUnitsAndDashboard();

    return saved;
  }

  /**
   * Updates a unit after verifying that the actor has permission to manage its property.
   * @param actor - The user updating the unit.
   * @param id - The unique ID of the unit.
   * @param dto - The fields to update.
   * @returns The updated unit.
   * @throws NotFoundException If the unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the unit.
   */
  async update(actor: User, id: string, dto: UpdateUnitDto): Promise<Unit> {
    const unit = await this.findForActor(actor, id);
    this.unitRepo.merge(unit, dto);
    const saved = await this.unitRepo.save(unit);
    await this.cache.invalidateUnitsAndDashboard();
    return saved;
  }

  /**
   * Removes a unit after verifying that the actor has permission
   * to manage its property.
   * @param actor - The user removing the unit.
   * @param id - The unique ID of the unit.
   * @throws NotFoundException If the unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the unit.
   */
  async remove(actor: User, id: string): Promise<void> {
    const unit = await this.findForActor(actor, id);
    await this.unitRepo.remove(unit);
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
   * @throws BadRequestException If the current status is RENTED or the
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
      throw new BadRequestException(
        'A rented unit can only change status through the lease flow',
      );
    }
    if (MANUAL_TRANSITIONS[unit.status] !== status) {
      throw new BadRequestException(
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

  async addImages(
    actor: User,
    id: string,
    files: Express.Multer.File[],
  ): Promise<Unit> {
    const unit = await this.findForActor(actor, id);
    if (unit.images.length + files.length > UNIT_MAX_IMAGES) {
      throw new ConflictException(
        `A unit can have at most ${UNIT_MAX_IMAGES} images`,
      );
    }

    const uploaded = await this.uploads.uploadImages(
      files,
      'propflow/units',
      UNIT_MAX_IMAGES,
    );
    unit.images = [...unit.images, ...uploaded];
    const saved = await this.unitRepo.save(unit);
    await this.cache.invalidateUnitsAndDashboard();
    return saved;
  }

  async removeImage(actor: User, id: string, publicId: string): Promise<Unit> {
    const unit = await this.findForActor(actor, id);
    const image = unit.images.find((img) => img.publicId === publicId);
    if (!image) throw new NotFoundException('Image not found on this unit');

    await this.uploads.deleteImages([image]);
    unit.images = unit.images.filter((img) => img.publicId !== publicId);
    const saved = await this.unitRepo.save(unit);
    await this.cache.invalidateUnitsAndDashboard();
    return saved;
  }

  private buildSearchCacheKey(actor: User, query: ListUnitsQueryDto): string {
    // Every tenant sees the exact same AVAILABLE-only view for a given query,
    // so they share one cache bucket instead of one per tenant id.
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
