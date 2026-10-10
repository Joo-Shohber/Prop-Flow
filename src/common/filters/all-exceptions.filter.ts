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
import { ErrorCode } from '../errors/error-code.enum.js';

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

// Postgres Error Codes
const PG_ERRORS: Record<
  string,
  { statusCode: number; code: ErrorCode; message: string }
> = {
  '23505': {
    statusCode: HttpStatus.CONFLICT,
    code: ErrorCode.UNIQUE_VIOLATION,
    message: 'A record with the same unique value already exists',
  },
  '23P01': {
    statusCode: HttpStatus.CONFLICT,
    code: ErrorCode.LEASE_DATES_OVERLAP,
    message: 'The requested dates conflict with an existing lease',
  },
  '23503': {
    statusCode: HttpStatus.CONFLICT,
    code: ErrorCode.REFERENCED_RECORD,
    message: 'Related record does not exist or is still referenced',
  },
  '23514': {
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ErrorCode.CHECK_VIOLATION,
    message: 'The provided data violates a validation rule',
  },
  '23502': {
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ErrorCode.NOT_NULL_VIOLATION,
    message: 'A required value is missing',
  },
  '22001': {
    statusCode: HttpStatus.BAD_REQUEST,
    code: ErrorCode.VALUE_TOO_LONG,
    message: 'A value is too long for its field',
  },
  '22P02': {
    statusCode: HttpStatus.BAD_REQUEST,
    code: ErrorCode.INVALID_IDENTIFIER,
    message: 'Invalid identifier format',
  },
  '22007': {
    statusCode: HttpStatus.BAD_REQUEST,
    code: ErrorCode.INVALID_DATE,
    message: 'Invalid date value',
  },
  '22008': {
    statusCode: HttpStatus.BAD_REQUEST,
    code: ErrorCode.INVALID_DATE,
    message: 'Invalid date value',
  },
};

// Unique violations (23505) that deserve their own code, keyed by the name of
// the violated constraint/index. TypeORM derives these names from the table
// and column names, so they are the same in every environment.
const PG_CONSTRAINTS: Record<string, { code: ErrorCode; message: string }> = {
  UQ_177f53e2c2545127efe2fe8a8d2: {
    code: ErrorCode.UNIT_NUMBER_TAKEN,
    message: 'A unit with this number already exists in the property',
  },
  UQ_97672ac88f789774dd47f7c8be3: {
    code: ErrorCode.EMAIL_ALREADY_REGISTERED,
    message: 'Email is already registered',
  },
  UQ_rental_request_pending_tenant_unit: {
    code: ErrorCode.RENTAL_REQUEST_DUPLICATE_PENDING,
    message: 'You already have a pending request for this unit',
  },
  IDX_2c410fb5acd7bea80786e93cbf: {
    code: ErrorCode.UNIT_NOT_AVAILABLE,
    message: 'The unit already has an active lease',
  },
};

const genericCode = (statusCode: number): string =>
  HttpStatus[statusCode] ?? 'ERROR';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly config: ConfigService) {}

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { statusCode, code: genericCode(statusCode), message: body };
      }

      const { message, code, details } = body as {
        message?: string | string[];
        code?: string;
        details?: unknown;
      };

      if (Array.isArray(message)) {
        return {
          statusCode,
          code: code ?? ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: message,
        };
      }

      return {
        statusCode,
        code: code ?? genericCode(statusCode),
        message: message ?? exception.message,
        ...(details !== undefined && { details }),
      };
    }

    if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError as
        { code?: string; constraint?: string } | undefined;
      const mapped = driverError?.code
        ? PG_ERRORS[driverError.code]
        : undefined;

      if (mapped) {
        const specific =
          driverError?.code === '23505' && driverError.constraint
            ? PG_CONSTRAINTS[driverError.constraint]
            : undefined;

        return { ...mapped, ...specific };
      }
    }

    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message:
        !isProd && exception instanceof Error
          ? exception.message
          : 'Internal server error',
    };
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req: Request = http.getRequest();
    const res: Response = http.getResponse();

    const { statusCode, code, message, details } = this.normalize(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.originalUrl} -> ${statusCode} ${code} ${message}`,
      );
    }

    res.status(statusCode).json({
      success: false,
      statusCode,
      error: HttpStatus[statusCode] ?? 'ERROR',
      code,
      message,
      ...(details !== undefined && { details }),
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
