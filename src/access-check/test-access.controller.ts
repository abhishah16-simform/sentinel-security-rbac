import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../access-token/access-token.guard';
import { TenantAdminGuard } from '../access-token/admin.guards';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { AccessCheckService, type AccessCheckResult } from './access-check.service';
import { TestAccessDto } from './dto/access-check.dto';

/** The console's Test access panel: what an Access Check would answer, for the Active Tenant's Tenant Admins. */
@Controller('tenants/current/test-access')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class TestAccessController {
  constructor(private readonly accessChecks: AccessCheckService) {}

  /**
   * 200 with the same { allowed, reason, roleId?, permissionId? } an Application would get; 400 for an
   * Action or Resource Type outside the Application Schema; 404 for an unknown Membership or
   * Application. Not written to the Audit Log.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  test(@ActiveTenant() active: ActiveTenantRef, @Body() body: TestAccessDto): Promise<AccessCheckResult> {
    return this.accessChecks.test(active.tenantId, body);
  }
}
