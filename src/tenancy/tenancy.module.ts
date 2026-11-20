import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { ActiveTenantGuard } from './active-tenant.guard';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [AccessTokenModule, AuditModule, IdentityModule],
  controllers: [TenancyController],
  providers: [TenancyService, ActiveTenantGuard],
  exports: [TenancyService],
})
export class TenancyModule {}
