import { Global, Module } from '@nestjs/common';
import { UploadService } from './upload.service.js';

@Global()
@Module({
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadsModule {}
