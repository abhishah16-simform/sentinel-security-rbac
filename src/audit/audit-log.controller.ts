import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../access-token/access-token.guard';
import { PlatformAdminGuard, TenantAdminGuard } from '../access-token/admin.guards';
import { ActiveTenant } from '../tenancy/active-tenant.guard';
import type { ActiveTenantRef } from '../tenancy/tenancy.service';
import { AuditIntegrity, type IntegrityReport } from './audit-integrity.service';
import { type AuditEventPage, type AuditEventTypeView, AuditQuery } from './audit-query.service';
import { ListAuditEventsQuery } from './dto/list-audit-events.dto';

interface EventTypeList {
  readonly items: readonly AuditEventTypeView[];
}

/** The Active Tenant's Audit Log, for its Tenant Admins. */
@Controller('audit-events')
@UseGuards(AccessTokenGuard, TenantAdminGuard)
export class AuditLogController {
  constructor(
    private readonly query: AuditQuery,
    private readonly integrity: AuditIntegrity,
  ) {}

  @Get()
  list(@ActiveTenant() active: ActiveTenantRef, @Query() filters: ListAuditEventsQuery): Promise<AuditEventPage> {
    return this.query.listForTenant(active.tenantId, filters);
  }

  /** Every event type, for the event type filter. */
  @Get('types')
  types(): EventTypeList {
    return { items: this.query.eventTypes() };
  }

  /** Walks the Tenant's hash chain and reports the first broken link, if any. */
  @Get('integrity')
  verify(@ActiveTenant() active: ActiveTenantRef): Promise<IntegrityReport> {
    return this.integrity.verifyChain(active.tenantId);
  }
}

/** The platform audit chain, for Platform Admins only. */
@Controller('platform/audit-events')
@UseGuards(AccessTokenGuard, PlatformAdminGuard)
export class PlatformAuditLogController {
  constructor(
    private readonly query: AuditQuery,
    private readonly integrity: AuditIntegrity,
  ) {}

  @Get()
  list(@Query() filters: ListAuditEventsQuery): Promise<AuditEventPage> {
    return this.query.listPlatform(filters);
  }

  @Get('integrity')
  verify(): Promise<IntegrityReport> {
    return this.integrity.verifyChain(null);
  }
}
