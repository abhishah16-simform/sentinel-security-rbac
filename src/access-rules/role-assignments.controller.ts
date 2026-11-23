import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import type { Page } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { CreateRoleAssignmentDto, RoleAssignmentListQuery } from './dto/role-assignment.dto';
import { type EffectivePermissions, RoleAssignmentsService, type RoleAssignmentView } from './role-assignments.service';

/** The Active Tenant's Role Assignments and each Membership's effective Permissions, for its Tenant Admins. */
@Controller('tenants/current')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class RoleAssignmentsController {
  constructor(private readonly assignments: RoleAssignmentsService) {}

  /** Newest first, paginated; filter by membershipId, roleId, applicationId or status (active, expired, revoked). */
  @Get('role-assignments')
  list(@ActiveTenant() active: ActiveTenantRef, @Query() query: RoleAssignmentListQuery): Promise<Page<RoleAssignmentView>> {
    return this.assignments.list(active.tenantId, query);
  }

  /** Give a Role to a Membership across the whole Tenant, optionally until expiresAt. */
  @Post('role-assignments')
  create(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Body() body: CreateRoleAssignmentDto,
  ): Promise<RoleAssignmentView> {
    return this.assignments.create(active.tenantId, claims.sub, body);
  }

  @Get('role-assignments/:assignmentId')
  get(
    @ActiveTenant() active: ActiveTenantRef,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ): Promise<RoleAssignmentView> {
    return this.assignments.get(active.tenantId, assignmentId);
  }

  /** End an active Role Assignment at once. It is kept, marked revoked. */
  @Post('role-assignments/:assignmentId/revoke')
  revoke(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ): Promise<RoleAssignmentView> {
    return this.assignments.revoke(active.tenantId, claims.sub, assignmentId);
  }

  /** Every Permission the Membership holds now, across all its active Role Assignments, by Application. */
  @Get('memberships/:membershipId/effective-permissions')
  effectivePermissions(
    @ActiveTenant() active: ActiveTenantRef,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<EffectivePermissions> {
    return this.assignments.effectivePermissions(active.tenantId, membershipId);
  }
}
