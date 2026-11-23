import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_TEMPLATE_PERMISSIONS,
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  TemplatePermissionDto,
} from '../../applications/dto/role-template.dto';
import { SCHEMA_NAME_PATTERN, SCHEMA_NAME_RULE } from '../../applications/schema-names';
import { PageQuery } from '../../common/pagination';
import { trimString } from '../../common/transforms';

/** Permissions per Role, the same cap as a Role Template. */
export const MAX_ROLE_PERMISSIONS = MAX_TEMPLATE_PERMISSIONS;

/**
 * An allow or deny Permission, optionally limited by a Condition: a CASL/Mongo-style query on the
 * resource's attributes. The Condition's contents are checked by parseConditions().
 */
export class RolePermissionDto extends TemplatePermissionDto {
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown> | null;
}

export class CreateRoleDto {
  /** An Application the Active Tenant has enabled. */
  @IsUUID()
  applicationId!: string;

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
  @ArrayMaxSize(MAX_ROLE_PERMISSIONS)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionDto)
  permissions?: RolePermissionDto[];
}

/** Rename a Role or change its description. */
export class UpdateRoleDto {
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

export class RoleListQuery extends PageQuery {
  /** Only this Application's Roles. */
  @IsOptional()
  @IsUUID()
  applicationId?: string;
}

export class PermissionListQuery extends PageQuery {
  /** Only Permissions in this Application's Roles. */
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  /** Only Permissions on this Resource Type. */
  @IsOptional()
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `resourceType ${SCHEMA_NAME_RULE}` })
  resourceType?: string;
}
