import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { activeAssignmentWhere } from '../access-rules/role-assignment-ending';
import { type AccessTokenClaims, AccessTokenService } from '../access-token/access-token.service';
import type { ApplicationSummary } from '../applications/applications.service';
import { loadSchemaIndex } from '../applications/schema-index';
import { AuditLog } from '../audit/audit-log.service';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import { type EngineContext, type EnginePermission, type EngineVerdict, evaluateAccess } from './access-check-engine';

/** Why an Access Check was denied before the engine ran. */
export type GateReason = 'tenant-suspended' | 'application-not-enabled' | 'no-membership';

export type AccessCheckReason = EngineVerdict['reason'] | GateReason;

/** The answer an Application gets. roleId and permissionId name the Permission that decided it. */
export interface AccessCheckResult {
  readonly allowed: boolean;
  readonly reason: AccessCheckReason;
  readonly roleId?: string;
  readonly permissionId?: string;
}

/** What is asked: an Action on a resource of a Resource Type. */
export interface AccessQuestion {
  readonly action: string;
  readonly resourceType: string;
  readonly resource?: {
    readonly id?: string;
    readonly attributes?: Readonly<Record<string, unknown>>;
  };
}

export interface AccessCheckInput extends AccessQuestion {
  readonly accessToken: string;
}

/** A Tenant Admin's test: the question asked for one of the Tenant's Memberships in one Application. */
export interface TestAccessInput extends AccessQuestion {
  readonly membershipId: string;
  readonly applicationId: string;
}

/** The User the check is about, from a verified access token that carries an Active Tenant. */
function askerOf(claims: AccessTokenClaims): EngineContext {
  if (claims.tid === undefined || claims.mid === undefined) {
    throw new BadRequestException('The access token has no Active Tenant; the User must choose one first');
  }
  return { userId: claims.sub, tenantId: claims.tid, membershipId: claims.mid };
}

function denied(reason: GateReason): AccessCheckResult {
  return { allowed: false, reason };
}

function toResult(verdict: EngineVerdict): AccessCheckResult {
  if (verdict.reason === 'no-matching-permission') return { allowed: false, reason: verdict.reason };
  return { allowed: verdict.allowed, reason: verdict.reason, roleId: verdict.roleId, permissionId: verdict.permissionId };
}

