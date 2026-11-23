import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, RefreshChain } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import { type AuditEventInput, AuditLog, type AuditPayload } from '../audit/audit-log.service';
import { generateOpaqueToken, hashOpaqueToken } from '../common/opaque-token';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';

export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A chain's Active Tenant, or null unless both the Tenant and the Membership are set. */
function activeTenantOf(chain: RefreshChain): ActiveTenantRef | null {
  return chain.activeTenantId !== null && chain.activeMembershipId !== null
    ? { tenantId: chain.activeTenantId, membershipId: chain.activeMembershipId }
    : null;
}

/** An Audit Log entry about one login (refresh chain), acted on by its User. */
function sessionEvent(
  chain: Pick<RefreshChain, 'id' | 'userId'>,
  tenantId: string | null,
  eventType: AuditEventType,
  payload?: AuditPayload,
): AuditEventInput {
  return { tenantId, eventType, actorUserId: chain.userId, target: { type: 'session', id: chain.id }, payload };
}

export interface IssuedRefreshToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export type RotationResult =
  | {
      readonly kind: 'rotated';
      readonly userId: string;
      /** The login's Active Tenant after this rotation; null until one is chosen. */
      readonly activeTenant: ActiveTenantRef | null;
      readonly next: IssuedRefreshToken;
    }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'reused'; readonly userId: string; readonly chainId: string };

/**
 * Opaque refresh tokens grouped into chains, one chain per login. Each token works once and
 * is replaced on use. Presenting a token that was already used revokes its whole chain.
 * Every change is recorded in the Audit Log in the same transaction: in the chain's Active
 * Tenant's chain when it has one, otherwise in the platform chain.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Starts a new chain for a completed login inside the caller's transaction and returns its first
   * token. Records the login, noting whether an MFA code was checked.
   */
  async startChainIn(
    tx: ScopedTransaction,
    userId: string,
    { mfa }: { readonly mfa: boolean },
  ): Promise<IssuedRefreshToken> {
    const chain = await tx.refreshChain.create({ data: { userId } });
    await this.audit.recordIn(tx, sessionEvent(chain, null, 'auth.login_succeeded', { mfa }));
    return this.issueInChain(tx, chain.id);
  }

  /**
   * The User a refresh token belongs to, if the token is usable right now (unused, unexpired,
   * chain not revoked), without using it. Null otherwise; callers must then still call rotate()
   * so that a reused token revokes its chain.
   */
  async ownerOfUsable(token: string): Promise<string | null> {
    const found = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: hashOpaqueToken(token), usedAt: null, expiresAt: { gt: new Date() }, chain: { revokedAt: null } },
      select: { chain: { select: { userId: true } } },
    });
    return found?.chain.userId ?? null;
  }

  /**
   * Uses a refresh token once, returning its replacement in the same chain, or revokes the chain
   * if the token was already used. With switchTo, the login's Active Tenant changes as well.
   */
  async rotate(token: string, switchTo?: ActiveTenantRef): Promise<RotationResult> {
    const tokenHash = hashOpaqueToken(token);
    const result = await this.prisma.$transaction(async (tx): Promise<RotationResult> => {
      const tokenChain = await tx.refreshToken.findUnique({ where: { tokenHash }, select: { chainId: true } });
      if (!tokenChain) return { kind: 'rejected' };

      // Lock the chain so rotation, reuse detection and logout of one login are serialized.
      await tx.$executeRaw`SELECT 1 FROM refresh_chains WHERE id = ${tokenChain.chainId}::uuid FOR UPDATE`;
      const chain = await tx.refreshChain.findUnique({ where: { id: tokenChain.chainId } });
      // Re-read the token now that the chain is locked, so its state can't change under us.
      const current = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!chain || !current || chain.revokedAt !== null) return { kind: 'rejected' };

      const now = new Date();
      if (current.usedAt !== null) {
        await this.revokeChains(tx, { id: chain.id }, now);
        await this.audit.recordIn(tx, sessionEvent(chain, chain.activeTenantId, 'auth.refresh_token_reused'));
        return { kind: 'reused', userId: chain.userId, chainId: chain.id };
      }
      if (current.expiresAt <= now) return { kind: 'rejected' };

      await tx.refreshToken.update({ where: { id: current.id }, data: { usedAt: now } });
      const activeTenant = switchTo ?? activeTenantOf(chain);
      const changed =
        chain.activeTenantId !== (activeTenant?.tenantId ?? null) ||
        chain.activeMembershipId !== (activeTenant?.membershipId ?? null);
      if (changed) {
        // Switching, or clearing a Tenant whose Membership was deleted (the FK nulled only the Membership).
        await tx.refreshChain.update({
          where: { id: chain.id },
          data: { activeTenantId: activeTenant?.tenantId ?? null, activeMembershipId: activeTenant?.membershipId ?? null },
        });
      }
      // A routine refresh isn't recorded: pages refresh every few minutes, which buried real events.
      // Logins, Tenant switches, logouts and reused tokens (above) still are.
      if (switchTo) {
        await this.audit.recordIn(
          tx,
          sessionEvent(chain, switchTo.tenantId, 'tenant.switched', {
            membershipId: switchTo.membershipId,
            fromTenantId: chain.activeTenantId,
          }),
        );
      }
      return { kind: 'rotated', userId: chain.userId, activeTenant, next: await this.issueInChain(tx, chain.id) };
    });

    if (result.kind === 'reused') {
      this.logger.warn(`Refresh token reuse detected; revoked chain ${result.chainId} of user ${result.userId}`);
    }
    return result;
  }

  /**
   * Revokes the chain the given token belongs to (log out on this device). Unknown tokens and
   * chains that are already revoked are ignored.
   */
  async revokeChainOf(token: string): Promise<void> {
    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      select: { chain: { select: { id: true, userId: true, activeTenantId: true } } },
    });
    if (!found) return;
    const { chain } = found;
    await this.prisma.$transaction(async (tx) => {
      if ((await this.revokeChains(tx, { id: chain.id }, new Date())) === 0) return;
      await this.audit.recordIn(tx, sessionEvent(chain, chain.activeTenantId, 'auth.logged_out'));
    });
  }

  /**
   * Revokes every chain the User holds inside the caller's transaction, without an audit entry of
   * its own (the caller records why). Returns how many were still live.
   */
  revokeAllIn(tx: ScopedTransaction, userId: string): Promise<number> {
    return this.revokeChains(tx, { userId }, new Date());
  }

  /** Revokes every chain the User holds (log out everywhere). Recorded in the platform chain. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const revoked = await this.revokeAllIn(tx, userId);
      await this.audit.recordIn(tx, {
        tenantId: null,
        eventType: 'auth.logged_out_everywhere',
        actorUserId: userId,
        target: { type: 'user', id: userId },
        payload: { revokedSessions: revoked },
      });
    });
  }

  private async issueInChain(tx: ScopedTransaction, chainId: string): Promise<IssuedRefreshToken> {
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await tx.refreshToken.create({ data: { chainId, tokenHash: hashOpaqueToken(token), expiresAt } });
    return { token, expiresAt };
  }

  private async revokeChains(
    tx: ScopedTransaction,
    where: Prisma.RefreshChainWhereInput,
    now: Date,
  ): Promise<number> {
    const { count } = await tx.refreshChain.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: now } });
    return count;
  }
}
