import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { Lease } from '../leases/entities/lease.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { Unit } from '../units/entities/unit.entity.js';
import { RentalRequest } from './entities/rental-request.entity.js';
import { RentalRequestsController } from './rental-requests.controller.js';
import { RentalRequestsService } from './rental-requests.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([RentalRequest, Unit, Lease]),
    NotificationsModule,
    AuditLogsModule,
  ],
  controllers: [RentalRequestsController],
  providers: [RentalRequestsService],
})
export class RentalRequestsModule {}
