import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { AuditAction } from '../audit-logs/enums/audit-action.enum.js';
import { LeaseExpirationService } from '../common/lease-expiration/lease-expiration.service.js';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import {
  canAccessRentalRequest,
  canManageProperty,
} from '../common/policies/policy.utils.js';
import { Lease } from '../leases/entities/lease.entity.js';
import { LeaseStatus } from '../leases/enums/lease-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Unit } from '../units/entities/unit.entity.js';
import { UnitStatus } from '../units/enums/unit-status.enum.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { CreateRentalRequestDto } from './dto/create-rental-request.dto.js';
import { ListRentalRequestsQueryDto } from './dto/list-rental-requests-query.dto.js';
import { RentalRequestResponseDto } from './dto/rental-request-response.dto.js';
import { RentalRequest } from './entities/rental-request.entity.js';
import { RentalRequestStatus } from './enums/rental-request-status.enum.js';
import { assertValidDateRange, todayIso } from '../common/utils/date.util.js';

const RENTAL_REQUEST_SORT_FIELDS = [
  'createdAt',
  'startDate',
  'endDate',
] as const;

@Injectable()
export class RentalRequestsService {
  constructor(
    @InjectRepository(RentalRequest)
    private readonly requestRepo: Repository<RentalRequest>,
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    private readonly leaseExpiration: LeaseExpirationService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retrieves a rental request with its tenant, unit and the unit's property.
   * @param id - The unique identifier of the rental request.
   * @returns The requested rental request.
   * @throws NotFoundException If the request (or its property) does not exist.
   */
  private async findOne(id: string): Promise<RentalRequest> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: { tenant: true, unit: { property: true } },
    });

    if (!request?.unit?.property) {
      throw new NotFoundException('Rental request not found');
    }

    return request;
  }

  /**
   * Retrieves a rental request after verifying the actor may access it.
   * @param actor - The user requesting access.
   * @param id - The unique identifier of the rental request.
   * @returns The rental request.
   * @throws NotFoundException If the request does not exist.
   * @throws ForbiddenException If the actor does not have access to it.
   */
  async findForActor(
    actor: User,
    id: string,
  ): Promise<RentalRequestResponseDto> {
    const request = await this.findOne(id);

    if (!canAccessRentalRequest(actor, request)) {
      throw new ForbiddenException('You do not have access to this request');
    }

    return RentalRequestResponseDto.fromEntity(request);
  }

  /**
   * Retrieves a paginated list of rental requests visible to the actor.
   * TENANT: own requests. OWNER: requests for units in owned properties.
   * ADMIN: all requests. Filtering happens in the query, not in memory.
   * @param actor - The user requesting the list.
   * @param query - Filtering, sorting, and pagination parameters.
   * @returns A paginated list of rental requests.
   */
  async findAll(
    actor: User,
    query: ListRentalRequestsQueryDto,
  ): Promise<Paginated<RentalRequestResponseDto>> {
    const { sortBy, sortOrder } = resolveSort(
      query,
      RENTAL_REQUEST_SORT_FIELDS,
      'createdAt',
    );

    const queryBuilder = this.requestRepo
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.tenant', 'tenant')
      .innerJoinAndSelect('request.unit', 'unit')
      .innerJoin('unit.property', 'property', 'property.deletedAt IS NULL');

    if (actor.role === UserRole.TENANT) {
      queryBuilder.andWhere('request.tenantId = :selfId', {
        selfId: actor.id,
      });
    } else if (actor.role === UserRole.OWNER) {
      queryBuilder.andWhere('property.ownerId = :ownerId', {
        ownerId: actor.id,
      });
    }

    if (query.status) {
      queryBuilder.andWhere('request.status = :status', {
        status: query.status,
      });
    }

    if (query.unitId) {
      queryBuilder.andWhere('request.unitId = :unitId', {
        unitId: query.unitId,
      });
    }

    const [data, total] = await queryBuilder
      .orderBy(`request.${sortBy}`, sortOrder)
      .skip(toSkip(query))
      .take(query.limit)
      .getManyAndCount();

    return Paginated.of(
      data.map((request) => RentalRequestResponseDto.fromEntity(request)),
      total,
      query,
    );
  }

  /**
   * Creates a PENDING rental request for an available unit.
   * The tenant and status are always derived by the backend. Availability is
   * re-verified here; this is an early check, and the authoritative conflict
   * protection happens on approval.
   * @param actor - The tenant creating the request.
   * @param dto - Rental request data.
   * @param ip - The IP address of the user performing the action.
   * @returns The created rental request.
   * @throws BadRequestException If the dates are invalid or endDate is in the past.
   * @throws NotFoundException If the unit does not exist.
   * @throws ConflictException If the unit is not AVAILABLE or the dates
   * overlap an existing PENDING/ACTIVE lease.
   */
  async create(
    actor: User,
    dto: CreateRentalRequestDto,
    ip?: string,
  ): Promise<RentalRequestResponseDto> {
    await this.leaseExpiration.run();

    assertValidDateRange(dto.startDate, dto.endDate);

    if (dto.endDate < todayIso()) {
      throw new BadRequestException('endDate must not be in the past');
    }

    const unit = await this.unitRepo.findOne({
      where: { id: dto.unitId },
      relations: { property: true },
    });

    if (!unit?.property) {
      throw new NotFoundException('Unit not found');
    }

    if (unit.status !== UnitStatus.AVAILABLE) {
      throw new ConflictException('The unit is not available for rent');
    }

    const hasPending = await this.requestRepo.exists({
      where: {
        tenantId: actor.id,
        unitId: unit.id,
        status: RentalRequestStatus.PENDING,
      },
    });
    if (hasPending) {
      throw new ConflictException(
        'You already have a pending request for this unit',
      );
    }

    if (
      await this.hasLeaseConflict(
        this.dataSource.manager,
        unit.id,
        dto.startDate,
        dto.endDate,
      )
    ) {
      throw new ConflictException(
        'The unit is already leased for the requested dates',
      );
    }

    const requestId = await this.dataSource.transaction(async (manager) => {
      const request = manager.create(RentalRequest, {
        tenantId: actor.id,
        unitId: unit.id,
        startDate: dto.startDate,
        endDate: dto.endDate,
        message: dto.message ?? null,
        status: RentalRequestStatus.PENDING,
        rentAmount: unit.rentAmount,
      });
      await manager.save(request);

      await this.notifications.create(manager, {
        recipientId: unit.property.ownerId,
        type: NotificationType.RENTAL_REQUEST_CREATED,
        title: 'New rental request',
        message: `${actor.firstName} ${actor.lastName} requested to rent unit ${unit.unitNumber} from ${dto.startDate} to ${dto.endDate}.`,
        relatedEntityType: 'RentalRequest',
        relatedEntityId: request.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.RENTAL_REQUEST_CREATED,
        entity: 'RentalRequest',
        entityId: request.id,
        metadata: {
          unitId: unit.id,
          startDate: dto.startDate,
          endDate: dto.endDate,
        },
        ipAddress: ip,
      });

      return request.id;
    });

    return RentalRequestResponseDto.fromEntity(await this.findOne(requestId));
  }

  /**
   * Approves a PENDING rental request and creates a PENDING lease.
   * Runs in one transaction: the request row is locked, then the unit row, so
   * concurrent approvals for the same unit are serialized. The lease
   * exclusion constraint remains the final backstop. The unit status is NOT
   * changed; it becomes RENTED only through the existing lease activation.
   * @param actor - The owner/admin approving the request.
   * @param id - The unique identifier of the rental request.
   * @param ip - The IP address of the user performing the action.
   * @returns The approved rental request.
   * @throws NotFoundException If the request, unit or property does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   * @throws ConflictException If the request is not PENDING, its period has
   * already ended, the unit is not AVAILABLE, the tenant is no longer an
   * active TENANT, or the dates conflict with another lease.
   */
  async approve(
    actor: User,
    id: string,
    ip?: string,
  ): Promise<RentalRequestResponseDto> {
    await this.leaseExpiration.run();

    const requestId = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id);
      const unit = await this.loadManagedUnit(manager, actor, request);

      if (request.status !== RentalRequestStatus.PENDING) {
        throw new ConflictException(
          'Only a PENDING rental request can be approved',
        );
      }

      if (request.endDate < todayIso()) {
        throw new ConflictException('The requested period has already ended');
      }

      const lockedUnit = await manager
        .createQueryBuilder(Unit, 'unit')
        .setLock('pessimistic_write')
        .where('unit.id = :id', { id: unit.id })
        .getOne();

      if (!lockedUnit || lockedUnit.status !== UnitStatus.AVAILABLE) {
        throw new ConflictException('The unit is not AVAILABLE');
      }

      const tenant = await manager.findOne(User, {
        where: {
          id: request.tenantId,
        },
      });

      if (!tenant || !tenant.isActive || tenant.role !== UserRole.TENANT) {
        throw new ConflictException(
          'The requesting tenant is no longer an active tenant',
        );
      }

      if (
        await this.hasLeaseConflict(
          manager,
          unit.id,
          request.startDate,
          request.endDate,
        )
      ) {
        throw new ConflictException(
          'The unit is already leased for the requested dates',
        );
      }

      const lease = manager.create(Lease, {
        tenantId: request.tenantId,
        unitId: request.unitId,
        startDate: request.startDate,
        endDate: request.endDate,
        notes: null,
        status: LeaseStatus.PENDING,
        rentAmount: request.rentAmount,
      });

      await manager.save(lease);

      request.status = RentalRequestStatus.APPROVED;
      request.leaseId = lease.id;

      await manager.save(request);

      await this.notifications.create(manager, {
        recipientId: request.tenantId,
        type: NotificationType.RENTAL_REQUEST_APPROVED,
        title: 'Rental request approved',
        message: `Your rental request for unit ${unit.unitNumber} has been approved. A lease is now pending.`,
        relatedEntityType: 'RentalRequest',
        relatedEntityId: request.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.RENTAL_REQUEST_APPROVED,
        entity: 'RentalRequest',
        entityId: request.id,
        metadata: {
          leaseId: lease.id,
          unitId: unit.id,
        },
        ipAddress: ip,
      });

      return request.id;
    });

    return RentalRequestResponseDto.fromEntity(await this.findOne(requestId));
  }

  /**
   * Rejects a PENDING rental request. No lease is created and the unit is
   * left unchanged.
   * @param actor - The owner/admin rejecting the request.
   * @param id - The unique identifier of the rental request.
   * @param ip - The IP address of the user performing the action.
   * @returns The rejected rental request.
   * @throws NotFoundException If the request, unit or property does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   * @throws ConflictException If the request is not PENDING.
   */
  async reject(
    actor: User,
    id: string,
    ip?: string,
  ): Promise<RentalRequestResponseDto> {
    const requestId = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id);
      const unit = await this.loadManagedUnit(manager, actor, request);

      if (request.status !== RentalRequestStatus.PENDING) {
        throw new ConflictException(
          'Only a PENDING rental request can be rejected',
        );
      }

      request.status = RentalRequestStatus.REJECTED;
      await manager.save(request);

      await this.notifications.create(manager, {
        recipientId: request.tenantId,
        type: NotificationType.RENTAL_REQUEST_REJECTED,
        title: 'Rental request rejected',
        message: `Your rental request for unit ${unit.unitNumber} has been rejected.`,
        relatedEntityType: 'RentalRequest',
        relatedEntityId: request.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.RENTAL_REQUEST_REJECTED,
        entity: 'RentalRequest',
        entityId: request.id,
        metadata: {
          unitId: unit.id,
        },
        ipAddress: ip,
      });

      return request.id;
    });

    return RentalRequestResponseDto.fromEntity(await this.findOne(requestId));
  }

  /**
   * Locks the request row.
   * No joins are used because PostgreSQL FOR UPDATE should target the request row only.
   */
  private async lockRequest(
    manager: EntityManager,
    id: string,
  ): Promise<RentalRequest> {
    const request = await manager
      .createQueryBuilder(RentalRequest, 'request')
      .setLock('pessimistic_write')
      .where('request.id = :id', { id })
      .getOne();

    if (!request) {
      throw new NotFoundException('Rental request not found');
    }

    return request;
  }

  /**
   * Loads the request's Unit + Property and verifies that the actor
   * can manage the property.
   */
  private async loadManagedUnit(
    manager: EntityManager,
    actor: User,
    request: RentalRequest,
  ): Promise<Unit> {
    const unit = await manager.findOne(Unit, {
      where: {
        id: request.unitId,
      },
      relations: {
        property: true,
      },
    });

    if (!unit) {
      throw new NotFoundException('Unit not found');
    }

    if (!unit.property) {
      throw new NotFoundException('Property not found');
    }

    if (!canManageProperty(actor, unit.property)) {
      throw new ForbiddenException('You do not have access to this request');
    }

    return unit;
  }

  /**
   * Checks for a PENDING/ACTIVE lease overlapping the requested range.
   * Bounds are inclusive, matching the Lease exclusion constraint.
   */
  private hasLeaseConflict(
    manager: EntityManager,
    unitId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean> {
    return manager
      .createQueryBuilder(Lease, 'lease')
      .where('lease.unitId = :unitId', {
        unitId,
      })
      .andWhere('lease.status IN (:...statuses)', {
        statuses: [LeaseStatus.PENDING, LeaseStatus.ACTIVE],
      })
      .andWhere('lease.startDate <= :endDate', {
        endDate,
      })
      .andWhere('lease.endDate >= :startDate', {
        startDate,
      })
      .getExists();
  }
}
