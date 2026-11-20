import { Module } from '@nestjs/common';
import { AuditIntegrity } from './audit-integrity.service';
import { AuditLog } from './audit-log.service';

/**
 * The Audit Log writer and integrity check. Imports nothing, so every module can record events
 * through it. The console endpoints live in AuditConsoleModule.
 */
@Module({
  providers: [AuditLog, AuditIntegrity],
  exports: [AuditLog, AuditIntegrity],
})
export class AuditModule {}