/** What an Access Check would answer for many Memberships: why all are denied, if one gate does, and each answer. */
export interface ManyAnswers {
  /** The Tenant or Enablement gate that denies every check, or null. */
  readonly deniedBecause: GateReason | null;
  /** Each Membership's answers, keyed by membershipId, in the order of the Actions asked. */
  readonly answers: ReadonlyMap<string, readonly AccessCheckResult[]>;
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
    const asker = askerOf(await this.accessTokens.verify(input.accessToken));
    return this.scoped.inTenant(asker.tenantId, async (tx) => {
      // A client error, not a deny: the Application asked about something it never declared.
      (await loadSchemaIndex(tx, application.id)).assertKnown(input.resourceType, input.action);
      const result = await this.answer(tx, application.id, asker, input);
      await this.record(tx, application, asker, input, result);
      return result;
    });
  }

  /**
   * A Tenant Admin's test of what an Access Check would answer for one of the Tenant's Memberships:
   * the same gates and engine, without the Application's client secret. It isn't an Access Check, so
   * it isn't written to the Audit Log and never counts towards denied-Access-Check alerts.
   */
  async test(tenantId: string, input: TestAccessInput): Promise<AccessCheckResult> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: input.membershipId, tenantId },
        select: { id: true, userId: true },
      });
      if (!membership) throw new NotFoundException('Membership not found');
      const application = await tx.application.findUnique({ where: { id: input.applicationId }, select: { id: true } });
      if (!application) throw new NotFoundException('Application not found');
      (await loadSchemaIndex(tx, application.id)).assertKnown(input.resourceType, input.action);
      return this.answer(tx, application.id, { userId: membership.userId, membershipId: membership.id, tenantId }, input);
    });
  }

  /**
   * What an Access Check would answer at `now` for each of several Memberships of one Tenant (each asker's
   * tenantId must be it), for each of several Actions on one resource: the same gates and engine, with one read of the Tenant, the
   * Enablement and the active Permissions for all of them. The caller passes Memberships it has just
   * read in the same transaction, so the no-membership gate isn't checked again.
   */
  async answerMany(
    tx: ScopedTransaction,
    now: Date,
    tenantId: string,
    applicationId: string,
    askers: readonly EngineContext[],
    question: {
      readonly resourceType: string;
      readonly actions: readonly string[];
      readonly attributes: Readonly<Record<string, unknown>>;
    },
  ): Promise<ManyAnswers> {
    const answers = new Map<string, readonly AccessCheckResult[]>();
    const deniedBecause = await this.gate(tx, tenantId, applicationId);
    const permissions = deniedBecause
      ? new Map<string, EnginePermission[]>()
      : await this.activePermissions(tx, now, tenantId, applicationId, askers.map((asker) => asker.membershipId), {
          resourceType: question.resourceType,
          actions: question.actions,
        });
    for (const asker of askers) {
      const held = permissions.get(asker.membershipId) ?? [];
      answers.set(
        asker.membershipId,
        question.actions.map((action) =>
          deniedBecause
            ? denied(deniedBecause)
            : toResult(evaluateAccess(held, asker, { action, resourceType: question.resourceType, attributes: question.attributes })),
        ),
      );
    }
    return { deniedBecause, answers };
  }

  private async answer(
    tx: ScopedTransaction,
    applicationId: string,
    asker: EngineContext,
    input: AccessQuestion,
  ): Promise<AccessCheckResult> {
    // One instant for the whole check: a Temporary Role Assignment counts only while it is before it.
    const now = new Date();
    const { tenantId, membershipId, userId } = asker;

    const gate = await this.gate(tx, tenantId, applicationId);
    if (gate) return denied(gate);

    const membership = await tx.membership.findFirst({ where: { id: membershipId, tenantId, userId }, select: { id: true } });
    if (!membership) return denied('no-membership');

    const permissions = await this.activePermissions(tx, now, tenantId, applicationId, [membershipId], {
      resourceType: input.resourceType,
      actions: [input.action],
    });
    const verdict = evaluateAccess(
      permissions.get(membershipId) ?? [],
      asker,
      { action: input.action, resourceType: input.resourceType, attributes: input.resource?.attributes ?? {} },
    );
    return toResult(verdict);
  }

  /** The Tenant and Enablement gates, in that order: why every check would be denied, or null. */
  private async gate(tx: ScopedTransaction, tenantId: string, applicationId: string): Promise<GateReason | null> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { suspendedAt: true } });
    // Tenants are never deleted, but a token naming one that doesn't exist has no Membership in it.
    if (!tenant) return 'no-membership';
    if (tenant.suspendedAt !== null) return 'tenant-suspended';

    const enablement = await tx.enablement.findUnique({
      where: { tenantId_applicationId: { tenantId, applicationId } },
      select: { disabledAt: true },
    });
    if (!enablement || enablement.disabledAt !== null) return 'application-not-enabled';
    return null;
  }

  /**
   * The Permissions on one Resource Type (and only the given Actions) that each Membership holds
   * through its active Role Assignments in one Application at `now`, keyed by membershipId.
   */
  private async activePermissions(
    tx: ScopedTransaction,
    now: Date,
    tenantId: string,
    applicationId: string,
    membershipIds: readonly string[],
    on: { readonly resourceType: string; readonly actions: readonly string[] },
  ): Promise<ReadonlyMap<string, EnginePermission[]>> {
    const assignments = await tx.roleAssignment.findMany({
      where: { tenantId, membershipId: { in: [...membershipIds] }, applicationId, ...activeAssignmentWhere(now) },
      select: {
        membershipId: true,
        role: {
          select: {
            id: true,
            permissions: {
              where: { action: { in: [...on.actions] }, resourceType: on.resourceType },
              select: { id: true, action: true, resourceType: true, inverted: true, conditions: true },
            },
          },
        },
      },
    });
    const byMembership = new Map<string, EnginePermission[]>();
    for (const { membershipId, role } of assignments) {
      if (!membershipId || !role) continue;
      const held = byMembership.get(membershipId) ?? [];
      held.push(...role.permissions.map((permission) => ({ ...permission, roleId: role.id })));
      byMembership.set(membershipId, held);
    }
    return byMembership;
  }

  /**
   * Every Access Check goes in the Tenant's Audit Log, unchained and without the chain lock. The
   * resource's attributes are left out: they are the Application's data, and can be large.
   */
  private record(
    tx: ScopedTransaction,
    application: ApplicationSummary,
    asker: EngineContext,
    input: AccessCheckInput,
    result: AccessCheckResult,
  ): Promise<void> {
    const resourceId = input.resource?.id ?? null;
    return this.audit.recordUnchainedIn(tx, {
      tenantId: asker.tenantId,
      eventType: result.allowed ? 'access_check.allowed' : 'access_check.denied',
      actorUserId: asker.userId,
      target: resourceId === null ? undefined : { type: 'resource', id: resourceId },
      applicationId: application.id,
      payload: {
        membershipId: asker.membershipId,
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
