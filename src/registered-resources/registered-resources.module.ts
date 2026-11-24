import { Module } from '@nestjs/common';
import { AccessCheckModule } from '../access-check/access-check.module';
import { AccessTokenModule } from '../access-token/access-token.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { RegisteredResourcesController } from './registered-resources.controller';
import { RegisteredResourcesService } from './registered-resources.service';
import { ResourceAccessController } from './resource-access.controller';

/**
 * Registered Resources: the Application API that keeps them, and the Tenant Admin's
 * access-by-Registered-Resource report, which runs the Access Check gates and engine per Membership.
 */
@Module({
  imports: [AccessCheckModule, AccessTokenModule, ApplicationsModule, AuditModule],
  controllers: [RegisteredResourcesController, ResourceAccessController],
  providers: [RegisteredResourcesService],
})
export class RegisteredResourcesModule {}
