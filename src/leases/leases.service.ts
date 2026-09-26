import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LeaseExpirationService } from '../common/lease-expiration/lease-expiration.service.js';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import {
  canAccessLease,
  canManageProperty,
} from '../common/policies/policy.utils.js';
import { Unit } from '../units/entities/unit.entity.js';
import { UnitStatus } from '../units/enums/unit-status.enum.js';
import { UnitsService } from '../units/units.service.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UsersService } from '../users/users.service.js';
import { CreateLeaseDto } from './dto/create-lease.dto.js';
import { ListLeasesQueryDto } from './dto/list-leases-query.dto.js';
import { UpdateLeaseDto } from './dto/update-lease.dto.js';
import { Lease } from './entities/lease.entity.js';
import { LeaseStatus } from './enums/lease-status.enum.js';
import { AuditAction } from '../audit-logs/enums/audit-action.enum.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const LEASE_SORT_FIELDS = ['createdAt', 'startDate', 'endDate'] as const;

@Injectable()
export class LeasesService {
  constructor(
    @InjectRepository(Lease)
    private readonly leaseRepo: Repository<Lease>,
    private readonly unitsService: UnitsService,
    private readonly usersService: UsersService,
    private readonly leaseExpiration: LeaseExpirationService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retrieves a lease by its ID.
   * @param id - The unique identifier of the lease.
   * @returns The requested lease with its related unit and property.
   * @throws NotFoundException If the lease does not exist.
   */
  async findOne(id: string): Promise<Lease> {
    const lease = await this.leaseRepo.findOne({
      where: { id },
      relations: { unit: { property: true } },
    });
    if (!lease) throw new NotFoundException('Lease not found');
    return lease;
  }

  /**
   * Retrieves a lease by its ID and verifies that the actor has access to it.
   * @param actor - The user requesting access to the lease.
   * @param id - The unique identifier of the lease.
   * @returns The requested lease.
   * @throws NotFoundException If the lease does not exist.
   * @throws ForbiddenException If the actor does not have access to the lease.
   */
  async findForActor(actor: User, id: string): Promise<Lease> {
    await this.leaseExpiration.run();
    const lease = await this.findOne(id);
    if (!canAccessLease(actor, lease)) {
      throw new ForbiddenException('You do not have access to this lease');
    }
    return lease;
  }

  /**
   * Retrieves a paginated list of leases accessible to the actor.
   * Supports filtering by status, unit, and tenant, as well as sorting and pagination.
   * @param actor - The user requesting the leases.
   * @param query - Filtering, sorting, and pagination parameters.
   * @returns A paginated list of accessible leases.
   */
  async findAll(
    actor: User,
    query: ListLeasesQueryDto,
  ): Promise<Paginated<Lease>> {
    await this.leaseExpiration.run();

    const { sortBy, sortOrder } = resolveSort(
      query,
      LEASE_SORT_FIELDS,
      'createdAt',
    );

    const queryBuilder = this.leaseRepo
      .createQueryBuilder('lease')
      .innerJoin('lease.unit', 'unit');

    if (actor.role === UserRole.TENANT) {
      queryBuilder.andWhere('lease.tenantId = :selfId', { selfId: actor.id });
    } else if (actor.role === UserRole.OWNER) {
      queryBuilder.andWhere(
        'unit.propertyId IN (SELECT id FROM properties WHERE "ownerId" = :ownerId)',
        {
          ownerId: actor.id,
        },
      );
    }
    if (query.status)
      queryBuilder.andWhere('lease.status = :status', { status: query.status });
    if (query.unitId)
      queryBuilder.andWhere('lease.unitId = :unitId', { unitId: query.unitId });
    if (query.tenantId)
      queryBuilder.andWhere('lease.tenantId = :tenantId', {
        tenantId: query.tenantId,
      });

    const [data, total] = await queryBuilder
      .orderBy(`lease.${sortBy}`, sortOrder)
      .skip(toSkip(query))
      .take(query.limit)
      .getManyAndCount();

    return Paginated.of(data, total, query);
  }

  /**
   * Finds the tenant's active lease.
   * Used by Maintenance: the unit is derived from the tenant's active lease.
   * @param tenantId The ID of the tenant.
   * @returns The tenant's active lease, or `null` if no active lease exists.
   */
  async findActiveLeaseForTenant(tenantId: string): Promise<Lease | null> {
    await this.leaseExpiration.run();
    return this.leaseRepo.findOneBy({ tenantId, status: LeaseStatus.ACTIVE });
  }

  /**
   * Creates a new pending lease for a unit.
   * Validates the lease dates and ensures that the tenant is an active
   * user with the TENANT role. Access to the unit is also verified.
   * @param actor - The user creating the lease.
   * @param dto - Lease creation data.
   * @returns The newly created lease.
   * @throws BadRequestException If the dates are invalid or the tenant
   * is not an active TENANT.
   * @throws ForbiddenException If the actor cannot access the unit.
   * @throws ConflictException If the lease conflicts with an existing lease.
   */
  async create(actor: User, dto: CreateLeaseDto, ip?: string): Promise<Lease> {
    await this.leaseExpiration.run();

    if (dto.startDate >= dto.endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const unit = await this.unitsService.findForActor(actor, dto.unitId);

    const tenant = await this.usersService.findById(dto.tenantId);
    if (!tenant || tenant.role !== UserRole.TENANT || !tenant.isActive) {
      throw new BadRequestException(
        'tenantId must be an active user with the TENANT role',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const lease = manager.create(Lease, {
        tenantId: tenant.id,
        unitId: unit.id,
        startDate: dto.startDate,
        endDate: dto.endDate,
        notes: dto.notes ?? null,
        status: LeaseStatus.PENDING,
      });
      const saved = await manager.save(lease);

      await this.notifications.create(manager, {
        recipientId: tenant.id,
        type: NotificationType.LEASE_CREATED,
        title: 'New lease created',
        message: `A lease for unit ${unit.unitNumber} has been created for you.`,
        relatedEntityType: 'Lease',
        relatedEntityId: saved.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.LEASE_CREATED,
        entity: 'Lease',
        entityId: saved.id,
        ipAddress: ip,
      });

      return saved;
    });
  }

  /**
   * Updates a pending lease.
   * Only leases with PENDING status can be updated. The resulting lease
   * dates are validated before saving the changes.
   * @param actor - The user requesting the update.
   * @param id - The unique identifier of the lease.
   * @param dto - Lease update data.
   * @returns The updated lease.
   * @throws NotFoundException If the lease does not exist.
   * @throws ForbiddenException If the actor does not have access to the lease.
   * @throws ConflictException If the lease is not PENDING.
   * @throws BadRequestException If the resulting dates are invalid.
   */
  async update(actor: User, id: string, dto: UpdateLeaseDto): Promise<Lease> {
    await this.leaseExpiration.run();
    const lease = await this.findForActor(actor, id);

    if (lease.status !== LeaseStatus.PENDING) {
      throw new ConflictException('Only a PENDING lease can be updated');
    }

    const startDate = dto.startDate ?? lease.startDate;
    const endDate = dto.endDate ?? lease.endDate;
    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    this.leaseRepo.merge(lease, { ...dto, startDate, endDate });
    return this.leaseRepo.save(lease);
  }

  /**
   * Activates a pending lease and marks its unit as rented.
   * The operation runs inside a database transaction and uses pessimistic
   * locking to prevent concurrent modifications to the lease and unit.
   * @param actor - The user activating the lease.
   * @param id - The unique identifier of the lease.
   * @returns The activated lease.
   * @throws NotFoundException If the lease or unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   * @throws ConflictException If the lease is not PENDING or the unit
   * is not AVAILABLE.
   */
  async activate(actor: User, id: string, ip?: string): Promise<Lease> {
    await this.leaseExpiration.run();

    return this.dataSource.transaction(async (manager) => {
      const lease = await manager
        .createQueryBuilder(Lease, 'lease')
        .setLock('pessimistic_write')
        .where('lease.id = :id', { id })
        .getOne();
      if (!lease) throw new NotFoundException('Lease not found');

      const unit = await manager.findOne(Unit, {
        where: { id: lease.unitId },
        relations: { property: true },
      });
      if (!unit) throw new NotFoundException('Unit not found');
      if (!canManageProperty(actor, unit.property)) {
        throw new ForbiddenException('You do not have access to this lease');
      }
      if (lease.status !== LeaseStatus.PENDING) {
        throw new ConflictException('Only a PENDING lease can be activated');
      }

      const lockedUnit = await manager
        .createQueryBuilder(Unit, 'unit')
        .setLock('pessimistic_write')
        .where('unit.id = :id', { id: unit.id })
        .getOne();
      if (!lockedUnit || lockedUnit.status !== UnitStatus.AVAILABLE) {
        throw new ConflictException('The unit is not AVAILABLE');
      }

      lease.status = LeaseStatus.ACTIVE;
      lockedUnit.status = UnitStatus.RENTED;
      await manager.save(lease);
      await manager.save(lockedUnit);

      await this.notifications.create(manager, {
        recipientId: lease.tenantId,
        type: NotificationType.LEASE_ACTIVATED,
        title: 'Lease activated',
        message: `Your lease for unit ${lockedUnit.unitNumber} is now active.`,
        relatedEntityType: 'Lease',
        relatedEntityId: lease.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.LEASE_ACTIVATED,
        entity: 'Lease',
        entityId: lease.id,
        ipAddress: ip,
      });

      return lease;
    });
  }

  /**
   * Terminates a pending or active lease.
   * The operation runs inside a database transaction. If the lease was
   * active, its unit is returned to AVAILABLE status.
   * @param actor - The user terminating the lease.
   * @param id - The unique identifier of the lease.
   * @returns The terminated lease.
   * @throws NotFoundException If the lease or unit does not exist.
   * @throws ForbiddenException If the actor cannot manage the property.
   * @throws ConflictException If the lease is not PENDING or ACTIVE.
   */
  async terminate(actor: User, id: string, ip?: string): Promise<Lease> {
    await this.leaseExpiration.run();

    return this.dataSource.transaction(async (manager) => {
      const lease = await manager
        .createQueryBuilder(Lease, 'lease')
        .setLock('pessimistic_write')
        .where('lease.id = :id', { id })
        .getOne();
      if (!lease) throw new NotFoundException('Lease not found');

      const unit = await manager.findOne(Unit, {
        where: { id: lease.unitId },
        relations: { property: true },
      });
      if (!unit) throw new NotFoundException('Unit not found');
      if (!canManageProperty(actor, unit.property)) {
        throw new ForbiddenException('You do not have access to this lease');
      }
      if (
        lease.status !== LeaseStatus.PENDING &&
        lease.status !== LeaseStatus.ACTIVE
      ) {
        throw new ConflictException(
          'Only a PENDING or ACTIVE lease can be terminated',
        );
      }

      const wasActive = lease.status === LeaseStatus.ACTIVE;
      lease.status = LeaseStatus.TERMINATED;
      await manager.save(lease);
      if (wasActive) {
        await manager.update(Unit, unit.id, { status: UnitStatus.AVAILABLE });
      }

      await this.notifications.create(manager, {
        recipientId: lease.tenantId,
        type: NotificationType.LEASE_TERMINATED,
        title: 'Lease terminated',
        message: `Your lease for unit ${unit.unitNumber} has been terminated.`,
        relatedEntityType: 'Lease',
        relatedEntityId: lease.id,
      });

      await this.auditLogs.record(manager, {
        userId: actor.id,
        action: AuditAction.LEASE_TERMINATED,
        entity: 'Lease',
        entityId: lease.id,
        ipAddress: ip,
      });

      return lease;
    });
  }
}
