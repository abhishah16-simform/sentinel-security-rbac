import { Prisma, type SecurityAlertRule } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import { type ScopedTransaction, setTenantContext, setUserContext } from '../prisma/scoped-prisma';

/** 5 or more failed logins for one User within 15 minutes. */
export const FAILED_LOGIN_THRESHOLD = 5;
export const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** At least 50 denied Access Checks for one Application in one Tenant within 5 minutes. */
export const DENIED_CHECK_THRESHOLD = 50;
export const DENIED_CHECK_WINDOW_MS = 5 * 60 * 1000;

/** An Audit Log entry as just written, which the rules look at. */
export interface WrittenAuditEvent {
  readonly id: string;
  readonly tenantId: string | null;
  readonly eventType: AuditEventType;
  readonly actorUserId: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly applicationId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

interface Count {
  readonly count: number;
}

/**
 * Columns are timestamp without time zone holding UTC, while a Date parameter arrives as timestamptz.
 * Compared as is, Postgres converts through the session's TimeZone and the window slides by the
 * offset; converting the parameter to UTC first keeps the comparison right in any time zone.
 */
function utc(time: Date): Prisma.Sql {
  return Prisma.sql`(${time}::timestamptz AT TIME ZONE 'UTC')`;
}

interface MembershipTenant {
  readonly tenantId: string;
}

/**
 * The fixed Security Alert rules, run by AuditLog for every entry it writes, inside the writer's
 * transaction so an alert commits or rolls back with the entry that raised it. Raising an alert
 * writes no Audit Log entry of its own, so the rules never run on their own output.
 *
 * Tenant-chain and Access Check entries arrive with the transaction in that Tenant's context.
 * Failed logins are platform-chain entries and arrive with no Tenant context; their rule switches
 * the context to each Tenant it raises in. AuditLog restores the caller's context afterwards.
 */
export async function runSecurityAlertRules(tx: ScopedTransaction, event: WrittenAuditEvent): Promise<void> {
  switch (event.eventType) {
    case 'auth.login_failed':
    case 'auth.email_code_failed':
      return repeatedFailedLogins(tx, event);
    case 'auth.refresh_token_reused':
      return refreshTokenReused(tx, event);
    case 'access_check.denied':
      return deniedCheckSpike(tx, event);
    case 'membership.admin_granted':
    case 'membership.admin_revoked':
      return tenantAdminChanged(tx, event);
    default:
      return;
  }
}

/** A wrong password, or a wrong or unusable code while finishing an MFA login. */
function isFailedLogin(event: WrittenAuditEvent): boolean {
  return event.eventType === 'auth.login_failed' || event.payload['purpose'] === 'mfa-login';
}

/**
 * Raised in every Tenant where the User has a Membership, once per Tenant per 15 minutes however
 * many more failures follow. Failed logins join the platform chain, whose head row AuditLog locks,
 * so two failures never run this rule at the same time.
 */
async function repeatedFailedLogins(tx: ScopedTransaction, event: WrittenAuditEvent): Promise<void> {
  // A failed login for an email nobody uses names no User.
  if (event.tenantId !== null || event.targetType !== 'user' || event.targetId === null || !isFailedLogin(event)) return;
  const userId = event.targetId;
  const since = new Date(event.createdAt.getTime() - FAILED_LOGIN_WINDOW_MS);

  // The actor of every failed login and MFA code entry is the User; this uses the actor index.
  const [failures] = await tx.$queryRaw<Count[]>`
    SELECT count(*)::int AS count FROM audit_events
    WHERE "tenantId" IS NULL AND "actorUserId" = ${userId}::uuid AND "createdAt" > ${utc(since)}
      AND ("eventType" = 'auth.login_failed'
        OR ("eventType" = 'auth.email_code_failed' AND payload->>'purpose' = 'mfa-login'))`;
  const count = failures?.count ?? 0;
  if (count < FAILED_LOGIN_THRESHOLD) return;

  // The User's own Memberships in every Tenant, through the own_memberships policy.
  await setUserContext(tx, userId);
  const memberships = await tx.$queryRaw<MembershipTenant[]>`
    SELECT "tenantId" FROM memberships WHERE "userId" = ${userId}::uuid`;
  await setUserContext(tx, '');

  for (const { tenantId } of memberships) {
    await setTenantContext(tx, tenantId);
    const recent = await tx.securityAlert.findFirst({
      where: { tenantId, rule: 'REPEATED_FAILED_LOGINS', subjectUserId: userId, createdAt: { gt: since } },
      select: { id: true },
    });
    if (recent) continue;
    await raise(tx, event, tenantId, 'REPEATED_FAILED_LOGINS', {
      subjectUserId: userId,
      details: { failedLogins: count, windowMinutes: FAILED_LOGIN_WINDOW_MS / 60_000 },
    });
  }
}

/** Raised in the Tenant the reused token's login had chosen; none if it hadn't chosen one yet. */
async function refreshTokenReused(tx: ScopedTransaction, event: WrittenAuditEvent): Promise<void> {
  if (event.tenantId === null) return;
  await raise(tx, event, event.tenantId, 'REFRESH_TOKEN_REUSED', {
    subjectUserId: event.actorUserId,
    details: { sessionId: event.targetId },
  });
}

/**
 * Raised once the Application's denials in the Tenant reach 50 within 5 minutes, and then not again
 * until 5 minutes after that alert. Access Checks are written concurrently, so the final check and
 * the insert run under a transaction-scoped advisory lock per Tenant and Application.
 */
async function deniedCheckSpike(tx: ScopedTransaction, event: WrittenAuditEvent): Promise<void> {
  const { tenantId, applicationId } = event;
  if (tenantId === null || applicationId === null) return;
  const since = new Date(event.createdAt.getTime() - DENIED_CHECK_WINDOW_MS);
  const recentAlert = (): Promise<{ readonly id: string } | null> =>
    tx.securityAlert.findFirst({
      where: { tenantId, rule: 'ACCESS_CHECK_DENIALS_SPIKE', applicationId, createdAt: { gt: since } },
      select: { id: true },
    });

  // Most denials fall in a window that has already alerted, or nowhere near the threshold: both
  // answers are cheap. The event type is a literal so the partial index on denials applies.
  if (await recentAlert()) return;
  const [denials] = await tx.$queryRaw<Count[]>`
    SELECT count(*)::int AS count FROM audit_events
    WHERE "tenantId" = ${tenantId}::uuid AND "applicationId" = ${applicationId}::uuid
      AND "eventType" = 'access_check.denied' AND "createdAt" > ${utc(since)}`;
  const count = denials?.count ?? 0;
  if (count < DENIED_CHECK_THRESHOLD) return;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`denied-checks:${tenantId}:${applicationId}`}, 0))`;
  // Read again under the lock: another denial may have raised the alert and committed meanwhile.
  if (await recentAlert()) return;
  await raise(tx, event, tenantId, 'ACCESS_CHECK_DENIALS_SPIKE', {
    applicationId,
    details: { deniedChecks: count, windowMinutes: DENIED_CHECK_WINDOW_MS / 60_000 },
  });
}

/** Raised for every change of the flag, naming the member and the Tenant Admin who changed it. */
async function tenantAdminChanged(tx: ScopedTransaction, event: WrittenAuditEvent): Promise<void> {
  if (event.tenantId === null) return;
  await raise(tx, event, event.tenantId, 'TENANT_ADMIN_CHANGED', {
    subjectUserId: event.targetType === 'user' ? event.targetId : null,
    actorUserId: event.actorUserId,
    details: { granted: event.eventType === 'membership.admin_granted' },
  });
}

interface AlertFields {
  readonly subjectUserId?: string | null;
  readonly actorUserId?: string | null;
  readonly applicationId?: string;
  readonly details: Prisma.InputJsonObject;
}

/** Inserts the alert; the transaction must be in the Tenant's context. */
async function raise(
  tx: ScopedTransaction,
  event: WrittenAuditEvent,
  tenantId: string,
  rule: SecurityAlertRule,
  fields: AlertFields,
): Promise<void> {
  await tx.securityAlert.create({
    data: {
      tenantId,
      rule,
      auditEventId: event.id,
      subjectUserId: fields.subjectUserId ?? null,
      actorUserId: fields.actorUserId ?? null,
      applicationId: fields.applicationId ?? null,
      details: fields.details,
    },
  });
}
