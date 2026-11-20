import { IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../identity/dto/signup.dto';

/** No password-policy checks here: a login attempt must not reveal the policy. */
export class LoginDto {
  @IsString()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
