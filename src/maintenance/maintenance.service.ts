import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  Paginated,
  resolveSort,
  toSkip,
} from '../common/pagination/pagination.utils.js';
import {
  canAccessMaintenance,
  canCloseOrCancelMaintenance,
  canManageProperty,
} from '../common/policies/policy.utils.js';
import { MAINTENANCE_MAX_IMAGES } from '../common/uploads/upload.constants.js';
import { UploadService } from '../common/uploads/upload.service.js';
import { LeasesService } from '../leases/leases.service.js';
import { Unit } from '../units/entities/unit.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { UsersService } from '../users/users.service.js';
import { AssignMaintenanceDto } from './dto/assign-maintenance.dto.js';
import { CompleteMaintenanceDto } from './dto/complete-maintenance.dto.js';
import { CreateMaintenanceRequestDto } from './dto/create-maintenance-request.dto.js';
import { ListMaintenanceQueryDto } from './dto/list-maintenance-query.dto.js';
import { TransitionNotesDto } from './dto/transition-notes.dto.js';
import { MaintenanceRequest } from './entities/maintenance-request.entity.js';
import { MaintenanceStatusHistory } from './entities/maintenance-status-history.entity.js';
import { MaintenanceStatus } from './enums/maintenance-status.enum.js';
import { AuditAction } from '../audit-logs/enums/audit-action.enum.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const MAINTENANCE_SORT_FIELDS = ['createdAt', 'priority', 'status'] as const;

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRepo: Repository<MaintenanceRequest>,
    @InjectRepository(MaintenanceStatusHistory)
    private readonly historyRepo: Repository<MaintenanceStatusHistory>,
    private readonly leasesService: LeasesService,
    private readonly usersService: UsersService,
    private readonly uploadService: UploadService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Finds a maintenance request by its ID.
   * @param id - Maintenance request ID.
   * @returns The maintenance request with its unit and property.
   * @throws NotFoundException If the request does not exist.
   */
  async findOne(id: string): Promise<MaintenanceRequest> {
    const maintenance = await this.maintenanceRepo.findOne({
      where: { id },
      relations: { unit: { property: true } },
    });
    if (!maintenance)
      throw new NotFoundException('Maintenance request not found');
    return maintenance;
  }

  /**
   * Finds a maintenance request and verifies that the actor is allowed to access it.
   * @param actor - Authenticated user requesting the resource.
   * @param id - Maintenance request ID.
   * @returns The maintenance request if access is allowed.
   * @throws NotFoundException If the request does not exist.
   * @throws ForbiddenException If the actor does not have access.
   */
  async findForActor(actor: User, id: string): Promise<MaintenanceRequest> {
    const maintenance = await this.findOne(id);
    if (!canAccessMaintenance(actor, maintenance)) {
      throw new ForbiddenException(
        'You do not have access to this maintenance request',
      );
    }
    return maintenance;
  }

  /**
   * Returns a paginated list of maintenance requests visible to the actor.
   * @param actor - Authenticated user requesting the list.
   * @param query - Pagination, sorting, and filtering parameters.
   * @returns Paginated maintenance requests.
   */
  async findAll(
    actor: User,
    query: ListMaintenanceQueryDto,
  ): Promise<Paginated<MaintenanceRequest>> {
    const { sortBy, sortOrder } = resolveSort(
      query,
      MAINTENANCE_SORT_FIELDS,
      'createdAt',
    );

    const queryBuilder = this.maintenanceRepo
      .createQueryBuilder('request')
      .innerJoin('request.unit', 'unit');

    if (actor.role === UserRole.TENANT) {
      queryBuilder.andWhere('request.tenantId = :tenantId', {
        tenantId: actor.id,
      });
    } else if (actor.role === UserRole.OWNER) {
      queryBuilder.andWhere(
        'unit.propertyId IN (SELECT id FROM properties WHERE "ownerId" = :ownerId)',
        {
          ownerId: actor.id,
        },
      );
    } else if (actor.role === UserRole.MAINTENANCE_STAFF) {
      queryBuilder.andWhere('request.assignedStaffId = :staffId', {
        staffId: actor.id,
      });
    }

    if (query.status)
      queryBuilder.andWhere('request.status = :status', {
        status: query.status,
      });

    if (query.priority)
      queryBuilder.andWhere('request.priority = :priority', {
        priority: query.priority,
      });

    if (query.category)
      queryBuilder.andWhere('request.category = :category', {
        category: query.category,
      });

    const [data, total] = await queryBuilder
      .orderBy(`request.${sortBy}`, sortOrder)
      .skip(toSkip(query))
      .take(query.limit)
      .getManyAndCount();

    return Paginated.of(data, total, query);
  }

  /**
   * Creates a new maintenance request for the authenticated tenant.
   * @param actor - Authenticated tenant creating the request.
   * @param dto - Maintenance request data.
   * @param files - Optional maintenance images.
   * @returns The newly created maintenance request.
   * @throws BadRequestException If the tenant has no active lease.
   */
  async create(
    actor: User,
    dto: CreateMaintenanceRequestDto,
    files: Express.Multer.File[],
  ): Promise<MaintenanceRequest> {
    const lease = await this.leasesService.findActiveLeaseForTenant(actor.id);
    if (!lease) throw new BadRequestException('You have no active lease');

    const images = files.length
      ? await this.uploadService.uploadImages(
          files,
          'propflow/maintenance',
          MAINTENANCE_MAX_IMAGES,
        )
      : [];

    return this.dataSource.transaction(async (manager) => {
      const unit = await this.loadUnit(manager, lease.unitId);

      const maintenance = manager.create(MaintenanceRequest, {
        ...dto,
        unitId: unit.id,
        tenantId: actor.id,
        status: MaintenanceStatus.OPEN,
        images,
      });
      const saved = await manager.save(maintenance);

      await this.notificationsService.create(manager, {
        recipientId: unit.property.ownerId,
        type: NotificationType.MAINTENANCE_CREATED,
        title: 'New maintenance request',
        message: `A new ${dto.priority.toLowerCase()} priority request was submitted for unit ${unit.unitNumber}.`,
        relatedEntityType: 'MaintenanceRequest',
        relatedEntityId: saved.id,
      });

      return saved;
    });
  }

  /**
   * Assigns an open maintenance request to an active maintenance staff member.
   * The request is locked inside a transaction to prevent concurrent status
   * changes while the assignment is being performed.
   * @param actor - Authenticated property owner or authorized manager.
   * @param id - Maintenance request ID.
   * @param dto - Staff assignment and optional scheduling information.
   * @returns The assigned maintenance request.
   * @throws BadRequestException If the selected staff member is invalid.
   * @throws ForbiddenException If the actor cannot manage the property.
   * @throws ConflictException If the request is not OPEN.
   */
  async assign(
    actor: User,
    id: string,
    dto: AssignMaintenanceDto,
    ip?: string,
  ): Promise<MaintenanceRequest> {
    const staff = await this.usersService.findById(dto.assignedStaffId);

    if (
      !staff ||
      staff.role !== UserRole.MAINTENANCE_STAFF ||
      !staff.isActive
    ) {
      throw new BadRequestException(
        'assignedStaffId must be an active user with the MAINTENANCE_STAFF role',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const request = await this.lock(manager, id);
      const unit = await this.loadUnit(manager, request.unitId);
      if (!canManageProperty(actor, unit.property)) {
        throw new ForbiddenException(
          'You do not have access to this maintenance request',
        );
      }
      if (request.status !== MaintenanceStatus.OPEN) {
        throw new ConflictException('Only an OPEN request can be assigned');
      }

      const previousStatus = request.status;
      request.status = MaintenanceStatus.ASSIGNED;
      request.assignedStaffId = staff.id;
      request.scheduledDate = dto.scheduledDate ?? null;
      await manager.save(request);
      await this.createMaintenanceHistory(
        manager,
        request.id,
        previousStatus,
        request.status,
        actor.id,
        dto.notes,
      );

      await this.notificationsService.create(manager, {
        recipientId: staff.id,
        type: NotificationType.MAINTENANCE_ASSIGNED,
        title: 'Maintenance request assigned to you',
        message: `You have been assigned to "${request.title}".`,
        relatedEntityType: 'MaintenanceRequest',
        relatedEntityId: request.id,
      });

      await this.notificationsService.create(manager, {
        recipientId: request.tenantId,
        type: NotificationType.MAINTENANCE_ASSIGNED,
        title: 'Your maintenance request was assigned',
        message: `"${request.title}" has been assigned to a technician.`,
        relatedEntityType: 'MaintenanceRequest',
        relatedEntityId: request.id,
      });

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.MAINTENANCE_ASSIGNED,
        entity: 'MaintenanceRequest',
        entityId: request.id,
        metadata: { assignedStaffId: staff.id },
        ipAddress: ip,
      });

      return request;
    });
  }

  /**
   * Moves an assigned maintenance request to IN_PROGRESS.
   * Only the staff member assigned to the request can start it.
   * @param actor - Authenticated maintenance staff member.
   * @param id - Maintenance request ID.
   * @param dto - Optional transition notes.
   * @returns The updated maintenance request.
   * @throws ForbiddenException If the actor is not the assigned staff member.
   * @throws ConflictException If the request is not ASSIGNED.
   */
  async start(
    actor: User,
    id: string,
    dto: TransitionNotesDto,
  ): Promise<MaintenanceRequest> {
    return this.dataSource.transaction(async (manager) => {
      const maintenance = await this.lock(manager, id);

      if (maintenance.assignedStaffId !== actor.id) {
        throw new ForbiddenException(
          'Only the assigned staff member can start this request',
        );
      }

      if (maintenance.status !== MaintenanceStatus.ASSIGNED) {
        throw new ConflictException('Only an ASSIGNED request can be started');
      }

      const previousStatus = maintenance.status;

      maintenance.status = MaintenanceStatus.IN_PROGRESS;

      await manager.save(maintenance);

      await this.createMaintenanceHistory(
        manager,
        maintenance.id,
        previousStatus,
        maintenance.status,
        actor.id,
        dto.notes,
      );

      return maintenance;
    });
  }

  /**
   * Marks an in-progress maintenance request as RESOLVED.
   * Completion images are uploaded before the transaction starts so external
   * upload latency does not keep the database row locked.
   * @param actor - Authenticated maintenance staff member.
   * @param id - Maintenance request ID.
   * @param dto - Resolution description and optional notes.
   * @param files - Optional completion images.
   * @returns The resolved maintenance request.
   * @throws ForbiddenException If the actor is not the assigned staff member.
   * @throws ConflictException If the request is not IN_PROGRESS.
   */
  async complete(
    actor: User,
    id: string,
    dto: CompleteMaintenanceDto,
    files: Express.Multer.File[],
    ip?: string,
  ): Promise<MaintenanceRequest> {
    const completionImages = files.length
      ? await this.uploadService.uploadImages(
          files,
          'propflow/maintenance-completions',
          MAINTENANCE_MAX_IMAGES,
        )
      : [];

    return this.dataSource.transaction(async (manager) => {
      const request = await this.lock(manager, id);
      if (request.assignedStaffId !== actor.id) {
        throw new ForbiddenException(
          'Only the assigned staff member can complete this request',
        );
      }
      if (request.status !== MaintenanceStatus.IN_PROGRESS) {
        throw new ConflictException(
          'Only an IN_PROGRESS request can be completed',
        );
      }

      const previousStatus = request.status;
      request.status = MaintenanceStatus.RESOLVED;
      request.resolutionDescription = dto.resolutionDescription;
      request.completionImages = completionImages;
      request.resolvedAt = new Date();
      await manager.save(request);
      await this.createMaintenanceHistory(
        manager,
        request.id,
        previousStatus,
        request.status,
        actor.id,
        dto.notes,
      );

      const unit = await this.loadUnit(manager, request.unitId);
      await this.notificationsService.create(manager, {
        recipientId: request.tenantId,
        type: NotificationType.MAINTENANCE_RESOLVED,
        title: 'Your maintenance request was resolved',
        message: `"${request.title}" has been marked as resolved.`,
        relatedEntityType: 'MaintenanceRequest',
        relatedEntityId: request.id,
      });

      await this.notificationsService.create(manager, {
        recipientId: unit.property.ownerId,
        type: NotificationType.MAINTENANCE_RESOLVED,
        title: 'A maintenance request was resolved',
        message: `"${request.title}" on unit ${unit.unitNumber} has been resolved.`,
        relatedEntityType: 'MaintenanceRequest',
        relatedEntityId: request.id,
      });

      await this.auditLogsService.record(manager, {
        userId: actor.id,
        action: AuditAction.MAINTENANCE_COMPLETED,
        entity: 'MaintenanceRequest',
        entityId: request.id,
        ipAddress: ip,
      });

      return request;
    });
  }

  /**
   * Closes a resolved maintenance request.
   * The actor must be authorized to close or cancel the request.
   * @param actor - Authenticated user performing the action.
   * @param id - Maintenance request ID.
   * @param dto - Optional transition notes.
   * @returns The closed maintenance request.
   * @throws ForbiddenException If the actor is not authorized.
   * @throws ConflictException If the request is not RESOLVED.
   */
  async close(
    actor: User,
    id: string,
    dto: TransitionNotesDto,
  ): Promise<MaintenanceRequest> {
    return this.dataSource.transaction(async (manager) => {
      const maintenance = await this.lock(manager, id);
      const unit = await this.loadUnit(manager, maintenance.unitId);

      if (
        !canCloseOrCancelMaintenance(actor, {
          tenantId: maintenance.tenantId,
          unit: { property: unit.property },
        })
      ) {
        throw new ForbiddenException(
          'You do not have access to this maintenance request',
        );
      }

      if (maintenance.status !== MaintenanceStatus.RESOLVED) {
        throw new ConflictException('Only a RESOLVED request can be closed');
      }

      const previousStatus = maintenance.status;

      maintenance.status = MaintenanceStatus.CLOSED;

      await manager.save(maintenance);

      await this.createMaintenanceHistory(
        manager,
        maintenance.id,
        previousStatus,
        maintenance.status,
        actor.id,
        dto.notes,
      );

      return maintenance;
    });
  }

  /**
   * Cancels an OPEN or ASSIGNED maintenance request.
   * The actor must be authorized to close or cancel the request.
   * @param actor - Authenticated user performing the action.
   * @param id - Maintenance request ID.
   * @param dto - Optional cancellation notes.
   * @returns The cancelled maintenance request.
   * @throws ForbiddenException If the actor is not authorized.
   * @throws ConflictException If the request cannot be cancelled
   * because of its current status.
   */
  async cancel(
    actor: User,
    id: string,
    dto: TransitionNotesDto,
  ): Promise<MaintenanceRequest> {
    return this.dataSource.transaction(async (manager) => {
      const maintenance = await this.lock(manager, id);
      const unit = await this.loadUnit(manager, maintenance.unitId);

      if (
        !canCloseOrCancelMaintenance(actor, {
          tenantId: maintenance.tenantId,
          unit: { property: unit.property },
        })
      ) {
        throw new ForbiddenException(
          'You do not have access to this maintenance request',
        );
      }

      if (
        maintenance.status !== MaintenanceStatus.OPEN &&
        maintenance.status !== MaintenanceStatus.ASSIGNED
      ) {
        throw new ConflictException(
          'Only an OPEN or ASSIGNED request can be cancelled',
        );
      }

      const previousStatus = maintenance.status;

      maintenance.status = MaintenanceStatus.CANCELLED;

      await manager.save(maintenance);

      await this.createMaintenanceHistory(
        manager,
        maintenance.id,
        previousStatus,
        maintenance.status,
        actor.id,
        dto.notes,
      );

      return maintenance;
    });
  }

  /**
   * Returns the complete status transition history of a maintenance request.
   * Access is verified before returning the history.
   * @param actor - Authenticated user requesting the history.
   * @param id - Maintenance request ID.
   * @returns Status history ordered from oldest to newest.
   * @throws NotFoundException If the request does not exist.
   * @throws ForbiddenException If the actor cannot access the request.
   */
  async getHistory(
    actor: User,
    id: string,
  ): Promise<MaintenanceStatusHistory[]> {
    await this.findForActor(actor, id);

    return this.historyRepo.find({
      where: { requestId: id },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Removes an image from an OPEN maintenance request.
   * The image is deleted from the external upload provider before the updated request is persisted.
   * @param actor - Authenticated user performing the action.
   * @param id - Maintenance request ID.
   * @param publicId - Public ID of the image to remove.
   * @returns The updated maintenance request.
   * @throws ForbiddenException If the actor cannot modify the request.
   * @throws ConflictException If the request is not OPEN.
   * @throws NotFoundException If the image does not belong to the request.
   */
  async removeImage(
    actor: User,
    id: string,
    publicId: string,
  ): Promise<MaintenanceRequest> {
    const maintenance = await this.findForActor(actor, id);

    if (!canCloseOrCancelMaintenance(actor, maintenance)) {
      throw new ForbiddenException(
        'You do not have access to this maintenance request',
      );
    }

    if (maintenance.status !== MaintenanceStatus.OPEN) {
      throw new ConflictException(
        'Images can only be removed while the request is OPEN',
      );
    }

    const imagePublicId = maintenance.images.find(
      (img) => img.publicId === publicId,
    );

    if (!imagePublicId)
      throw new NotFoundException('Image not found on this request');

    await this.uploadService.deleteImages([imagePublicId]);

    maintenance.images = maintenance.images.filter(
      (img) => img.publicId !== publicId,
    );

    const saved = await this.maintenanceRepo.save(maintenance);

    // await this.cache.invalidateDashboard();

    return saved;
  }

  /**
   * Removes a completion image from a RESOLVED maintenance request.
   * Only the staff member assigned to the request can modify completion images.
   * @param actor - Authenticated maintenance staff member.
   * @param id - Maintenance request ID.
   * @param publicId - Public ID of the completion image to remove.
   * @returns The updated maintenance request.
   * @throws ForbiddenException If the actor is not the assigned staff member.
   * @throws ConflictException If the request is not RESOLVED.
   * @throws NotFoundException If the image does not belong to the request.
   */
  async removeCompletionImage(
    actor: User,
    id: string,
    publicId: string,
  ): Promise<MaintenanceRequest> {
    const maintenance = await this.findForActor(actor, id);

    if (maintenance.assignedStaffId !== actor.id) {
      throw new ForbiddenException(
        'Only the assigned staff member can edit completion images',
      );
    }

    if (maintenance.status !== MaintenanceStatus.RESOLVED) {
      throw new ConflictException(
        'Completion images can only be removed while the request is RESOLVED',
      );
    }

    const imagePublicId = maintenance.completionImages.find(
      (img) => img.publicId === publicId,
    );

    if (!imagePublicId)
      throw new NotFoundException('Image not found on this request');

    await this.uploadService.deleteImages([imagePublicId]);

    maintenance.completionImages = maintenance.completionImages.filter(
      (img) => img.publicId !== publicId,
    );

    const saved = await this.maintenanceRepo.save(maintenance);

    // await this.cache.invalidateDashboard();

    return saved;
  }

  private async lock(
    manager: EntityManager,
    id: string,
  ): Promise<MaintenanceRequest> {
    const maintenance = await manager
      .createQueryBuilder(MaintenanceRequest, 'request')
      .setLock('pessimistic_write')
      .where('request.id = :id', { id })
      .getOne();

    if (!maintenance)
      throw new NotFoundException('Maintenance request not found');

    return maintenance;
  }

  private async loadUnit(
    manager: EntityManager,
    unitId: string,
  ): Promise<Unit> {
    const unit = await manager.findOne(Unit, {
      where: { id: unitId },
      relations: { property: true },
    });

    if (!unit) throw new NotFoundException('Unit not found');

    return unit;
  }

  private async createMaintenanceHistory(
    manager: EntityManager,
    requestId: string,
    previousStatus: MaintenanceStatus,
    newStatus: MaintenanceStatus,
    changedById: string,
    notes?: string,
  ): Promise<void> {
    await manager.insert(MaintenanceStatusHistory, {
      requestId,
      previousStatus,
      newStatus,
      changedById,
      notes: notes ?? null,
    });

    // Notification + audit record are added in Phase 7.
  }
}
