import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AUDIT_EVENT_TYPE_NAMES } from '../audit-event-types';

/** Query string of GET /v1/audit-events. Every filter is optional and they combine with AND. */
export class ListAuditEventsQuery {
  /** Entries at or after this instant. */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Entries before this instant (exclusive). */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  /** A User ID or email address: entries the User performed or that were about them. */
  @IsOptional()
  @IsString()
  @MaxLength(320)
  user?: string;

  @IsOptional()
  @IsIn(AUDIT_EVENT_TYPE_NAMES)
  eventType?: string;

  @IsOptional()
  @IsUUID()
  applicationId?: string;

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
