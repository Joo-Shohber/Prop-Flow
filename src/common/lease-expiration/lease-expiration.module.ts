import { Global, Module } from '@nestjs/common';
import { LeaseExpirationService } from './lease-expiration.service.js';

@Global()
@Module({
  providers: [LeaseExpirationService],
  exports: [LeaseExpirationService],
})
export class LeaseExpirationModule {}
