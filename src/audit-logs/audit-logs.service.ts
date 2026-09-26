import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { Paginated, toSkip } from '../common/pagination/pagination.utils.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';
import { AuditLog } from './entities/audit-log.entity.js';
import { AuditAction } from './enums/audit-action.enum.js';

interface RecordAuditLogData {
  userId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  /**
   * Record an audit log for a business operation.
   * @param manager Transaction manager used to persist the audit log.
   * @param data Audit information including the user, action, entity,
   * entity ID, optional metadata, and IP address.
   */
  async record(
    manager: EntityManager,
    data: RecordAuditLogData,
  ): Promise<void> {
    const log = manager.create(AuditLog, {
      userId: data.userId,
      action: data.action,
      entity: data.entity,
      entityId: data.entityId,
      metadata: data.metadata ?? null,
      ipAddress: data.ipAddress ?? null,
    });

    await manager.save(AuditLog, log);
  }

  /**
   * Retrieve audit logs with optional filtering and pagination.
   * @param query Pagination and filtering options.
   * @returns Paginated audit logs matching the provided filters.
   */
  async findAll(query: ListAuditLogsQueryDto): Promise<Paginated<AuditLog>> {
    const where: FindOptionsWhere<AuditLog> = {};
    if (query.action) where.action = query.action;
    if (query.entity) where.entity = query.entity;
    if (query.userId) where.userId = query.userId;

    const [data, total] = await this.auditLogRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: toSkip(query),
      take: query.limit,
    });
    return Paginated.of(data, total, query);
  }
}
