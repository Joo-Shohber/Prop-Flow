import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
@SkipThrottle()
export class AppController {
  @Get('/')
  public getHome() {
    return 'PropFlow System Is Working';
  }
}
