import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MeController } from './me.controller';
import { RefreshTokenService } from './refresh-token.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [AccessTokenModule, AuditModule, IdentityModule, TenancyModule],
  controllers: [SessionsController, MeController],
  providers: [RefreshTokenService, SessionsService],
})
export class SessionsModule {}
