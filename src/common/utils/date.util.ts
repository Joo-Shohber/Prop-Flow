import { BadRequestException } from '@nestjs/common';

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
    throw new BadRequestException('startDate and endDate must be valid dates');
  }

  if (startDate >= endDate) {
    throw new BadRequestException('startDate must be before endDate');
  }
}
