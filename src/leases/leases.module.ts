import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnitsModule } from '../units/units.module.js';
import { UsersModule } from '../users/users.module.js';
import { Lease } from './entities/lease.entity.js';
import { LeasesController } from './leases.controller.js';
import { LeasesService } from './leases.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Lease]), UnitsModule, UsersModule],
  controllers: [LeasesController],
  providers: [LeasesService],
  exports: [LeasesService],
})
export class LeasesModule {}
