import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Unit } from '../../units/entities/unit.entity.js';
import { Paginated } from '../pagination/pagination.utils.js';

export interface UnitSummary {
  id: string;
  unitNumber: string;
  propertyId: string;
}

type UnitCarrier = { unitId: string; unit?: unknown };

@Injectable()
export class UnitSummaryInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        await this.attach(result);
        return result;
      }),
    );
  }

  private async attach(result: unknown): Promise<void> {
    const carriers = this.collect(result);
    if (!carriers.length) return;

    const summaries = new Map<string, UnitSummary>();
    const missing = new Set<string>();

    for (const item of carriers) {
      const loaded = this.fromLoadedUnit(item);

      if (loaded) {
        summaries.set(item.unitId, loaded);
      } else {
        missing.add(item.unitId);
      }
    }

    const toFetch = [...missing].filter((id) => !summaries.has(id));

    if (toFetch.length) {
      const units = await this.dataSource.getRepository(Unit).find({
        select: { id: true, unitNumber: true, propertyId: true },
        where: { id: In(toFetch) },
      });

      for (const unit of units) {
        summaries.set(unit.id, {
          id: unit.id,
          unitNumber: unit.unitNumber,
          propertyId: unit.propertyId,
        });
      }
    }

    for (const item of carriers) {
      const summary = summaries.get(item.unitId);
      if (summary) item.unit = summary;
    }
  }

  private collect(result: unknown): UnitCarrier[] {
    const items: unknown[] =
      result instanceof Paginated
        ? (result.data as unknown[])
        : Array.isArray(result)
          ? result
          : [result];

    return items.filter(
      (item): item is UnitCarrier =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { unitId?: unknown }).unitId === 'string',
    );
  }

  private fromLoadedUnit(item: UnitCarrier): UnitSummary | null {
    const unit = item.unit as Partial<UnitSummary> | null | undefined;

    if (
      unit &&
      typeof unit.id === 'string' &&
      typeof unit.unitNumber === 'string' &&
      typeof unit.propertyId === 'string'
    ) {
      return {
        id: unit.id,
        unitNumber: unit.unitNumber,
        propertyId: unit.propertyId,
      };
    }

    return null;
  }
}
