import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { AuditModule } from '../audit/audit.module';
import { SecurityAlertsController } from './security-alerts.controller';
import { SecurityAlertsService } from './security-alerts.service';

/**
 * Listing and acknowledging Security Alerts. The rules that raise them (security-alert-rules) are
 * plain functions AuditLog calls for every entry it writes, so this module is only the console.
 */
@Module({
  imports: [AccessTokenModule, AuditModule],
  controllers: [SecurityAlertsController],
  providers: [SecurityAlertsService],
})
export class SecurityAlertsModule {}
