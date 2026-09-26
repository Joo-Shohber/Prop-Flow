import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeasesModule } from '../leases/leases.module.js';
import { UsersModule } from '../users/users.module.js';
import { MaintenanceRequest } from './entities/maintenance-request.entity.js';
import { MaintenanceStatusHistory } from './entities/maintenance-status-history.entity.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([MaintenanceRequest, MaintenanceStatusHistory]),
    LeasesModule,
    UsersModule,
    NotificationsModule,
    AuditLogsModule,
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
