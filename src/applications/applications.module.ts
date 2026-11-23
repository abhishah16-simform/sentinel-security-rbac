import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { AuditModule } from '../audit/audit.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/** The Application registry, client credentials and Application Schemas. Platform-level only. */
@Module({
  imports: [AccessTokenModule, AuditModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
