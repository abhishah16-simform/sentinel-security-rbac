import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../credential-limits';

const SIX_DIGITS = /^\d{6}$/;
const CODE_MESSAGE = 'code must be the 6 digits from your email';
/** Opaque tokens are 43 base64url characters; the cap only stops oversized input. */
const TOKEN_MAX_LENGTH = 128;

/** A code that confirms switching MFA off. */
export class MfaCodeDto {
  @Matches(SIX_DIGITS, { message: CODE_MESSAGE })
  code!: string;
}

/** The second step of an MFA login. */
export class LoginMfaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX_LENGTH)
  mfaToken!: string;

  @Matches(SIX_DIGITS, { message: CODE_MESSAGE })
  code!: string;
}

/** Asks for a new login code for the same login attempt. */
export class ResendMfaCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX_LENGTH)
  mfaToken!: string;
}

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}

/** The token from the reset link, to have a code emailed. */
export class PasswordResetCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;
}

export class CompletePasswordResetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;

  @Matches(SIX_DIGITS, { message: CODE_MESSAGE })
  code!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
