import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from '../../common/pagination';

export const SECURITY_ALERT_STATUSES = ['open', 'acknowledged'] as const;
export type SecurityAlertStatusLabel = (typeof SECURITY_ALERT_STATUSES)[number];

export const SECURITY_ALERT_RULES = [
  'repeated-failed-logins',
  'refresh-token-reused',
  'access-check-denials-spike',
  'tenant-admin-changed',
] as const;
export type SecurityAlertRuleLabel = (typeof SECURITY_ALERT_RULES)[number];

export class SecurityAlertListQuery extends PageQuery {
  /** open or acknowledged; omit for both. */
  @IsOptional()
  @IsIn(SECURITY_ALERT_STATUSES)
  status?: SecurityAlertStatusLabel;

  /** Only alerts raised by this rule. */
  @IsOptional()
  @IsIn(SECURITY_ALERT_RULES)
  rule?: SecurityAlertRuleLabel;
}
