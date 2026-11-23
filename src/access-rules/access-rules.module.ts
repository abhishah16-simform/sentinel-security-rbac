import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { EnablementController } from './enablement.controller';
import { EnablementService } from './enablement.service';
import { RoleAssignmentsController } from './role-assignments.controller';
import { RoleAssignmentsService } from './role-assignments.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Tenant-owned access rules: Enablement of Applications, the Roles and Permissions inside them, and
 * Role Assignments.
 * Imports the platform-level ApplicationsModule for Schemas and Role Templates, never the reverse.
 */
@Module({
  imports: [AccessTokenModule, ApplicationsModule, AuditModule],
  controllers: [EnablementController, RolesController, RoleAssignmentsController],
  providers: [EnablementService, RolesService, RoleAssignmentsService],
})
export class AccessRulesModule {}
