import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface NormalizedError {
  statusCode: number;
  message: string;
  details?: unknown;
}

// Postgres Error Codes
const PG_ERRORS: Record<string, { statusCode: number; message: string }> = {
  '23505': {
    statusCode: HttpStatus.CONFLICT,
    message: 'A record with the same unique value already exists',
  },
  '23P01': {
    statusCode: HttpStatus.CONFLICT,
    message: 'The requested value conflicts with an existing record',
  },
  '23503': {
    statusCode: HttpStatus.CONFLICT,
    message: 'Related record does not exist or is still referenced',
  },
  '23514': {
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'The provided data violates a validation rule',
  },
  '22P02': {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Invalid identifier format',
  },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly config: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req: Request = http.getRequest();
    const res: Response = http.getResponse();

    const { statusCode, message, details } = this.normalize(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.originalUrl} -> ${statusCode} ${message}`,
      );
    }

    res.status(statusCode).json({
      success: false,
      statusCode,
      error: HttpStatus[statusCode] ?? 'ERROR',
      message,
      ...(details !== undefined && { details }),
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') return { statusCode, message: body };

      const { message } = body as { message?: string | string[] };
      if (Array.isArray(message)) {
        return { statusCode, message: 'Validation failed', details: message };
      }
      return { statusCode, message: message ?? exception.message };
    }

    if (exception instanceof QueryFailedError) {
      const code = (exception.driverError as { code?: string } | undefined)
        ?.code;
      const mapped = code ? PG_ERRORS[code] : undefined;
      if (mapped) return mapped;
    }

    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        !isProd && exception instanceof Error
          ? exception.message
          : 'Internal server error',
    };
  }
}
