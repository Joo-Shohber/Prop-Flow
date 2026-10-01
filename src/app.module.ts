import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { RedisModule } from './common/redis/redis.module.js';
import { validateEnv } from './config/env.validation.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UploadsModule } from './common/uploads/uploads.module.js';
import { PropertiesModule } from './properties/properties.module.js';
import { UnitsModule } from './units/units.module.js';
import { LeaseExpirationModule } from './common/lease-expiration/lease-expiration.module.js';
import { LeasesModule } from './leases/leases.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { CacheInvalidationModule } from './common/cache/cache-invalidation.module.js';
import { RateLimitModule } from './common/throttler/rate-limit.module.js';
import { RentalRequestsModule } from './rental-requests/rental-requests.module.js';
import { AppController } from './app.controller.js';

@Module({
  controllers: [AppController],
  imports: [
    RedisModule,
    CacheInvalidationModule,
    RateLimitModule,
    UploadsModule,
    LeaseExpirationModule,
    AuthModule,
    UsersModule,
    PropertiesModule,
    UnitsModule,
    LeasesModule,
    RentalRequestsModule,
    MaintenanceModule,
    NotificationsModule,
    AuditLogsModule,
    AnalyticsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        ssl:
          config.get<string>('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
