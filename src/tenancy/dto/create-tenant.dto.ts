import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const TENANT_NAME_MAX_LENGTH = 100;

export class CreateTenantDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(TENANT_NAME_MAX_LENGTH)
  name!: string;
}
