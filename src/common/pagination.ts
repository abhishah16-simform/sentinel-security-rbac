import { BadRequestException } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query parameters every paginated list endpoint accepts. */
export class PageQuery {
  /** The nextCursor of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  /** Page size, 1 to 200 (default 50). */
  @IsOptional()
  @Matches(/^\d{1,3}$/, { message: 'limit must be a whole number' })
  limit?: string;
}

/** One page of a list, newest or oldest first as the endpoint documents. */
export interface Page<T> {
  readonly items: readonly T[];
  /** Pass as cursor to get the next page; null on the last page. */
  readonly nextCursor: string | null;
}

/** A row's position in a list ordered by (createdAt, id). */
export interface PageCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/** A row's position in a list ordered by some other time column, then id. */
export interface TimeCursor {
  readonly time: Date;
  readonly id: string;
}

export function encodeTimeCursor(position: TimeCursor): string {
  return Buffer.from(`${position.time.toISOString()}|${position.id}`).toString('base64url');
}

export function decodeTimeCursor(cursor: string): TimeCursor {
  const [text, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const time = new Date(text ?? '');
  if (!id || !UUID_PATTERN.test(id) || Number.isNaN(time.getTime())) {
    throw new BadRequestException('cursor is not valid');
  }
  return { time, id };
}

export function encodeCursor(row: PageCursor): string {
  return encodeTimeCursor({ time: row.createdAt, id: row.id });
}

export function decodeCursor(cursor: string): PageCursor {
  const { time, id } = decodeTimeCursor(cursor);
  return { createdAt: time, id };
}

export function pageSize(limit: string | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  const size = Number(limit);
  if (size < 1 || size > MAX_PAGE_SIZE) throw new BadRequestException(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  return size;
}

/** A keyset window for one page of rows ordered by (createdAt, id) in the given direction. */
export interface PageWindow {
  /** Rows to fetch: one more than the page, to tell whether another page follows. */
  readonly take: number;
  readonly limit: number;
  /** A where condition for rows after the cursor; empty on the first page. */
  readonly after: { OR?: [{ createdAt: { lt?: Date; gt?: Date } }, { createdAt: Date; id: { lt?: string; gt?: string } }] };
  readonly orderBy: [{ createdAt: 'asc' | 'desc' }, { id: 'asc' | 'desc' }];
}

export function pageWindow(query: PageQuery, direction: 'asc' | 'desc'): PageWindow {
  const limit = pageSize(query.limit);
  const orderBy: PageWindow['orderBy'] = [{ createdAt: direction }, { id: direction }];
  if (query.cursor === undefined) return { take: limit + 1, limit, after: {}, orderBy };
  const cursor = decodeCursor(query.cursor);
  const beyond = direction === 'desc' ? 'lt' : 'gt';
  return {
    take: limit + 1,
    limit,
    after: { OR: [{ createdAt: { [beyond]: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { [beyond]: cursor.id } }] },
    orderBy,
  };
}

/** Turns the rows fetched for a window into a page. */
export function toPage<R extends PageCursor, T>(rows: readonly R[], window: PageWindow, view: (row: R) => T): Page<T> {
  const page = rows.slice(0, window.limit);
  const last = page.at(-1);
  return { items: page.map(view), nextCursor: rows.length > window.limit && last ? encodeCursor(last) : null };
}
