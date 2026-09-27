import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lease } from '../leases/entities/lease.entity.js';
import { MaintenanceRequest } from '../maintenance/entities/maintenance-request.entity.js';
import { Property } from '../properties/entities/property.entity.js';
import { Unit } from '../units/entities/unit.entity.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Property, Unit, Lease, MaintenanceRequest]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
