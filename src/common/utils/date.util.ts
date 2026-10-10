import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../errors/error-code.enum.js';

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function assertValidDateRange(startDate: string, endDate: string): void {
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    throw new BadRequestException({
      code: ErrorCode.INVALID_DATE,
      message: 'startDate and endDate must be valid dates',
    });
  }

  if (startDate >= endDate) {
    throw new BadRequestException({
      code: ErrorCode.INVALID_DATE_RANGE,
      message: 'startDate must be before endDate',
    });
  }
}
