import { Global, Module } from '@nestjs/common';
import { CacheInvalidationService } from './cache-invalidation.service.js';

@Global()
@Module({
  providers: [CacheInvalidationService],
  exports: [CacheInvalidationService],
})
export class CacheInvalidationModule {}
