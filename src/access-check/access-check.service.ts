import { BadRequestException, Injectable } from '@nestjs/common';
import { activeAssignmentWhere } from '../access-rules/role-assignment-ending';
import { type AccessTokenClaims, AccessTokenService } from '../access-token/access-token.service';
import type { ApplicationSummary } from '../applications/applications.service';
import { loadSchemaIndex } from '../applications/schema-index';
import { AuditLog } from '../audit/audit-log.service';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import { type EngineDecision, type EnginePermission, evaluateAccess } from './access-check-engine';

/** Why an Access Check was denied before the engine ran. */
export type GateReason = 'tenant-suspended' | 'application-not-enabled' | 'no-membership';

export type AccessCheckReason = EngineDecision['reason'] | GateReason;

/** The answer an Application gets. roleId and permissionId name the Permission that decided it. */
export interface AccessCheckResult {
  readonly allowed: boolean;
  readonly reason: AccessCheckReason;
  readonly roleId?: string;
  readonly permissionId?: string;
}

export interface AccessCheckInput {
  readonly accessToken: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resource?: {
    readonly id?: string;
    readonly attributes?: Readonly<Record<string, unknown>>;
  };
}

/** The User the check is about, from a verified access token that carries an Active Tenant. */
interface CheckSubject {
  readonly userId: string;
  readonly tenantId: string;
  readonly membershipId: string;
}

function subjectOf(claims: AccessTokenClaims): CheckSubject {
  if (claims.tid === undefined || claims.mid === undefined) {
    throw new BadRequestException('The access token has no Active Tenant; the User must choose one first');
  }
  return { userId: claims.sub, tenantId: claims.tid, membershipId: claims.mid };
}

function denied(reason: GateReason): AccessCheckResult {
  return { allowed: false, reason };
}

function toResult(decision: EngineDecision): AccessCheckResult {
  if (decision.reason === 'no-matching-permission') return { allowed: false, reason: decision.reason };
  return { allowed: decision.allowed, reason: decision.reason, roleId: decision.roleId, permissionId: decision.permissionId };
}

/**
 * The Access Check API: answers whether a User may perform an Action on a resource of one
 * Application. Authentication of the Application happens before this (ClientCredentialsGuard); then
 * the User's token is verified, and inside the Tenant the Tenant, Enablement and Membership are
 * checked in that order, the active Permissions loaded, the engine run and the Audit Log entry
 * written. Every read is fresh from Postgres (ADR 0002), so a revoked or expired Role Assignment, a
 * disabled Application or a removed Membership stops giving access at once.
 */
@Injectable()
export class AccessCheckService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  async check(application: ApplicationSummary, input: AccessCheckInput): Promise<AccessCheckResult> {
    const subject = subjectOf(await this.accessTokens.verify(input.accessToken));
    return this.scoped.inTenant(subject.tenantId, async (tx) => {
      // A client error, not a deny: the Application asked about something it never declared.
      (await loadSchemaIndex(tx, application.id)).assertKnown(input.resourceType, input.action);
      const result = await this.decide(tx, application, subject, input);
      await this.record(tx, application, subject, input, result);
      return result;
    });
  }

  private async decide(
    tx: ScopedTransaction,
    application: ApplicationSummary,
    subject: CheckSubject,
    input: AccessCheckInput,
  ): Promise<AccessCheckResult> {
    // One instant for the whole check: a Temporary Role Assignment counts only while it is before it.
    const now = new Date();
    const { tenantId, membershipId, userId } = subject;

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { suspendedAt: true } });
    if (!tenant) return denied('no-membership');
    if (tenant.suspendedAt !== null) return denied('tenant-suspended');

    const enablement = await tx.enablement.findUnique({
      where: { tenantId_applicationId: { tenantId, applicationId: application.id } },
      select: { disabledAt: true },
    });
    if (!enablement || enablement.disabledAt !== null) return denied('application-not-enabled');

    const membership = await tx.membership.findFirst({ where: { id: membershipId, tenantId, userId }, select: { id: true } });
    if (!membership) return denied('no-membership');

    const assignments = await tx.roleAssignment.findMany({
      where: { tenantId, membershipId, applicationId: application.id, ...activeAssignmentWhere(now) },
      select: {
        role: {
          select: {
            id: true,
            permissions: {
              where: { action: input.action, resourceType: input.resourceType },
              select: { id: true, action: true, resourceType: true, inverted: true, conditions: true },
            },
          },
        },
      },
    });
    const permissions: EnginePermission[] = assignments.flatMap(({ role }) =>
      role ? role.permissions.map((permission) => ({ ...permission, roleId: role.id })) : [],
    );

    const decision = evaluateAccess(
      permissions,
      { userId, membershipId, tenantId },
      { action: input.action, resourceType: input.resourceType, attributes: input.resource?.attributes ?? {} },
    );
    return toResult(decision);
  }

  /**
   * Every Access Check goes in the Tenant's Audit Log, unchained and without the chain lock. The
   * resource's attributes are left out: they are the Application's data, and can be large.
   */
  private record(
    tx: ScopedTransaction,
    application: ApplicationSummary,
    subject: CheckSubject,
    input: AccessCheckInput,
    result: AccessCheckResult,
  ): Promise<void> {
    const resourceId = input.resource?.id ?? null;
    return this.audit.recordUnchainedIn(tx, {
      tenantId: subject.tenantId,
      eventType: result.allowed ? 'access_check.allowed' : 'access_check.denied',
      actorUserId: subject.userId,
      target: resourceId === null ? undefined : { type: 'resource', id: resourceId },
      applicationId: application.id,
      payload: {
        membershipId: subject.membershipId,
        application: application.name,
        action: input.action,
        resourceType: input.resourceType,
        resourceId,
        allowed: result.allowed,
        reason: result.reason,
        roleId: result.roleId ?? null,
        permissionId: result.permissionId ?? null,
      },
    });
  }
}
