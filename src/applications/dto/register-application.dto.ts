import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export const APPLICATION_NAME_MAX_LENGTH = 100;
export const MAX_ALLOWED_ORIGINS = 20;

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class RegisterApplicationDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(APPLICATION_NAME_MAX_LENGTH)
  name!: string;

  /** Browser origins such as https://app.example.com. Each is checked and normalized by the service. */
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_ORIGINS)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  allowedOrigins!: string[];
}
