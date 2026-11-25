import { Module } from '@nestjs/common';
import { AuditIntegrity } from './audit-integrity.service';
import { AuditLog } from './audit-log.service';

/**
 * The Audit Log writer and integrity check. Imports no Nest module, so every module can record
 * events through it. The writer runs the Security Alert rules (plain functions in
 * src/security-alerts/) on each entry. The console endpoints live in AuditConsoleModule.
 */
@Module({
  providers: [AuditLog, AuditIntegrity],
  exports: [AuditLog, AuditIntegrity],
})
export class AuditModule {}
