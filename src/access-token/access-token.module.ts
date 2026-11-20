import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { JwksController } from './jwks.controller';
import { SigningKey } from './signing-key';

/** Issuing and verifying access tokens, the bearer-token guard and the JWKS endpoint. */
@Module({
  controllers: [JwksController],
  providers: [SigningKey, AccessTokenService, AccessTokenGuard],
  exports: [AccessTokenService, AccessTokenGuard],
})
export class AccessTokenModule {}
