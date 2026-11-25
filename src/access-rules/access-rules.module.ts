import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { EnablementController } from './enablement.controller';
import { EnablementService } from './enablement.service';
import { ExpiryReportController } from './expiry-report.controller';
import { RoleAssignmentExpiry } from './role-assignment-expiry';
import { RoleAssignmentsController } from './role-assignments.controller';
import { RoleAssignmentsService } from './role-assignments.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Tenant-owned access rules: Enablement of Applications, the Roles and Permissions inside them, and
 * Role Assignments, with the expiry report. Exports RoleAssignmentExpiry for the Scheduler.
 * Imports the platform-level ApplicationsModule for Schemas and Role Templates, never the reverse.
 */
@Module({
  imports: [AccessTokenModule, ApplicationsModule, AuditModule],
  controllers: [EnablementController, RolesController, RoleAssignmentsController, ExpiryReportController],
  providers: [EnablementService, RolesService, RoleAssignmentsService, RoleAssignmentExpiry],
  exports: [RoleAssignmentExpiry],
})
export class AccessRulesModule {}
