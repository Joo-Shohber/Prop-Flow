import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnitsModule } from '../units/units.module.js';
import { UsersModule } from '../users/users.module.js';
import { LeaseRenewalRequest } from './entities/lease-renewal-request.entity.js';
import { Lease } from './entities/lease.entity.js';
import { LeaseRenewalRequestsController } from './lease-renewal-requests.controller.js';
import { LeaseRenewalRequestsService } from './lease-renewal-requests.service.js';
import { LeasesController } from './leases.controller.js';
import { LeasesService } from './leases.service.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lease, LeaseRenewalRequest]),
    UnitsModule,
    UsersModule,
    NotificationsModule,
    AuditLogsModule,
  ],
  controllers: [LeasesController, LeaseRenewalRequestsController],
  providers: [LeasesService, LeaseRenewalRequestsService],
  exports: [LeasesService],
})
export class LeasesModule {}
