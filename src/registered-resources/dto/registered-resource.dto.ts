import { IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SCHEMA_NAME_PATTERN, SCHEMA_NAME_RULE } from '../../applications/schema-names';
import { PageQuery } from '../../common/pagination';

/** The same limit as an Access Check's resource.id. */
export const RESOURCE_ID_MAX_LENGTH = 256;

/** Where an Application keeps one of its Registered Resources: a Tenant, a Resource Type and its own ID. */
export class RegisteredResourcePath {
  /** A Tenant that has enabled the Application, such as a User access token's tid claim. */
  @IsUUID()
  tenantId!: string;

  /** A Resource Type in the Application Schema, matched case-sensitively. */
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `resourceType ${SCHEMA_NAME_RULE}` })
  resourceType!: string;

  /** The Application's own ID for the resource (URL-encoded in the path). */
  @IsString()
  @MinLength(1)
  @MaxLength(RESOURCE_ID_MAX_LENGTH)
  resourceId!: string;
}

/** The Tenant an Application lists its Registered Resources in. */
export class RegisteredResourceTenantPath {
  @IsUUID()
  tenantId!: string;
}

export class PutRegisteredResourceDto {
  /** The attributes Conditions are matched against, replacing any stored before; omit for none. */
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

/** An Application's own list, newest first. */
export class ApplicationResourceListQuery extends PageQuery {
  @IsOptional()
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `resourceType ${SCHEMA_NAME_RULE}` })
  resourceType?: string;
}

/** The Tenant Admin's list, newest first. */
export class TenantResourceListQuery extends ApplicationResourceListQuery {
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  /** Only resources with exactly this ID. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(RESOURCE_ID_MAX_LENGTH)
  resourceId?: string;
}
