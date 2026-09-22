import { BadRequestException } from '@nestjs/common';
import { PaginationQueryDto, SortOrder } from './pagination-query.dto.js';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  [key: string]: unknown;
}

export class Paginated<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: PaginationMeta,
  ) {}

  static of<T>(
    data: T[],
    total: number,
    query: Pick<PaginationQueryDto, 'page' | 'limit'>,
    extraMeta: Record<string, unknown> = {},
  ): Paginated<T> {
    return new Paginated(data, {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      ...extraMeta,
    });
  }
}

export function toSkip(
  query: Pick<PaginationQueryDto, 'page' | 'limit'>,
): number {
  return (query.page - 1) * query.limit;
}

export function resolveSort<T extends string>(
  query: PaginationQueryDto,
  allowed: readonly T[],
  fallback: T,
): { sortBy: T; sortOrder: 'ASC' | 'DESC' } {
  const sortBy = query.sortBy ?? fallback;
  if (!allowed.includes(sortBy as T)) {
    throw new BadRequestException(
      `sortBy must be one of: ${allowed.join(', ')}`,
    );
  }
  return { sortBy: sortBy as T, sortOrder: query.sortOrder };
}
