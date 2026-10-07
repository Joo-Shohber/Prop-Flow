import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertiesModule } from '../properties/properties.module.js';
import { Unit } from './entities/unit.entity.js';
import { UnitsController } from './units.controller.js';
import { UnitsService } from './units.service.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { RedisModule } from '../common/redis/redis.module.js';
import { CacheInvalidationModule } from '../common/cache/cache-invalidation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Unit]),
    PropertiesModule,
    AuditLogsModule,
    CacheInvalidationModule,
    NotificationsModule,
  ],
  controllers: [UnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}
