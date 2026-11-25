import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../access-token/access-token.guard';
import { TenantAdminGuard } from '../access-token/admin.guards';
import { PageQuery } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { ExpiringReportQuery } from './dto/role-assignment.dto';
import { type ExpiringSoonReport, type ExpiryReportPage, RoleAssignmentsService } from './role-assignments.service';

/** The expiring-soon and expired Role Assignments report for the Active Tenant's Tenant Admins. */
@Controller('tenants/current/reports')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class ExpiryReportController {
  constructor(private readonly assignments: RoleAssignmentsService) {}

  /** Active Temporary Role Assignments expiring within withinDays days (1 to 365, default 7), soonest first, paginated. */
  @Get('expiring-role-assignments')
  expiringSoon(@ActiveTenant() active: ActiveTenantRef, @Query() query: ExpiringReportQuery): Promise<ExpiringSoonReport> {
    return this.assignments.expiringSoon(active.tenantId, query);
  }

  /** Expired Role Assignments, most recently expired first, paginated. */
  @Get('expired-role-assignments')
  expired(@ActiveTenant() active: ActiveTenantRef, @Query() query: PageQuery): Promise<ExpiryReportPage> {
    return this.assignments.expired(active.tenantId, query);
  }
}
