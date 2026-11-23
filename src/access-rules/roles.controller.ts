import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import type { Page } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { CreateRoleDto, PermissionListQuery, RoleListQuery, RolePermissionDto, UpdateRoleDto } from './dto/role.dto';
import { type PermissionListItem, type RoleDetail, RolesService, type RoleSummary } from './roles.service';

/** The Active Tenant's Roles and their Permissions, for its Tenant Admins. */
@Controller('tenants/current')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Oldest first, paginated, optionally for one Application. Permissions on Deprecated entries are flagged. */
  @Get('roles')
  list(@ActiveTenant() active: ActiveTenantRef, @Query() query: RoleListQuery): Promise<Page<RoleSummary>> {
    return this.roles.list(active.tenantId, query);
  }

  /** A new Role for an enabled Application, optionally with Permissions. */
  @Post('roles')
  create(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Body() body: CreateRoleDto,
  ): Promise<RoleDetail> {
    return this.roles.create(active.tenantId, claims.sub, body);
  }

  /** The Role, its Permissions and the Application Schema they are written against. */
  @Get('roles/:roleId')
  get(@ActiveTenant() active: ActiveTenantRef, @Param('roleId', ParseUUIDPipe) roleId: string): Promise<RoleDetail> {
    return this.roles.get(active.tenantId, roleId);
  }

  @Patch('roles/:roleId')
  update(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleDetail> {
    return this.roles.update(active.tenantId, claims.sub, roleId, body);
  }

  @Delete('roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.roles.remove(active.tenantId, claims.sub, roleId);
  }

  @Post('roles/:roleId/permissions')
  addPermission(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: RolePermissionDto,
  ): Promise<RoleDetail> {
    return this.roles.addPermission(active.tenantId, claims.sub, roleId, body);
  }

  @Delete('roles/:roleId/permissions/:permissionId')
  removePermission(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ): Promise<RoleDetail> {
    return this.roles.removePermission(active.tenantId, claims.sub, roleId, permissionId);
  }

  /** Every Permission in the Tenant's Roles, oldest first, optionally for one Application or Resource Type. */
  @Get('permissions')
  listPermissions(
    @ActiveTenant() active: ActiveTenantRef,
    @Query() query: PermissionListQuery,
  ): Promise<Page<PermissionListItem>> {
    return this.roles.listPermissions(active.tenantId, query);
  }
}
