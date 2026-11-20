import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 12;
/** argon2 hashes any length, but a cap stops huge inputs being used to burn CPU. */
export const PASSWORD_MAX_LENGTH = 128;

export class SignupDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
