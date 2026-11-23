import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Invitation, Prisma } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import { AuditLog } from '../audit/audit-log.service';
import { generateOpaqueToken, hashOpaqueToken } from '../common/opaque-token';
import { type Page, type PageQuery, pageWindow, toPage } from '../common/pagination';
import { isUniqueConstraintError } from '../common/prisma-errors';
import type { Env } from '../config/env';
import { normalizeEmail } from '../identity/email';
import { IdentityService, type SignupInput, type UserProfile } from '../identity/identity.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedPrisma, type ScopedTransaction, setTenantContext } from '../prisma/scoped-prisma';
import { type TenantMembership, toTenantMembership } from './tenancy.service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** An Invitation's email can be resent once this long after it was last sent. */
const RESEND_INTERVAL_MS = 60 * 1000;

const INVALID_LINK_MESSAGE = 'This Invitation link is invalid, already used, cancelled or expired.';
const NOT_PENDING_MESSAGE = 'This Invitation is no longer pending, or has expired.';

/** Loads the Tenant (no RLS) and the inviting User with an Invitation, for names. */
const WITH_NAMES = { tenant: true, invitedBy: true } as const satisfies Prisma.InvitationInclude;
type InvitationWithNames = Prisma.InvitationGetPayload<{ include: typeof WITH_NAMES }>;

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

/** A pending Invitation, as the Tenant Admin's Invitations list shows it. */
export interface TenantInvitation {
  readonly id: string;
  readonly email: string;
  readonly invitedByName: string | null;
  readonly sentAt: Date;
  readonly expiresAt: Date;
  /** Past its expiry: it can't be accepted until it is resent. */
  readonly expired: boolean;
}

/** A pending Invitation in the invited User's inbox. */
export interface ReceivedInvitation {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly invitedByName: string | null;
  readonly sentAt: Date;
  readonly expiresAt: Date;
}

/** What the holder of an Invitation link may see before signing up. */
export interface InvitationPreview {
  readonly tenantName: string;
  readonly email: string;
  readonly invitedByName: string | null;
  readonly expiresAt: Date;
  /** The email already has an account, so the holder should log in and accept from the inbox. */
  readonly hasAccount: boolean;
}

export type InvitationSignupInput = Omit<SignupInput, 'email'>;

/** An Invitation link token: "<tenantId>.<secret>". The Tenant ID lets the lookup run under RLS. */
interface LinkToken {
  readonly tenantId: string;
  readonly tokenHash: string;
}

const LINK_TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([\w-]{43})$/;

function parseLinkToken(token: string): LinkToken {
  const match = LINK_TOKEN_PATTERN.exec(token);
  const tenantId = match?.[1];
  const secret = match?.[2];
  if (tenantId === undefined || secret === undefined) throw new NotFoundException(INVALID_LINK_MESSAGE);
  return { tenantId, tokenHash: hashOpaqueToken(secret) };
}

function displayName(user: { readonly firstName: string; readonly lastName: string } | null): string | null {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
}

function isOpen(invitation: Invitation, now: Date): boolean {
  return invitation.status === 'PENDING' && invitation.expiresAt > now;
}

function toTenantInvitation(invitation: InvitationWithNames, now: Date): TenantInvitation {
  return {
    id: invitation.id,
    email: invitation.email,
    invitedByName: displayName(invitation.invitedBy),
    sentAt: invitation.sentAt,
    expiresAt: invitation.expiresAt,
    expired: invitation.expiresAt <= now,
  };
}

