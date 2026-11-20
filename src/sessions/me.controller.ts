import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { UpdateProfileDto } from '../identity/dto/update-profile.dto';
import { IdentityService, type UserProfile } from '../identity/identity.service';

/** The logged-in User's own profile. */
@Controller('me')
@UseGuards(AccessTokenGuard)
export class MeController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  me(@CurrentClaims() claims: AccessTokenClaims): Promise<UserProfile> {
    return this.identity.getProfile(claims.sub);
  }

  @Patch()
  update(@CurrentClaims() claims: AccessTokenClaims, @Body() body: UpdateProfileDto): Promise<UserProfile> {
    return this.identity.updateProfile(claims.sub, body);
  }
}
