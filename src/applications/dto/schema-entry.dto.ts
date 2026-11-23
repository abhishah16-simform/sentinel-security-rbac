import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches } from 'class-validator';
import { SCHEMA_NAME_PATTERN, SCHEMA_NAME_RULE } from '../schema-names';

/** Actions that can be created together with a new Resource Type. */
const MAX_INITIAL_ACTIONS = 50;

export class AddResourceTypeDto {
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `name ${SCHEMA_NAME_RULE}` })
  name!: string;

  /** Actions to create on it at the same time. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_INITIAL_ACTIONS)
  @IsString({ each: true })
  @Matches(SCHEMA_NAME_PATTERN, { each: true, message: `each action ${SCHEMA_NAME_RULE}` })
  actions?: string[];
}

export class AddActionDto {
  @IsString()
  @Matches(SCHEMA_NAME_PATTERN, { message: `name ${SCHEMA_NAME_RULE}` })
  name!: string;
}
