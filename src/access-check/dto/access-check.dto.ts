import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { SCHEMA_NAME_PATTERN, SCHEMA_NAME_RULE } from '../../applications/schema-names';

/** Far longer than any access token Sentinel issues. */
const ACCESS_TOKEN_MAX_LENGTH = 4096;
const RESOURCE_ID_MAX_LENGTH = 256;

export class AccessCheckResourceDto {
  /** The Application's own ID for the resource; recorded in the Audit Log, never interpreted. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(RESOURCE_ID_MAX_LENGTH)
  id?: string;

  /** The attributes Conditions are matched against, such as { "ownerId": "…", "status": "open" }. */
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class AccessCheckDto {
  /** The User's Sentinel access token, with the Active Tenant the check is made in. */
  @IsString()
  @MinLength(1)
  @MaxLength(ACCESS_TOKEN_MAX_LENGTH)
  accessToken!: string;

  /** An Action of the Resource Type in the Application Schema, matched case-sensitively. */
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `action ${SCHEMA_NAME_RULE}` })
  action!: string;

  /** A Resource Type in the Application Schema, matched case-sensitively. */
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `resourceType ${SCHEMA_NAME_RULE}` })
  resourceType!: string;

  /** The resource asked about; omit when no Condition needs its attributes. */
  @IsOptional()
  @ValidateNested()
  @Type(() => AccessCheckResourceDto)
  resource?: AccessCheckResourceDto;
}
