import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Put, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import {
  CompletePasswordResetDto,
  LoginMfaDto,
  PasswordResetCodeDto,
  RequestPasswordResetDto,
  ResendMfaCodeDto,
} from '../identity/dto/email-code.dto';
import { MfaService } from '../identity/mfa.service';
import { PasswordResetService } from '../identity/password-reset.service';
import { LoginDto } from './dto/login.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import { SessionsService, type SessionTokens } from './sessions.service';

interface AccessTokenResponse {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
}

/** With MFA on, login answers with this instead of tokens; send the token back with the code. */
interface MfaRequiredResponse {
  readonly mfaRequired: true;
  readonly mfaToken: string;
  readonly expiresIn: number;
}

interface MessageResponse {
  readonly message: string;
}

function respondWithTokens(res: Response, tokens: SessionTokens): AccessTokenResponse {
  setRefreshCookie(res, tokens.refreshToken);
  return { accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn };
}

/**
 * Uses the refresh-token cookie to get new tokens and sets the replacement cookie. A rejected
 * refresh token is cleared from the browser.
 */
async function withRefreshCookie(
  req: Request,
  res: Response,
  issue: (refreshToken: string) => Promise<SessionTokens>,
): Promise<AccessTokenResponse> {
  const refreshToken = readRefreshCookie(req);
  if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
  try {
    return respondWithTokens(res, await issue(refreshToken));
  } catch (error: unknown) {
    if (error instanceof UnauthorizedException) clearRefreshCookie(res);
    throw error;
  }
}

@Controller('auth')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /** Email and password. Returns tokens, or with MFA on, an mfaToken while a code is emailed. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse | MfaRequiredResponse> {
    const result = await this.sessions.login(body.email, body.password);
    if (result.kind === 'mfa-required') return { mfaRequired: true, ...result.challenge };
    return respondWithTokens(res, result.tokens);
  }

  /** The second step of an MFA login: the 6-digit code from the email. */
  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  async loginMfa(@Body() body: LoginMfaDto, @Res({ passthrough: true }) res: Response): Promise<AccessTokenResponse> {
    return respondWithTokens(res, await this.sessions.completeMfaLogin(body.mfaToken, body.code));
  }

  @Post('login/mfa/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendMfaCode(@Body() body: ResendMfaCodeDto): Promise<MessageResponse> {
    await this.mfa.resendLoginCode(body.mfaToken);
    return { message: 'A new code is on its way.' };
  }

  /** Step 1 of a password reset: email a reset link. Same answer whether or not the email has an account. */
  @Post('password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() body: RequestPasswordResetDto): MessageResponse {
    this.passwordReset.requestInBackground(body.email);
    return { message: 'If that address has an account, a reset link is on its way.' };
  }

  /** Step 2: from the page the link opens, email a fresh code. */
  @Post('password-reset/code')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendPasswordResetCode(@Body() body: PasswordResetCodeDto): Promise<MessageResponse> {
    await this.passwordReset.sendCode(body.token);
    return { message: 'We emailed you a 6-digit code.' };
  }

  /** Step 3: the link's token, the code and the new password. Logs the User out everywhere. */
  @Post('password-reset/complete')
  @HttpCode(HttpStatus.OK)
  async completePasswordReset(@Body() body: CompletePasswordResetDto): Promise<MessageResponse> {
    await this.sessions.resetPassword(body.token, body.code, body.password);
    return { message: 'Your password is changed and every session is logged out. Log in with the new password.' };
  }

  /** Silent refresh: swaps the refresh-token cookie for a new one and a new access token. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AccessTokenResponse> {
    return withRefreshCookie(req, res, (refreshToken) => this.sessions.refresh(refreshToken));
  }

  /**
   * Switch the Active Tenant. Lives under the refresh path because it uses the refresh-token
   * cookie: the login's chain moves to the new Tenant and a new token pair is issued in it.
   */
  @Put('refresh/active-tenant')
  @HttpCode(HttpStatus.OK)
  switchTenant(
    @Req() req: Request,
    @Body() body: SwitchTenantDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    return withRefreshCookie(req, res, (refreshToken) => this.sessions.switchTenant(refreshToken, body.tenantId));
  }

  /** Log out: revokes the refresh token in the cookie (and the rest of its login's chain). */
  @Delete('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) await this.sessions.logout(refreshToken);
    clearRefreshCookie(res);
  }

  /** Log out everywhere: revokes every refresh token the User holds. */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard)
  async logoutEverywhere(@CurrentClaims() claims: AccessTokenClaims, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.logoutEverywhere(claims.sub);
    clearRefreshCookie(res);
  }
}
