import type { Prisma } from '@prisma/client';
import type { SchemaIndex } from '../applications/schema-index';

export interface SchemaEntryView {
  readonly name: string;
  readonly deprecated: boolean;
}

export interface TenantResourceTypeView extends SchemaEntryView {
  readonly actions: readonly SchemaEntryView[];
}

interface SchemaRow {
  readonly name: string;
  readonly deprecatedAt: Date | null;
  readonly actions: readonly { readonly name: string }[];
}

/** The Application Schema as the Tenant console reads it; an Action counts as Deprecated with its Resource Type. */
export function toSchemaView(resourceTypes: readonly SchemaRow[], schema: SchemaIndex): TenantResourceTypeView[] {
  return resourceTypes.map((resourceType) => ({
    name: resourceType.name,
    deprecated: resourceType.deprecatedAt !== null,
    actions: resourceType.actions.map((action) => ({
      name: action.name,
      deprecated: schema.needsCleanUp(resourceType.name, action.name),
    })),
  }));
}

/** Resource Types with their Actions, alphabetically, for toSchemaView. */
export const SCHEMA_INCLUDE = {
  resourceTypes: { orderBy: { name: 'asc' }, include: { actions: { orderBy: { name: 'asc' } } } },
} as const satisfies Prisma.ApplicationInclude;
