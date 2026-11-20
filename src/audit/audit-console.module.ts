import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { IdentityModule } from '../identity/identity.module';
import { AuditLogController, PlatformAuditLogController } from './audit-log.controller';
import { AuditQuery } from './audit-query.service';
import { AuditModule } from './audit.module';

/**
 * Searching and verifying the Audit Log. Kept apart from AuditModule because it reads Users
 * through IdentityModule, which itself records events through AuditModule.
 */
@Module({
  imports: [AccessTokenModule, AuditModule, IdentityModule],
  controllers: [AuditLogController, PlatformAuditLogController],
  providers: [AuditQuery],
})
export class AuditConsoleModule {}
