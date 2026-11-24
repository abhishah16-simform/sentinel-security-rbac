import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { PlatformAdminGuard } from '../access-token/admin.guards';
import { type Page, PageQuery } from '../common/pagination';
import { type PlatformTenantSummary, PlatformTenantsService } from './platform-tenants.service';

/** Every Tenant with basic counts, and suspension, for Platform Admins. */
@Controller('platform/tenants')
@UseGuards(AccessTokenGuard, PlatformAdminGuard)
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  /** Newest first, paginated. */
  @Get()
  list(@Query() query: PageQuery): Promise<Page<PlatformTenantSummary>> {
    return this.tenants.list(query);
  }

  /** Suspend a Tenant. 409 if it is already suspended. */
  @Post(':tenantId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<PlatformTenantSummary> {
    return this.tenants.suspend(claims.sub, tenantId);
  }

  /** Reactivate a Suspended Tenant. 409 if it isn't suspended. */
  @Post(':tenantId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<PlatformTenantSummary> {
    return this.tenants.reactivate(claims.sub, tenantId);
  }
}
