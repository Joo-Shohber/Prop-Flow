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
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { LeaseExpirationService } from '../common/lease-expiration/lease-expiration.service.js';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import { canManageProperty } from '../common/policies/policy.utils.js';
import { isRealDate } from '../common/utils/date.util.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Unit } from '../units/entities/unit.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { ApproveLeaseRenewalRequestDto } from './dto/approve-lease-renewal-request.dto.js';
import { CreateLeaseRenewalRequestDto } from './dto/create-lease-renewal-request.dto.js';
import { LeaseRenewalRequestResponseDto } from './dto/lease-renewal-request-response.dto.js';
import { ListLeaseRenewalRequestsQueryDto } from './dto/list-lease-renewal-requests-query.dto.js';
import { LeaseRenewalRequest } from './entities/lease-renewal-request.entity.js';
import { Lease } from './entities/lease.entity.js';
import { LeaseRenewalRequestStatus } from './enums/lease-renewal-request-status.enum.js';
import { LeaseStatus } from './enums/lease-status.enum.js';
import { LeasesService } from './leases.service.js';

const RENEWAL_SORT_FIELDS = ['createdAt', 'requestedEndDate'] as const;

/**
 * Tenant-initiated lease renewals.
 *
 * Lock order is always lease first, then renewal request (the lease
 * expiration sweep, termination and LeasesService.applyRenewal follow the same
 * order), so these flows cannot deadlock each other. Reject and cancel only
 * ever lock the request row.
 */
@Injectable()
export class LeaseRenewalRequestsService {
  constructor(
    @InjectRepository(LeaseRenewalRequest)
    private readonly requestRepo: Repository<LeaseRenewalRequest>,
    private readonly dataSource: DataSource,
    private readonly leases: LeasesService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
    private readonly leaseExpiration: LeaseExpirationService,
  ) {}

