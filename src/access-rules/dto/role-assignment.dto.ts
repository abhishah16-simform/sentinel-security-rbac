import { IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { PageQuery } from '../../common/pagination';

export const ROLE_ASSIGNMENT_STATUSES = ['active', 'expired', 'revoked'] as const;
export type RoleAssignmentStatus = (typeof ROLE_ASSIGNMENT_STATUSES)[number];

export class CreateRoleAssignmentDto {
  /** A Membership of the Active Tenant. */
  @IsUUID()
  membershipId!: string;

  /** One of the Tenant's Roles, in an Application it has enabled. */
  @IsUUID()
  roleId!: string;

  /** When the assignment stops giving access, with a time zone; omit or null for a permanent one. */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/, { message: 'expiresAt must include a time zone (Z or ±hh:mm)' })
  expiresAt?: string | null;
}

export class RoleAssignmentListQuery extends PageQuery {
  /** Only this Membership's assignments. */
  @IsOptional()
  @IsUUID()
  membershipId?: string;

  /** Only assignments of this Role. */
  @IsOptional()
  @IsUUID()
  roleId?: string;

  /** Only assignments for this Application. */
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  /** active (gives access now), expired or revoked; omit for all. */
  @IsOptional()
  @IsIn(ROLE_ASSIGNMENT_STATUSES)
  status?: RoleAssignmentStatus;
}

export class ExpiringReportQuery extends PageQuery {
  /** The look-ahead window in whole days, 1 to 365 (default 7). */
  @IsOptional()
  @Matches(/^\d{1,6}$/, { message: 'withinDays must be a whole number' })
  withinDays?: string;
}
