import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { AuditModule } from '../audit/audit.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ClientCredentialsGuard } from './client-credentials.guard';
import { RoleTemplatesController } from './role-templates.controller';
import { RoleTemplatesService } from './role-templates.service';

/** The Application registry, client credentials, Application Schemas and Role Templates. Platform-level only. */
@Module({
  imports: [AccessTokenModule, AuditModule],
  controllers: [ApplicationsController, RoleTemplatesController],
  providers: [ApplicationsService, RoleTemplatesService, ClientCredentialsGuard],
  exports: [ApplicationsService, RoleTemplatesService, ClientCredentialsGuard],
})
export class ApplicationsModule {}
