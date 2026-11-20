import { IsString, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH } from '../../identity/credential-limits';

/** No password-policy checks here: a login attempt must not reveal the policy. */
export class LoginDto {
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
