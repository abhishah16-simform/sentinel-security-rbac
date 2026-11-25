import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { TenantAdminGuard } from '../access-token/admin.guards';
import type { Page } from '../common/pagination';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { type AccessReviewItemView, AccessReviewsService, type AccessReviewView } from './access-reviews.service';
import { AccessReviewListQuery, ReviewItemListQuery, StartAccessReviewDto } from './dto/access-review.dto';

/** The Active Tenant's Access Reviews, for its Tenant Admins; any of them may decide any item. */
@Controller('tenants/current/access-reviews')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class AccessReviewsController {
  constructor(private readonly reviews: AccessReviewsService) {}

  /** Newest first, paginated, each with its progress; filter by status (open, closed) or applicationId. */
  @Get()
  list(@ActiveTenant() active: ActiveTenantRef, @Query() query: AccessReviewListQuery): Promise<Page<AccessReviewView>> {
    return this.reviews.list(active.tenantId, query);
  }

  /** Start a review of an enabled Application, snapshotting its active Role Assignments as items. */
  @Post()
  start(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Body() body: StartAccessReviewDto,
  ): Promise<AccessReviewView> {
    return this.reviews.start(active.tenantId, claims.sub, body);
  }

  /** The review with its certified, revoked, auto-revoked and pending counts. */
  @Get(':reviewId')
  get(@ActiveTenant() active: ActiveTenantRef, @Param('reviewId', ParseUUIDPipe) reviewId: string): Promise<AccessReviewView> {
    return this.reviews.get(active.tenantId, reviewId);
  }

  /** Items by member, then Role, paginated; filter by outcome. Once closed, the outcome report. */
  @Get(':reviewId/items')
  items(
    @ActiveTenant() active: ActiveTenantRef,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query() query: ReviewItemListQuery,
  ): Promise<Page<AccessReviewItemView>> {
    return this.reviews.items(active.tenantId, reviewId, query);
  }

  /** Confirm the Role Assignment should stay. */
  @Post(':reviewId/items/:itemId/certify')
  certify(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<AccessReviewItemView> {
    return this.reviews.certify(active.tenantId, claims.sub, reviewId, itemId);
  }

  /** Revoke the Role Assignment at once and record the item as revoked. */
  @Post(':reviewId/items/:itemId/revoke')
  revoke(
    @ActiveTenant() active: ActiveTenantRef,
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<AccessReviewItemView> {
    return this.reviews.revoke(active.tenantId, claims.sub, reviewId, itemId);
  }
}
