import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import { ActiveTenant } from './active-tenant.guard';
import { SetTenantAdminDto } from './dto/set-tenant-admin.dto';
import { MembershipsService, type TenantMember } from './memberships.service';
import type { ActiveTenantRef } from './tenancy.service';

interface MemberList {
  readonly items: readonly TenantMember[];
}

/** The Active Tenant's Memberships, for its Tenant Admins. */
@Controller('tenants/current/memberships')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  async list(@ActiveTenant() active: ActiveTenantRef): Promise<MemberList> {
    return { items: await this.memberships.list(active.tenantId) };
  }

  /** Give or remove the Tenant Admin flag. Refused if it would leave the Tenant with no Tenant Admin. */
  @Patch(':membershipId')
  setTenantAdmin(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() body: SetTenantAdminDto,
  ): Promise<TenantMember> {
    return this.memberships.setTenantAdmin(active, claims.sub, membershipId, body.isTenantAdmin);
  }

  /** Remove a Membership. Refused for the last Tenant Admin. */
  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<void> {
    return this.memberships.remove(active, claims.sub, membershipId);
  }
}
