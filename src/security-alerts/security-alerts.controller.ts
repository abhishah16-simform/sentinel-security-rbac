import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import type { Page } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { SecurityAlertListQuery } from './dto/security-alert.dto';
import { SecurityAlertsService, type SecurityAlertView } from './security-alerts.service';

/** The Active Tenant's Security Alerts, for its Tenant Admins; any of them may acknowledge any alert. */
@Controller('tenants/current/security-alerts')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class SecurityAlertsController {
  constructor(private readonly alerts: SecurityAlertsService) {}

  /** Newest first, paginated; filter by status (open, acknowledged) and rule. */
  @Get()
  list(@ActiveTenant() active: ActiveTenantRef, @Query() query: SecurityAlertListQuery): Promise<Page<SecurityAlertView>> {
    return this.alerts.list(active.tenantId, query);
  }

  /** Mark the alert as dealt with; 409 if it already is. */
  @Post(':alertId/acknowledge')
  acknowledge(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ): Promise<SecurityAlertView> {
    return this.alerts.acknowledge(active.tenantId, claims.sub, alertId);
  }
}
