import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches } from 'class-validator';
import { SCHEMA_NAME_PATTERN, SCHEMA_NAME_RULE } from '../schema-names';

export class AddResourceTypeDto {
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `name ${SCHEMA_NAME_RULE}` })
  name!: string;

  /** Actions to create on it at the same time. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(SCHEMA_NAME_PATTERN, { each: true, message: `each action ${SCHEMA_NAME_RULE}` })
  actions?: string[];
}

export class AddActionDto {
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `name ${SCHEMA_NAME_RULE}` })
  name!: string;
}
