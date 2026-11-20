import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { PlatformAdminGuard, TenantAdminGuard } from './admin.guards';
import { JwksController } from './jwks.controller';
import { SigningKey } from './signing-key';

/** Issuing and verifying access tokens, the bearer-token and admin guards, and the JWKS endpoint. */
@Module({
  controllers: [JwksController],
  providers: [SigningKey, AccessTokenService, AccessTokenGuard, TenantAdminGuard, PlatformAdminGuard],
  exports: [AccessTokenService, AccessTokenGuard, TenantAdminGuard, PlatformAdminGuard],
})
export class AccessTokenModule {}
