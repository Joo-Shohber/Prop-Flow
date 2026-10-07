import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DASHBOARD_STATS_CACHE_TTL_SECONDS } from '../common/cache/cache.constants.js';
import { LeaseExpirationService } from '../common/lease-expiration/lease-expiration.service.js';
import { RedisService } from '../common/redis/redis.service.js';
import { Lease } from '../leases/entities/lease.entity.js';
import { MaintenanceRequest } from '../maintenance/entities/maintenance-request.entity.js';
import { Property } from '../properties/entities/property.entity.js';
import { Unit } from '../units/entities/unit.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { DashboardStatsDto } from './dto/dashboard-stats.dto.js';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(Property)
    private readonly propertiesRepo: Repository<Property>,
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    @InjectRepository(Lease)
    private readonly leasesRepo: Repository<Lease>,
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRepo: Repository<MaintenanceRequest>,
    private readonly leaseExpiration: LeaseExpirationService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Returns dashboard statistics for the current actor.
   * Admins receive global statistics across all properties,
   * Owner users receive statistics limited to their own properties.
   * The result is cached in Redis to reduce repeated database queries.
   * @param actor The authenticated user requesting the dashboard.
   * @returns Dashboard statistics for the actor's scope.
   */
  async getDashboard(actor: User): Promise<DashboardStatsDto> {
    await this.leaseExpiration.run();

    const scope = actor.role === UserRole.ADMIN ? 'admin' : actor.id;
    const cacheKey = `dashboard:stats:${scope}`;

    try {
      const cached = await this.redis.getJson<DashboardStatsDto>(cacheKey);
      if (cached) return cached;
    } catch (error) {
      this.logger.warn(
        `Dashboard cache read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const ownerId = actor.role === UserRole.ADMIN ? undefined : actor.id;
    const stats = await this.computeStats(ownerId);

    try {
      await this.redis.setJson(
        cacheKey,
        stats,
        DASHBOARD_STATS_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Dashboard cache write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return stats;
  }

  private async computeStats(ownerId?: string): Promise<DashboardStatsDto> {
    const propertiesQb = this.propertiesRepo.createQueryBuilder('property');
    if (ownerId) propertiesQb.where('property.ownerId = :ownerId', { ownerId });
    const totalProperties = await propertiesQb.getCount();

    const unitStatsQb = this.unitsRepo
      .createQueryBuilder('unit')
      .innerJoin('unit.property', 'property')
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE unit.status = 'RENTED')`, 'occupied')
      .addSelect(
        `COUNT(*) FILTER (WHERE unit.status = 'AVAILABLE')`,
        'available',
      );
    if (ownerId) unitStatsQb.where('property.ownerId = :ownerId', { ownerId });
    const unitStats = await unitStatsQb.getRawOne<{
      total: string;
      occupied: string;
      available: string;
    }>();

    const totalUnits = Number(unitStats?.total ?? 0);
    const occupiedUnits = Number(unitStats?.occupied ?? 0);
    const availableUnits = Number(unitStats?.available ?? 0);
    const occupancyRate =
      totalUnits > 0
        ? Math.round((occupiedUnits / totalUnits) * 10000) / 100
        : 0;

    const leaseStatsQb = this.leasesRepo
      .createQueryBuilder('lease')
      .innerJoin('lease.unit', 'unit')
      .innerJoin('unit.property', 'property')
      .select(`COUNT(*) FILTER (WHERE lease.status = 'ACTIVE')`, 'active')
      .addSelect(`COUNT(*) FILTER (WHERE lease.status = 'EXPIRED')`, 'expired');
    if (ownerId) leaseStatsQb.where('property.ownerId = :ownerId', { ownerId });
    const leaseStats = await leaseStatsQb.getRawOne<{
      active: string;
      expired: string;
    }>();

    const maintenanceStatsQb = this.maintenanceRepo
      .createQueryBuilder('request')
      .innerJoin('request.unit', 'unit')
      .innerJoin('unit.property', 'property')
      .select(`COUNT(*) FILTER (WHERE request.status = 'OPEN')`, 'open')
      .addSelect(
        `COUNT(*) FILTER (WHERE request.status IN ('RESOLVED', 'CLOSED'))`,
        'resolved',
      )
      .addSelect(
        `AVG(EXTRACT(EPOCH FROM (request."resolvedAt" - request."createdAt")) / 3600) 
        FILTER (WHERE request."resolvedAt" IS NOT NULL)`,
        'avgResolutionHours',
      );
    if (ownerId)
      maintenanceStatsQb.where('property.ownerId = :ownerId', { ownerId });
    const maintenanceStats = await maintenanceStatsQb.getRawOne<{
      open: string;
      resolved: string;
      avgResolutionHours: string | null;
    }>();

    const categoriesQb = this.maintenanceRepo
      .createQueryBuilder('request')
      .innerJoin('request.unit', 'unit')
      .innerJoin('unit.property', 'property')
      .select('request.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('request.category')
      .orderBy('count', 'DESC')
      .limit(5);
    if (ownerId) categoriesQb.where('property.ownerId = :ownerId', { ownerId });
    const categoryRows = await categoriesQb.getRawMany<{
      category: string;
      count: string;
    }>();

    return {
      totalProperties,
      totalUnits,
      occupiedUnits,
      availableUnits,
      occupancyRate,
      activeLeases: Number(leaseStats?.active ?? 0),
      expiredLeases: Number(leaseStats?.expired ?? 0),
      openMaintenanceRequests: Number(maintenanceStats?.open ?? 0),
      resolvedMaintenanceRequests: Number(maintenanceStats?.resolved ?? 0),
      avgMaintenanceResolutionHours: maintenanceStats?.avgResolutionHours
        ? Math.round(Number(maintenanceStats.avgResolutionHours) * 100) / 100
        : null,
      mostCommonMaintenanceCategories: categoryRows.map((row) => ({
        category: row.category,
        count: Number(row.count),
      })),
    };
  }
}
