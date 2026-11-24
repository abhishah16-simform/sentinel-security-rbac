import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { AccessCheckController } from './access-check.controller';
import { AccessCheckService } from './access-check.service';

/**
 * The Access Check API that Applications call, around the pure engine in access-check-engine.ts.
 * Reads Access Rules straight from their tables; nothing imports this module.
 */
@Module({
  imports: [AccessTokenModule, ApplicationsModule, AuditModule],
  controllers: [AccessCheckController],
  providers: [AccessCheckService],
})
export class AccessCheckModule {}
