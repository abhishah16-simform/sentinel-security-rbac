import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../../identity/credential-limits';

export class InviteDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}
