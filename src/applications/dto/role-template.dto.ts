import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { trimString } from '../../common/transforms';
import { SCHEMA_NAME_PATTERN, SCHEMA_NAME_RULE } from '../schema-names';

export const ROLE_NAME_MAX_LENGTH = 100;
export const ROLE_DESCRIPTION_MAX_LENGTH = 500;
/** More than any sensible Role needs; keeps a template's copy into a Tenant small. */
export const MAX_TEMPLATE_PERMISSIONS = 100;

/** An allow or deny Permission for an Action on a Resource Type, named as in the Application Schema. */
export class TemplatePermissionDto {
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `resourceType ${SCHEMA_NAME_RULE}` })
  resourceType!: string;

  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `action ${SCHEMA_NAME_RULE}` })
  action!: string;

  /** true for a Deny Rule. Defaults to false (allow). */
  @IsOptional()
  @IsBoolean()
  inverted?: boolean;
}

export class CreateRoleTemplateDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(ROLE_NAME_MAX_LENGTH)
  name!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(ROLE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  /** Permissions to create with it. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEMPLATE_PERMISSIONS)
  @ValidateNested({ each: true })
  @Type(() => TemplatePermissionDto)
  permissions?: TemplatePermissionDto[];
}

/** Rename a Role Template or change its description. */
export class UpdateRoleTemplateDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(ROLE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(ROLE_DESCRIPTION_MAX_LENGTH)
  description?: string;
}
