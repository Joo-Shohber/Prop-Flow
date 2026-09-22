import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Paginated } from '../pagination/pagination.utils.js';

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccessResponse> {
    return next.handle().pipe(
      map((result: unknown) => {
        if (result instanceof Paginated) {
          return {
            success: true as const,
            data: result.data,
            meta: result.meta,
          };
        }
        return { success: true as const, data: result ?? null };
      }),
    );
  }
}
