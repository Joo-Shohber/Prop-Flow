import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req: Request = http.getRequest();
    const start = Date.now();

    // Errors are logged by AllExceptionsFilter.
    return next.handle().pipe(
      tap(() => {
        const res: Response = http.getResponse();
        this.logger.log(
          `${req.method} ${req.originalUrl} ${res.statusCode} +${Date.now() - start}ms`,
        );
      }),
    );
  }
}