/** Invitations: sending and managing them as a Tenant Admin, and answering them as the invited person. */
@Injectable()
export class InvitationsService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedPrisma,
    private readonly identity: IdentityService,
    private readonly mail: MailService,
    private readonly audit: AuditLog,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  // -------------------------------------------------------------------------------------------
  // Tenant Admin
  // -------------------------------------------------------------------------------------------

  /** The Active Tenant's pending Invitations, newest first. */
  async listForTenant(tenantId: string, query: PageQuery): Promise<Page<TenantInvitation>> {
    const now = new Date();
    const window = pageWindow(query, 'desc');
    const rows = await this.scoped.inTenant(tenantId, (tx) =>
      tx.invitation.findMany({
        where: { tenantId, status: 'PENDING', ...window.after },
        include: WITH_NAMES,
        orderBy: window.orderBy,
        take: window.take,
      }),
    );
    return toPage(rows, window, (invitation) => toTenantInvitation(invitation, now));
  }

  /** Invites an email address to the Active Tenant and emails it a link. */
  async invite(tenantId: string, actorUserId: string, rawEmail: string): Promise<TenantInvitation> {
    const email = normalizeEmail(rawEmail);
    const invitee = await this.identity.findProfileByEmail(email);
    const secret = generateOpaqueToken();
    const now = new Date();

    let invitation: InvitationWithNames;
    try {
      invitation = await this.scoped.inTenant(tenantId, async (tx) => {
        if (invitee) {
          const existing = await tx.membership.findUnique({
            where: { tenantId_userId: { tenantId, userId: invitee.id } },
          });
          if (existing) throw new ConflictException('That person is already a member of this Tenant.');
        }
        const created = await tx.invitation.create({
          data: {
            tenantId,
            email,
            invitedByUserId: actorUserId,
            tokenHash: hashOpaqueToken(secret),
            expiresAt: expiryFrom(now),
            sentAt: now,
          },
          include: WITH_NAMES,
        });
        await this.recordIn(tx, created, 'invitation.sent', actorUserId);
        return created;
      });
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;
      throw new ConflictException('That email already has a pending Invitation. Resend it instead.');
    }
    await this.sendInvitationEmail(invitation, secret);
    return toTenantInvitation(invitation, now);
  }

  /** Emails a pending Invitation again with a new link, and renews its expiry. The old link stops working. */
  async resend(tenantId: string, actorUserId: string, invitationId: string): Promise<TenantInvitation> {
    const secret = generateOpaqueToken();
    const now = new Date();
    const invitation = await this.scoped.inTenant(tenantId, async (tx) => {
      const current = await this.findPendingIn(tx, tenantId, invitationId);
      if (now.getTime() - current.sentAt.getTime() < RESEND_INTERVAL_MS) {
        throw new HttpException('Wait a minute before resending this Invitation.', HttpStatus.TOO_MANY_REQUESTS);
      }
      const updated = await tx.invitation.update({
        where: { id: current.id },
        data: { tokenHash: hashOpaqueToken(secret), expiresAt: expiryFrom(now), sentAt: now },
        include: WITH_NAMES,
      });
      await this.recordIn(tx, updated, 'invitation.resent', actorUserId);
      return updated;
    });
    await this.sendInvitationEmail(invitation, secret);
    return toTenantInvitation(invitation, now);
  }

  async cancel(tenantId: string, actorUserId: string, invitationId: string): Promise<void> {
    await this.scoped.inTenant(tenantId, async (tx) => {
      const invitation = await this.findPendingIn(tx, tenantId, invitationId);
      await this.closeIn(tx, invitation, 'CANCELLED');
      await this.recordIn(tx, invitation, 'invitation.cancelled', actorUserId);
    });
  }

  // -------------------------------------------------------------------------------------------
  // The invited User
  // -------------------------------------------------------------------------------------------

  /**
   * Pending, unexpired Invitations to the User's email, across Tenants, newest first: the Invitations
   * inbox. Only for a verified email, so an account squatting on someone's address learns nothing.
   */
  async listForUser(userId: string, query: PageQuery): Promise<Page<ReceivedInvitation>> {
    const user = await this.identity.getProfile(userId);
    if (!user.emailVerified) throw new ForbiddenException('Verify your email address to see Invitations sent to it.');
    const now = new Date();
    const window = pageWindow(query, 'desc');
    const rows = await this.scoped.asUser(userId, (tx) =>
      tx.invitation.findMany({
        where: { email: user.email, status: 'PENDING', expiresAt: { gt: now }, ...window.after },
        include: WITH_NAMES,
        orderBy: window.orderBy,
        take: window.take,
      }),
    );
    return toPage(rows, window, (invitation) => ({
      id: invitation.id,
      tenantId: invitation.tenantId,
      tenantName: invitation.tenant.name,
      invitedByName: displayName(invitation.invitedBy),
      sentAt: invitation.sentAt,
      expiresAt: invitation.expiresAt,
    }));
  }

  /** Accepts an Invitation to the User's email: the only way an Invitation becomes a Membership. */
  async accept(userId: string, invitationId: string): Promise<TenantMembership> {
    const user = await this.identity.getProfile(userId);
    if (!user.emailVerified) throw new ForbiddenException('Verify your email address before accepting an Invitation.');
    if (user.isPlatformAdmin) {
      throw new ForbiddenException('Platform Admin accounts have no Memberships, so they cannot accept Invitations.');
    }
    return this.withMembershipConflict(() =>
      this.scoped.asUser(userId, async (tx) => {
        const invitation = await this.findOwnOpenIn(tx, user, invitationId);
        return this.acceptIn(tx, invitation, user);
      }),
    );
  }

  async decline(userId: string, invitationId: string): Promise<void> {
    const user = await this.identity.getProfile(userId);
    if (!user.emailVerified) throw new ForbiddenException('Verify your email address before answering an Invitation.');
    await this.scoped.asUser(userId, async (tx) => {
      const invitation = await this.findOwnOpenIn(tx, user, invitationId);
      await setTenantContext(tx, invitation.tenantId);
      await this.closeIn(tx, invitation, 'DECLINED');
      await this.recordIn(tx, invitation, 'invitation.declined', user.id);
    });
  }

  // -------------------------------------------------------------------------------------------
  // The Invitation link (no account yet)
  // -------------------------------------------------------------------------------------------

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.findByLink(token);
    return {
      tenantName: invitation.tenant.name,
      email: invitation.email,
      invitedByName: displayName(invitation.invitedBy),
      expiresAt: invitation.expiresAt,
      hasAccount: (await this.identity.findProfileByEmail(invitation.email)) !== null,
    };
  }

  /** Signs up the invited email from the link and accepts the Invitation, in one transaction. */
  async signup(token: string, input: InvitationSignupInput): Promise<TenantMembership> {
    const invitation = await this.findByLink(token);
    return this.withMembershipConflict(() =>
      this.identity.signupFromInvitation({ ...input, email: invitation.email }, (tx, user) =>
        this.acceptIn(tx, invitation, user),
      ),
    );
  }

  // -------------------------------------------------------------------------------------------

  private async findPendingIn(tx: ScopedTransaction, tenantId: string, invitationId: string): Promise<Invitation> {
    const invitation = await tx.invitation.findFirst({ where: { id: invitationId, tenantId, status: 'PENDING' } });
    if (!invitation) throw new NotFoundException('No pending Invitation with that ID.');
    return invitation;
  }

  /** An open Invitation to the User's email. Runs under asUser, where RLS shows only those. */
  private async findOwnOpenIn(tx: ScopedTransaction, user: UserProfile, invitationId: string): Promise<Invitation> {
    const invitation = await tx.invitation.findFirst({ where: { id: invitationId, email: user.email } });
    if (!invitation || !isOpen(invitation, new Date())) {
      throw new NotFoundException(NOT_PENDING_MESSAGE);
    }
    return invitation;
  }

  private async findByLink(token: string): Promise<InvitationWithNames> {
    const link = parseLinkToken(token);
    const invitation = await this.scoped.inTenant(link.tenantId, (tx) =>
      tx.invitation.findUnique({ where: { tokenHash: link.tokenHash }, include: WITH_NAMES }),
    );
    if (!invitation || !isOpen(invitation, new Date())) throw new NotFoundException(INVALID_LINK_MESSAGE);
    return invitation;
  }

  /**
   * Accepts an open Invitation for the User inside the caller's transaction: closes it, creates the
   * Membership and records both in the Tenant's Audit Log. Leaves the transaction in the Tenant's context.
   */
  private async acceptIn(tx: ScopedTransaction, invitation: Invitation, user: UserProfile): Promise<TenantMembership> {
    if (invitation.email !== user.email) throw new NotFoundException('This Invitation is for a different email address.');
    await setTenantContext(tx, invitation.tenantId);
    // Claim it first: of two concurrent answers, only one sees it still pending.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status: 'ACCEPTED', closedAt: new Date() },
    });
    if (claimed.count === 0) throw new NotFoundException(NOT_PENDING_MESSAGE);

    const membership = await tx.membership.create({
      data: { tenantId: invitation.tenantId, userId: user.id },
      include: { tenant: true },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { membershipId: membership.id } });
    await this.audit.recordIn(tx, {
      tenantId: invitation.tenantId,
      eventType: 'invitation.accepted',
      actorUserId: user.id,
      target: { type: 'invitation', id: invitation.id },
      payload: { membershipId: membership.id },
    });
    return toTenantMembership(membership);
  }

  /** Accepting when the User already belongs to the Tenant breaks the Membership unique key. */
  private async withMembershipConflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;
      throw new ConflictException('You are already a member of this Tenant.');
    }
  }

  private async closeIn(tx: ScopedTransaction, invitation: Invitation, status: 'CANCELLED' | 'DECLINED'): Promise<void> {
    const { count } = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status, closedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('This Invitation is no longer pending.');
  }

  /** Invitation events join the Tenant's chain. Payloads hold no email address; the Invitation row does. */
  private recordIn(tx: ScopedTransaction, invitation: Invitation, eventType: AuditEventType, actorUserId: string): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId: invitation.tenantId,
      eventType,
      actorUserId,
      target: { type: 'invitation', id: invitation.id },
      payload: { expiresAt: invitation.expiresAt.toISOString() },
    });
  }

  private async sendInvitationEmail(invitation: InvitationWithNames, secret: string): Promise<void> {
    // The token travels in the URL fragment, so it never reaches server logs or Referer headers.
    const link = `${this.appUrl}/invitation.html#token=${invitation.tenantId}.${secret}`;
    const inviter = displayName(invitation.invitedBy) ?? 'A Tenant Admin';
    await this.mail.send({
      to: invitation.email,
      subject: `You're invited to join ${invitation.tenant.name} on Sentinel`,
      text:
        `${inviter} invited you to join ${invitation.tenant.name} on Sentinel.\n\n` +
        `Follow this link to accept. If you don't have a Sentinel account yet, you can create one there:\n\n${link}\n\n` +
        `If you already have an account, you can also log in and open Invitations. The link expires in 7 days.\n\n` +
        `If you weren't expecting this, ignore this email.`,
    });
  }
}
