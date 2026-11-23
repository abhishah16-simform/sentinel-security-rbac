import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trimString } from '../../common/transforms';
import { NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../identity/credential-limits';

/** The token from an Invitation link: "<tenantId>.<secret>". */
export class InvitationTokenDto {
  @IsString()
  @MaxLength(100)
  token!: string;
}

export class InvitationSignupDto extends InvitationTokenDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX_LENGTH)
  firstName!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX_LENGTH)
  lastName!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
