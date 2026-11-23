import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { trimString } from '../../common/transforms';
import { NAME_MAX_LENGTH } from '../credential-limits';

/** Fields a User may change on their own profile. Omitted fields are left as they are. */
export class UpdateProfileDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX_LENGTH)
  firstName?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX_LENGTH)
  lastName?: string;
}
