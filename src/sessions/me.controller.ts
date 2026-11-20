import { Controller, Get, UseGuards } from '@nestjs/common';
import { IdentityService, type UserProfile } from '../identity/identity.service';
import type { AccessTokenClaims } from './access-token.service';
import { AccessTokenGuard, CurrentClaims } from './access-token.guard';

/** The logged-in User's own profile. */
@Controller('me')
@UseGuards(AccessTokenGuard)
export class MeController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  me(@CurrentClaims() claims: AccessTokenClaims): Promise<UserProfile> {
    return this.identity.getProfile(claims.sub);
  }
}
