import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { EnablementController } from './enablement.controller';
import { EnablementService } from './enablement.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Tenant-owned access rules: Enablement of Applications, and the Roles and Permissions inside them.
 * Imports the platform-level ApplicationsModule for Schemas and Role Templates, never the reverse.
 */
@Module({
  imports: [AccessTokenModule, ApplicationsModule, AuditModule],
  controllers: [EnablementController, RolesController],
  providers: [EnablementService, RolesService],
})
export class AccessRulesModule {}
