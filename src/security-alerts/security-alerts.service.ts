import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, SecurityAlertRule } from '@prisma/client';
import { AuditLog } from '../audit/audit-log.service';
import { type Page, pageWindow, toPage } from '../common/pagination';
import { ScopedPrisma } from '../prisma/scoped-prisma';
import type { SecurityAlertListQuery, SecurityAlertRuleLabel, SecurityAlertStatusLabel } from './dto/security-alert.dto';

interface AlertUser {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface SecurityAlertView {
  readonly id: string;
  readonly rule: SecurityAlertRuleLabel;
  readonly status: SecurityAlertStatusLabel;
  /** The User it is about; null once that User is gone, or for a spike of denied Access Checks. */
  readonly subject: AlertUser | null;
  /** The Tenant Admin who changed the flag; null for the other rules. */
  readonly actor: AlertUser | null;
  /** The Application whose Access Checks were denied; null for the other rules. */
  readonly application: { readonly id: string; readonly name: string } | null;
  /** Rule-specific facts, such as failedLogins, deniedChecks, windowMinutes or granted. */
  readonly details: Prisma.JsonValue;
  readonly createdAt: Date;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedByName: string | null;
}

/** Each stored rule's API label: the one map between them. */
const RULE_LABELS = {
  REPEATED_FAILED_LOGINS: 'repeated-failed-logins',
  REFRESH_TOKEN_REUSED: 'refresh-token-reused',
  ACCESS_CHECK_DENIALS_SPIKE: 'access-check-denials-spike',
  TENANT_ADMIN_CHANGED: 'tenant-admin-changed',
} as const satisfies Record<SecurityAlertRule, SecurityAlertRuleLabel>;

/** The reverse of RULE_LABELS, for the rule filter. */
const RULES_BY_LABEL = {
  'repeated-failed-logins': 'REPEATED_FAILED_LOGINS',
  'refresh-token-reused': 'REFRESH_TOKEN_REUSED',
  'access-check-denials-spike': 'ACCESS_CHECK_DENIALS_SPIKE',
  'tenant-admin-changed': 'TENANT_ADMIN_CHANGED',
} as const satisfies Record<SecurityAlertRuleLabel, SecurityAlertRule>;

const USER_NAME = { select: { id: true, email: true, firstName: true, lastName: true } } as const;

const ALERT_INCLUDE = {
  subjectUser: USER_NAME,
  actorUser: USER_NAME,
  acknowledgedBy: USER_NAME,
  application: { select: { id: true, name: true } },
} as const satisfies Prisma.SecurityAlertInclude;

type AlertRow = Prisma.SecurityAlertGetPayload<{ include: typeof ALERT_INCLUDE }>;

interface UserName {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

function displayName(user: UserName): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

function alertUser(user: UserName | null): AlertUser | null {
  return user ? { userId: user.id, email: user.email, name: displayName(user) } : null;
}

function toView(row: AlertRow): SecurityAlertView {
  return {
    id: row.id,
    rule: RULE_LABELS[row.rule],
    status: row.acknowledgedAt === null ? 'open' : 'acknowledged',
    subject: alertUser(row.subjectUser),
    actor: alertUser(row.actorUser),
    application: row.application,
    details: row.details,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedByName: row.acknowledgedBy ? displayName(row.acknowledgedBy) : null,
  };
}

/** The Active Tenant's Security Alerts, for its Tenant Admins. The rules raise them; see security-alert-rules. */
@Injectable()
export class SecurityAlertsService {
  constructor(
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  /** Newest first; filter by status and rule. */
  list(tenantId: string, query: SecurityAlertListQuery): Promise<Page<SecurityAlertView>> {
    const window = pageWindow(query, 'desc');
    const where: Prisma.SecurityAlertWhereInput = {
      tenantId,
      ...(query.status === undefined ? {} : { acknowledgedAt: query.status === 'open' ? null : { not: null } }),
      ...(query.rule === undefined ? {} : { rule: RULES_BY_LABEL[query.rule] }),
      ...window.after,
    };
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.securityAlert.findMany({ where, include: ALERT_INCLUDE, orderBy: window.orderBy, take: window.take });
      return toPage(rows, window, toView);
    });
  }

  /** Marks the alert as dealt with. Each alert is acknowledged once; a second attempt is a conflict. */
  acknowledge(tenantId: string, userId: string, alertId: string): Promise<SecurityAlertView> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      const { count } = await tx.securityAlert.updateMany({
        where: { id: alertId, tenantId, acknowledgedAt: null },
        data: { acknowledgedAt: new Date(), acknowledgedByUserId: userId },
      });
      const row = await tx.securityAlert.findFirst({ where: { id: alertId, tenantId }, include: ALERT_INCLUDE });
      if (!row) throw new NotFoundException('Security Alert not found');
      if (count === 0) throw new ConflictException('This Security Alert has already been acknowledged.');
      await this.audit.recordIn(tx, {
        tenantId,
        eventType: 'security_alert.acknowledged',
        actorUserId: userId,
        target: { type: 'security_alert', id: alertId },
        payload: { rule: RULE_LABELS[row.rule] },
      });
      return toView(row);
    });
  }
}
