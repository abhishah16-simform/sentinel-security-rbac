import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { generateOpaqueToken, hashOpaqueToken } from '../common/opaque-token';
import { PrismaService } from '../prisma/prisma.service';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';

export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Starts a new chain for a fresh login and returns its first token. */
  async startChain(userId: string): Promise<IssuedRefreshToken> {
    return this.prisma.$transaction(async (tx) => {
      const chain = await tx.refreshChain.create({ data: { userId } });
      return this.issueInChain(tx, chain.id);
    });
  }

  /** The User a refresh token was issued to, without using it. Null for unknown tokens. */
  async ownerOf(token: string): Promise<string | null> {
    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
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
        return { kind: 'reused', userId: chain.userId, chainId: chain.id };
      }
      if (current.expiresAt <= now) return { kind: 'rejected' };

      await tx.refreshToken.update({ where: { id: current.id }, data: { usedAt: now } });
      let active: ActiveTenantRef | null =
        chain.activeTenantId !== null && chain.activeMembershipId !== null
          ? { tenantId: chain.activeTenantId, membershipId: chain.activeMembershipId }
          : null;
      if (switchTo) {
        await tx.refreshChain.update({
          where: { id: chain.id },
          data: { activeTenantId: switchTo.tenantId, activeMembershipId: switchTo.membershipId },
        });
        active = switchTo;
      }
      return { kind: 'rotated', userId: chain.userId, activeTenant: active, next: await this.issueInChain(tx, chain.id) };
    });

    if (result.kind === 'reused') {
      // Recorded in the Audit Log (and raised as a Security Alert) once ticket 04 adds the audit writer.
      this.logger.warn(`Refresh token reuse detected; revoked chain ${result.chainId} of user ${result.userId}`);
    }
    return result;
  }

  /** Revokes the chain the given token belongs to (log out on this device). Unknown tokens are ignored. */
  async revokeChainOf(token: string): Promise<void> {
    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      select: { chainId: true },
    });
    if (!found) return;
    await this.prisma.$transaction((tx) => this.revokeChains(tx, { id: found.chainId }, new Date()));
  }

  /** Revokes every chain the User holds (log out everywhere). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.$transaction((tx) => this.revokeChains(tx, { userId }, new Date()));
  }

  private async issueInChain(tx: Prisma.TransactionClient, chainId: string): Promise<IssuedRefreshToken> {
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await tx.refreshToken.create({ data: { chainId, tokenHash: hashOpaqueToken(token), expiresAt } });
    return { token, expiresAt };
  }

  private async revokeChains(
    tx: Prisma.TransactionClient,
    where: Prisma.RefreshChainWhereInput,
    now: Date,
  ): Promise<void> {
    await tx.refreshChain.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: now } });
  }
}
