import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import { ActiveTenant } from './active-tenant.guard';
import { InviteDto } from './dto/invite.dto';
import { InvitationSignupDto, InvitationTokenDto } from './dto/invitation-link.dto';
import {
  type InvitationPreview,
  InvitationsService,
  type ReceivedInvitation,
  type TenantInvitation,
} from './invitations.service';
import type { ActiveTenantRef, TenantMembership } from './tenancy.service';

interface ItemList<T> {
  readonly items: readonly T[];
}

/** The Active Tenant's pending Invitations, for its Tenant Admins. */
@Controller('tenants/current/invitations')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class TenantInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  async list(@ActiveTenant() active: ActiveTenantRef): Promise<ItemList<TenantInvitation>> {
    return { items: await this.invitations.listForTenant(active.tenantId) };
  }

  @Post()
  invite(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Body() body: InviteDto,
  ): Promise<TenantInvitation> {
    return this.invitations.invite(active, claims.sub, body.email);
  }

  /** Email the Invitation again with a new link. The old link stops working. */
  @Post(':invitationId/resend')
  @HttpCode(HttpStatus.OK)
  resend(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<TenantInvitation> {
    return this.invitations.resend(active, claims.sub, invitationId);
  }

  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.cancel(active, claims.sub, invitationId);
  }
}

/** The logged-in User's Invitations inbox. */
@Controller('me/invitations')
@UseGuards(AccessTokenGuard)
export class MyInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  async list(@CurrentClaims() claims: AccessTokenClaims): Promise<ItemList<ReceivedInvitation>> {
    return { items: await this.invitations.listForUser(claims.sub) };
  }

  /** Accept: creates the Membership. Needs a verified email. */
  @Post(':invitationId/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<TenantMembership> {
    return this.invitations.accept(claims.sub, invitationId);
  }

  @Post(':invitationId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.decline(claims.sub, invitationId);
  }
}

/** The emailed Invitation link, for a person who may not have an account yet. */
@Controller('invitations')
export class InvitationLinkController {
  constructor(private readonly invitations: InvitationsService) {}

  /** Who the Invitation is from and for, and whether the email already has an account. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: InvitationTokenDto): Promise<InvitationPreview> {
    return this.invitations.preview(body.token);
  }

  /** Create an account for the invited email and accept the Invitation. Then log in. */
  @Post('signup')
  signup(@Body() body: InvitationSignupDto): Promise<TenantMembership> {
    const { token, firstName, lastName, password } = body;
    return this.invitations.signup(token, { firstName, lastName, password });
  }
}
