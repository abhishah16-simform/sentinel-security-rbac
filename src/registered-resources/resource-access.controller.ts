import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../access-token/access-token.guard';
import { TenantAdminGuard } from '../access-token/admin.guards';
import { type Page, PageQuery } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { TenantResourceListQuery } from './dto/registered-resource.dto';
import { type RegisteredResourceView, RegisteredResourcesService, type ResourceAccessReport } from './registered-resources.service';

/** The Active Tenant's Registered Resources and who can access each, for its Tenant Admins. Read-only. */
@Controller('tenants/current/registered-resources')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class ResourceAccessController {
  constructor(private readonly resources: RegisteredResourcesService) {}

  /** Newest first, paginated; filter by applicationId, resourceType or resourceId (exact). */
  @Get()
  list(@ActiveTenant() active: ActiveTenantRef, @Query() query: TenantResourceListQuery): Promise<Page<RegisteredResourceView>> {
    return this.resources.list(active.tenantId, query);
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
