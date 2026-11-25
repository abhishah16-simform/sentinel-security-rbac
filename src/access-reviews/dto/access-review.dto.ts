import { IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { PageQuery } from '../../common/pagination';

export const ACCESS_REVIEW_STATUSES = ['open', 'closed'] as const;
export type AccessReviewStatusLabel = (typeof ACCESS_REVIEW_STATUSES)[number];

/** An item's result; pending until a Tenant Admin decides it or the due date passes. */
export const REVIEW_ITEM_OUTCOMES = ['pending', 'certified', 'revoked', 'auto-revoked'] as const;
export type ReviewItemOutcomeLabel = (typeof REVIEW_ITEM_OUTCOMES)[number];

export class StartAccessReviewDto {
  /** An Application the Active Tenant has enabled. */
  @IsUUID()
  applicationId!: string;

  /** When decisions stop and undecided items are revoked, with a time zone; in the future, within a year. */
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/, { message: 'dueAt must include a time zone (Z or ±hh:mm)' })
  dueAt!: string;
}

export class AccessReviewListQuery extends PageQuery {
  /** open or closed; omit for both. */
  @IsOptional()
  @IsIn(ACCESS_REVIEW_STATUSES)
  status?: AccessReviewStatusLabel;

  /** Only reviews of this Application. */
  @IsOptional()
  @IsUUID()
  applicationId?: string;
}

export class ReviewItemListQuery extends PageQuery {
  /** pending, certified, revoked or auto-revoked; omit for all. */
  @IsOptional()
  @IsIn(REVIEW_ITEM_OUTCOMES)
  outcome?: ReviewItemOutcomeLabel;
}
