import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import { type Page, PageQuery } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { EnablementService, type TenantApplication, type TenantApplicationDetail } from './enablement.service';

/** Registered Applications and the Active Tenant's Enablement of each, for its Tenant Admins. */
@Controller('tenants/current/applications')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class EnablementController {
  constructor(private readonly enablement: EnablementService) {}

  /** Every registered Application, oldest first, paginated. */
  @Get()
  list(@ActiveTenant() active: ActiveTenantRef, @Query() query: PageQuery): Promise<Page<TenantApplication>> {
    return this.enablement.list(active.tenantId, query);
  }

  /** The Application, its Schema, and the Tenant's Roles for it with Deprecated Permissions flagged. */
  @Get(':applicationId')
  get(
    @ActiveTenant() active: ActiveTenantRef,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<TenantApplicationDetail> {
    return this.enablement.get(active.tenantId, applicationId);
  }

  /** Enable it. The first time, its Role Templates are copied into the Tenant as Roles. */
  @Post(':applicationId/enable')
  @HttpCode(HttpStatus.OK)
  enable(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<TenantApplicationDetail> {
    return this.enablement.enable(active.tenantId, claims.sub, applicationId);
  }

  /** Disable it. The Tenant's Roles for it are kept. */
  @Post(':applicationId/disable')
  @HttpCode(HttpStatus.OK)
  disable(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<TenantApplicationDetail> {
    return this.enablement.disable(active.tenantId, claims.sub, applicationId);
  }
}
