import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';
import { trimString } from '../../common/transforms';

export const APPLICATION_NAME_MAX_LENGTH = 100;
export const MAX_ALLOWED_ORIGINS = 20;
/** Longer than any real origin; the service checks the format. */
const ORIGIN_MAX_LENGTH = 200;

export class RegisterApplicationDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(APPLICATION_NAME_MAX_LENGTH)
  name!: string;

  /** Browser origins such as https://app.example.com. Each is checked and normalized by the service. */
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_ORIGINS)
  @IsString({ each: true })
  @MaxLength(ORIGIN_MAX_LENGTH, { each: true })
  allowedOrigins!: string[];
}
