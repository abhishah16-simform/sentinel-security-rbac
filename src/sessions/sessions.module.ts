import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { JwksController } from './jwks.controller';
import { MeController } from './me.controller';
import { RefreshTokenService } from './refresh-token.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SigningKey } from './signing-key';

@Module({
  imports: [IdentityModule],
  controllers: [SessionsController, MeController, JwksController],
  providers: [SigningKey, AccessTokenService, RefreshTokenService, SessionsService, AccessTokenGuard],
  exports: [AccessTokenService, AccessTokenGuard],
})
export class SessionsModule {}
