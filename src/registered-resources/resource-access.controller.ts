import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import { type Page, PageQuery } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { CreateRegisteredResourceDto, TenantResourceListQuery } from './dto/registered-resource.dto';
import { type RegisteredResourceView, RegisteredResourcesService, type ResourceAccessReport } from './registered-resources.service';

/**
 * The Active Tenant's Registered Resources and who can access each, for its Tenant Admins. They may
 * also register one by hand; keeping its attributes current is left to the Application.
 */
@Controller('tenants/current/registered-resources')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class ResourceAccessController {
  constructor(private readonly resources: RegisteredResourcesService) {}

  /** Newest first, paginated; filter by applicationId, resourceType or resourceId (exact). */
  @Get()
  list(@ActiveTenant() active: ActiveTenantRef, @Query() query: TenantResourceListQuery): Promise<Page<RegisteredResourceView>> {
    return this.resources.list(active.tenantId, query);
  }

  /** Register a resource for one of the Tenant's enabled Applications (201); 409 if it is already registered. */
  @Post()
  create(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Body() body: CreateRegisteredResourceDto,
  ): Promise<RegisteredResourceView> {
    return this.resources.createFromConsole(active.tenantId, claims.sub, body);
  }

  @Get(':id')
  get(@ActiveTenant() active: ActiveTenantRef, @Param('id', ParseUUIDPipe) id: string): Promise<RegisteredResourceView> {
    return this.resources.get(active.tenantId, id);
  }

  /**
   * Access by Registered Resource: for each Membership with an active Role in the resource's
   * Application (oldest first, paginated), what an Access Check would answer for each Action of its
   * Resource Type against its stored attributes.
   */
  @Get(':id/access')
  access(
    @ActiveTenant() active: ActiveTenantRef,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQuery,
  ): Promise<ResourceAccessReport> {
    return this.resources.report(active.tenantId, id, query);
  }
}
