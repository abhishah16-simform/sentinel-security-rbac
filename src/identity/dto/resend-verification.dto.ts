import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../credential-limits';

export class ResendVerificationDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}