  /**
   * Loads a renewal request with its tenant, lease, unit and property.
   * @throws NotFoundException If the request or its property does not exist.
   */
  private async findOne(id: string): Promise<LeaseRenewalRequest> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: { tenant: true, lease: { unit: { property: true } } },
    });

    if (!request?.lease?.unit?.property) {
      throw new NotFoundException('Renewal request not found');
    }

    return request;
  }

  /**
   * Retrieves a renewal request after verifying the actor may access it:
   * the tenant who made it, the owner of the property, or an ADMIN.
   * @throws NotFoundException If the request does not exist.
   * @throws ForbiddenException If the actor has no access.
   */
  async findForActor(
    actor: User,
    id: string,
  ): Promise<LeaseRenewalRequestResponseDto> {
    const request = await this.findOne(id);

    if (
      request.tenantId !== actor.id &&
      !canManageProperty(actor, request.lease.unit.property)
    ) {
      throw new ForbiddenException('You do not have access to this request');
    }

    return LeaseRenewalRequestResponseDto.fromEntity(request);
  }

  /**
   * Paginated list. TENANT: own requests. OWNER: requests for leases on owned
   * properties. ADMIN: all.
   */
  async findAll(
    actor: User,
    query: ListLeaseRenewalRequestsQueryDto,
  ): Promise<Paginated<LeaseRenewalRequestResponseDto>> {
    await this.leaseExpiration.run();

    const { sortBy, sortOrder } = resolveSort(
      query,
      RENEWAL_SORT_FIELDS,
      'createdAt',
    );

    const queryBuilder = this.requestRepo
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.tenant', 'tenant')
      .innerJoinAndSelect('request.lease', 'lease')
      .innerJoinAndSelect('lease.unit', 'unit')
      .innerJoin('unit.property', 'property', 'property.deletedAt IS NULL');

    if (actor.role === UserRole.TENANT) {
      queryBuilder.andWhere('request.tenantId = :selfId', { selfId: actor.id });
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

    if (query.leaseId) {
      queryBuilder.andWhere('request.leaseId = :leaseId', {
        leaseId: query.leaseId,
      });
    }

    const [data, total] = await queryBuilder
      .orderBy(`request.${sortBy}`, sortOrder)
      .skip(toSkip(query))
      .take(query.limit)
      .getManyAndCount();

    return Paginated.of(
      data.map((request) => LeaseRenewalRequestResponseDto.fromEntity(request)),
      total,
      query,
    );
  }

  /**
   * Creates a PENDING renewal request for the tenant's own ACTIVE lease.
   * The lease row is locked, so the request cannot race a termination or a
   * direct renewal. Only one request per lease can be PENDING.
   * @throws BadRequestException If the date is invalid or not after the current end date.
   * @throws NotFoundException If the lease (or its property) does not exist.
   * @throws ForbiddenException If the lease belongs to another tenant.
   * @throws ConflictException If the lease is not ACTIVE or a request is already PENDING.
   */
  async create(
    actor: User,
    dto: CreateLeaseRenewalRequestDto,
    ip?: string,
  ): Promise<LeaseRenewalRequestResponseDto> {
    await this.leaseExpiration.run();

    if (!isRealDate(dto.endDate)) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_DATE,
        message: 'endDate must be a valid date (YYYY-MM-DD)',
      });
    }

    const requestId = await this.dataSource.transaction(async (manager) => {
      const lease = await this.lockLease(manager, dto.leaseId);

      if (lease.tenantId !== actor.id) {
        throw new ForbiddenException('You do not have access to this lease');
      }

      const unit = await this.loadUnit(manager, lease.unitId);

      if (lease.status !== LeaseStatus.ACTIVE) {
        throw new ConflictException({
          code: ErrorCode.LEASE_NOT_ACTIVE,
          message: 'Only an ACTIVE lease can be renewed',
        });
      }

      if (dto.endDate <= lease.endDate) {
        throw new BadRequestException({
          code: ErrorCode.RENEWAL_END_NOT_AFTER_CURRENT,
          message: 'endDate must be after the current end date of the lease',
        });
      }

      const hasPending = await manager.exists(LeaseRenewalRequest, {
        where: { leaseId: lease.id, status: LeaseRenewalRequestStatus.PENDING },
      });

      if (hasPending) {
        throw new ConflictException({
          code: ErrorCode.RENEWAL_REQUEST_DUPLICATE_PENDING,
          message: 'This lease already has a pending renewal request',
        });
      }

      const saved = await manager.save(
        manager.create(LeaseRenewalRequest, {
          leaseId: lease.id,
          tenantId: actor.id,
          requestedEndDate: dto.endDate,
          message: dto.message ?? null,
          status: LeaseRenewalRequestStatus.PENDING,
        }),
      );

      await this.notifications.create(manager, {
        recipientId: unit.property.ownerId,
        type: NotificationType.LEASE_RENEWAL_REQUESTED,
        title: 'Lease renewal requested',
        message: `A tenant asked to extend the lease for unit ${unit.unitNumber} until ${dto.endDate}.`,
        relatedEntityType: 'LeaseRenewalRequest',
        relatedEntityId: saved.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.LEASE_RENEWAL_REQUESTED,
        entity: 'LeaseRenewalRequest',
        entityId: saved.id,
        metadata: { leaseId: lease.id, requestedEndDate: dto.endDate },
        ipAddress: ip,
      });

      return saved.id;
    });

    return LeaseRenewalRequestResponseDto.fromEntity(
      await this.findOne(requestId),
    );
  }

  /**
   * Approves a PENDING renewal request: the lease end date moves to the
   * requested date (or to `dto.endDate` if the owner grants a different one),
   * the request becomes APPROVED and the tenant is notified (LEASE_RENEWED).
   * If the new period overlaps another lease the database rejects it, the
   * whole transaction rolls back and the request stays PENDING.
   * @throws NotFoundException If the request (or its property) does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   * @throws ConflictException If the request is not PENDING, or the lease is not ACTIVE / overlaps.
   * @throws BadRequestException If the date is invalid or not after the current end date.
   */
  async approve(
    actor: User,
    id: string,
    dto: ApproveLeaseRenewalRequestDto,
    ip?: string,
  ): Promise<LeaseRenewalRequestResponseDto> {
    await this.leaseExpiration.run();

    if (dto.endDate !== undefined && !isRealDate(dto.endDate)) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_DATE,
        message: 'endDate must be a valid date (YYYY-MM-DD)',
      });
    }

    const found = await this.requestRepo.findOne({
      where: { id },
      select: { id: true, leaseId: true },
    });
    if (!found) throw new NotFoundException('Renewal request not found');

    await this.dataSource.transaction(async (manager) => {
      const lease = await this.lockLease(manager, found.leaseId);
      const request = await this.lockRequest(manager, id);
      const unit = await this.loadUnit(manager, lease.unitId);

      if (!canManageProperty(actor, unit.property)) {
        throw new ForbiddenException('You do not have access to this request');
      }

      if (request.status !== LeaseRenewalRequestStatus.PENDING) {
        throw new ConflictException({
          code: ErrorCode.RENEWAL_REQUEST_NOT_PENDING,
          message: 'Only a PENDING renewal request can be approved',
        });
      }

      await this.leases.applyRenewal(
        manager,
        actor,
        lease,
        unit,
        dto.endDate ?? request.requestedEndDate,
        ip,
        request.id,
      );
    });

    return LeaseRenewalRequestResponseDto.fromEntity(await this.findOne(id));
  }

  /**
   * Rejects a PENDING renewal request; the lease is unchanged.
   * @throws NotFoundException If the request (or its property) does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   * @throws ConflictException If the request is not PENDING.
   */
  async reject(
    actor: User,
    id: string,
    ip?: string,
  ): Promise<LeaseRenewalRequestResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id);
      const lease = await manager.findOne(Lease, {
        where: { id: request.leaseId },
      });
      if (!lease) throw new NotFoundException('Renewal request not found');
      const unit = await this.loadUnit(manager, lease.unitId);

      if (!canManageProperty(actor, unit.property)) {
        throw new ForbiddenException('You do not have access to this request');
      }

      if (request.status !== LeaseRenewalRequestStatus.PENDING) {
        throw new ConflictException({
          code: ErrorCode.RENEWAL_REQUEST_NOT_PENDING,
          message: 'Only a PENDING renewal request can be rejected',
        });
      }

      request.status = LeaseRenewalRequestStatus.REJECTED;
      await manager.save(request);

      await this.notifications.create(manager, {
        recipientId: request.tenantId,
        type: NotificationType.LEASE_RENEWAL_REJECTED,
        title: 'Lease renewal declined',
        message: `Your request to extend the lease for unit ${unit.unitNumber} was declined.`,
        relatedEntityType: 'LeaseRenewalRequest',
        relatedEntityId: request.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.LEASE_RENEWAL_REJECTED,
        entity: 'LeaseRenewalRequest',
        entityId: request.id,
        ipAddress: ip,
      });
    });

    return LeaseRenewalRequestResponseDto.fromEntity(await this.findOne(id));
  }

  /**
   * Withdraws a PENDING renewal request. Only the tenant who made it can.
   * @throws NotFoundException If the request (or its property) does not exist.
   * @throws ForbiddenException If the request belongs to another tenant.
   * @throws ConflictException If the request is not PENDING.
   */
  async cancel(
    actor: User,
    id: string,
    ip?: string,
  ): Promise<LeaseRenewalRequestResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id);

      if (request.tenantId !== actor.id) {
        throw new ForbiddenException('You do not have access to this request');
      }

      const lease = await manager.findOne(Lease, {
        where: { id: request.leaseId },
      });
      if (!lease) throw new NotFoundException('Renewal request not found');
      const unit = await this.loadUnit(manager, lease.unitId);

      if (request.status !== LeaseRenewalRequestStatus.PENDING) {
        throw new ConflictException({
          code: ErrorCode.RENEWAL_REQUEST_NOT_PENDING,
          message: 'Only a PENDING renewal request can be cancelled',
        });
      }

      request.status = LeaseRenewalRequestStatus.CANCELLED;
      await manager.save(request);

      await this.notifications.create(manager, {
        recipientId: unit.property.ownerId,
        type: NotificationType.LEASE_RENEWAL_CANCELLED,
        title: 'Lease renewal request withdrawn',
        message: `A tenant withdrew their request to extend the lease for unit ${unit.unitNumber}.`,
        relatedEntityType: 'LeaseRenewalRequest',
        relatedEntityId: request.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.LEASE_RENEWAL_CANCELLED,
        entity: 'LeaseRenewalRequest',
        entityId: request.id,
        ipAddress: ip,
      });
    });

    return LeaseRenewalRequestResponseDto.fromEntity(await this.findOne(id));
  }

  private async lockLease(manager: EntityManager, id: string): Promise<Lease> {
    const lease = await manager
      .createQueryBuilder(Lease, 'lease')
      .setLock('pessimistic_write')
      .where('lease.id = :id', { id })
      .getOne();

    if (!lease) throw new NotFoundException('Lease not found');

    return lease;
  }

  private async lockRequest(
    manager: EntityManager,
    id: string,
  ): Promise<LeaseRenewalRequest> {
    const request = await manager
      .createQueryBuilder(LeaseRenewalRequest, 'request')
      .setLock('pessimistic_write')
      .where('request.id = :id', { id })
      .getOne();

    if (!request) throw new NotFoundException('Renewal request not found');

    return request;
  }

  private async loadUnit(
    manager: EntityManager,
    unitId: string,
  ): Promise<Unit> {
    const unit = await manager.findOne(Unit, {
      where: { id: unitId },
      relations: { property: true },
    });

    if (!unit?.property) throw new NotFoundException('Lease not found');

    return unit;
  }
}
