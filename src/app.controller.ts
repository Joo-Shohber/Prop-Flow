import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator.js';
import { SkipThrottle } from '@nestjs/throttler';

@Public()
@SkipThrottle()
@Controller()
export class AppController {
  @Get('/')
  public getHome() {
    return 'PropFlow API is running correctly. Please refer to the documentation for available endpoints.';
  }
}
