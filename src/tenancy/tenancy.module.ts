import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { MailModule } from '../mail/mail.module';
import { ActiveTenantGuard } from './active-tenant.guard';
import { InvitationLinkController, MyInvitationsController, TenantInvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [AccessTokenModule, AuditModule, IdentityModule, MailModule],
  controllers: [
    TenancyController,
    MembershipsController,
    TenantInvitationsController,
    MyInvitationsController,
    InvitationLinkController,
    PlatformTenantsController,
  ],
  providers: [TenancyService, MembershipsService, InvitationsService, PlatformTenantsService, ActiveTenantGuard],
  exports: [TenancyService],
})
export class TenancyModule {}
