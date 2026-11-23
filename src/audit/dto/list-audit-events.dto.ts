import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQuery } from '../../common/pagination';
import { AUDIT_EVENT_TYPE_NAMES } from '../audit-event-types';

/** Query string of GET /v1/audit-events. Every filter is optional and they combine with AND. */
export class ListAuditEventsQuery extends PageQuery {
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
}
