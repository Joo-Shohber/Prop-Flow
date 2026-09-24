import {
  BadRequestException,
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
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    private readonly propertiesService: PropertiesService,
    private readonly expiration: LeaseExpirationService,
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
    await this.expiration.run();

    const { sortBy, sortOrder } = resolveSort(
      query,
      UNIT_SORT_FIELDS,
      'createdAt',
    );

    const queryBuilder = this.unitRepo
      .createQueryBuilder('unit')
      .innerJoin('unit.property', 'property');

    if (actor.role !== UserRole.ADMIN) {
      queryBuilder.andWhere('property.ownerId = :ownerId', {
        ownerId: actor.id,
      });
    }
    if (query.propertyId) {
      queryBuilder.andWhere('unit.propertyId = :propertyId', {
        propertyId: query.propertyId,
      });
    }
    if (query.status)
      queryBuilder.andWhere('unit.status = :status', { status: query.status });
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

    const [data, total] = await queryBuilder
      .orderBy(`unit.${sortBy}`, sortOrder)
      .skip(toSkip(query))
      .take(query.limit)
      .getManyAndCount();

    return Paginated.of(data, total, query);
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
    return this.unitRepo.save(
      this.unitRepo.create({ ...dto, propertyId: property.id }),
    );
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
    return this.unitRepo.save(unit);
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
  }

  /**
   * Manually changes a unit's status between AVAILABLE and MAINTENANCE.
   * RENTED units cannot be changed manually because their status is controlled by the lease lifecycle.
   * @param actor - The user requesting the status change.
   * @param id - The unique ID of the unit.
   * @param status - The target unit status.
   * @returns The unit with its updated status.
   * @throws NotFoundException If the unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the unit.
   * @throws BadRequestException If the current status is RENTED or the
   * requested transition is not allowed.
   */
  async setStatus(actor: User, id: string, status: UnitStatus): Promise<Unit> {
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

    unit.status = status;
    return this.unitRepo.save(unit);
  }
}
