import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { ActiveTenant, ActiveTenantGuard } from './active-tenant.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { type ActiveTenantRef, TenancyService, type TenantMembership } from './tenancy.service';

interface TenantList {
  readonly items: readonly TenantMembership[];
}

@Controller('tenants')
@UseGuards(AccessTokenGuard)
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  /** Create a Tenant; the caller becomes its first Tenant Admin. */
  @Post()
  create(@CurrentClaims() claims: AccessTokenClaims, @Body() body: CreateTenantDto): Promise<TenantMembership> {
    return this.tenancy.createTenant(claims.sub, body.name);
  }

  /** The Tenants the caller belongs to (the Tenant picker). */
  @Get()
  async list(@CurrentClaims() claims: AccessTokenClaims): Promise<TenantList> {
    return { items: await this.tenancy.listForUser(claims.sub) };
  }

  /** The caller's Active Tenant and their Membership in it. */
  @Get('current')
  @UseGuards(ActiveTenantGuard)
  current(@ActiveTenant() active: ActiveTenantRef): Promise<TenantMembership> {
    return this.tenancy.getActive(active);
  }
}
