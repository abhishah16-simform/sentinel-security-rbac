import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { MfaCodeDto } from '../identity/dto/email-code.dto';
import { UpdateProfileDto } from '../identity/dto/update-profile.dto';
import { IdentityService, type UserProfile } from '../identity/identity.service';
import { MfaService } from '../identity/mfa.service';

/** The logged-in User's own profile and MFA setting. */
@Controller('me')
@UseGuards(AccessTokenGuard)
export class MeController {
  constructor(
    private readonly identity: IdentityService,
    private readonly mfa: MfaService,
  ) {}

  @Get()
  me(@CurrentClaims() claims: AccessTokenClaims): Promise<UserProfile> {
    return this.identity.getProfile(claims.sub);
  }

  @Patch()
  update(@CurrentClaims() claims: AccessTokenClaims, @Body() body: UpdateProfileDto): Promise<UserProfile> {
    return this.identity.updateProfile(claims.sub, body);
  }

  /** Switch email-code MFA on. Needs a verified email. */
  @Post('mfa')
  @HttpCode(HttpStatus.OK)
  async enableMfa(@CurrentClaims() claims: AccessTokenClaims): Promise<UserProfile> {
    await this.mfa.enable(claims.sub);
    return this.identity.getProfile(claims.sub);
  }

  /** Email a code that confirms switching MFA off. */
  @Post('mfa/disable-code')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendMfaDisableCode(@CurrentClaims() claims: AccessTokenClaims): Promise<{ readonly message: string }> {
    await this.mfa.sendDisableCode(claims.sub);
    return { message: 'We emailed you a 6-digit code.' };
  }

  /** Switch MFA off with a current code from mfa/disable-code. */
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  async disableMfa(@CurrentClaims() claims: AccessTokenClaims, @Body() body: MfaCodeDto): Promise<UserProfile> {
    await this.mfa.disable(claims.sub, body.code);
    return this.identity.getProfile(claims.sub);
  }
}
