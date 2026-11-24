import { BadRequestException } from '@nestjs/common';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

/** The parts of an Application Schema a lookup needs: Resource Types with their Actions. */
export interface SchemaRows {
  readonly name: string;
  readonly deprecatedAt: Date | null;
  readonly actions: readonly { readonly name: string; readonly deprecatedAt: Date | null }[];
}

/** Where a Permission's Action on a Resource Type stands in the Application Schema. */
export type SchemaUsage = 'active' | 'deprecated' | 'unknown';

/**
 * Answers whether an Action on a Resource Type is in an Application Schema and whether it is
 * Deprecated (itself, or through its Resource Type). Names match exactly, as they do in Access
 * Checks.
 */
export class SchemaIndex {
  private readonly deprecatedByKey = new Map<string, boolean>();

  constructor(resourceTypes: readonly SchemaRows[]) {
    for (const resourceType of resourceTypes) {
      for (const action of resourceType.actions) {
        const deprecated = resourceType.deprecatedAt !== null || action.deprecatedAt !== null;
        this.deprecatedByKey.set(SchemaIndex.key(resourceType.name, action.name), deprecated);
      }
    }
  }

  private static key(resourceType: string, action: string): string {
    return `${resourceType}\u0000${action}`;
  }

  private usage(resourceType: string, action: string): SchemaUsage {
    const deprecated = this.deprecatedByKey.get(SchemaIndex.key(resourceType, action));
    if (deprecated === undefined) return 'unknown';
    return deprecated ? 'deprecated' : 'active';
  }

  /** True when a Permission on this pair needs cleaning up: Deprecated, or no longer in the Schema. */
  needsCleanUp(resourceType: string, action: string): boolean {
    return this.usage(resourceType, action) !== 'active';
  }

  /**
   * Throws a 400 unless the pair is in the Schema, Deprecated or not: an Access Check may still ask
   * about a Deprecated entry, which existing Permissions can use.
   */
  assertKnown(resourceType: string, action: string): void {
    if (this.usage(resourceType, action) === 'unknown') {
      throw new BadRequestException(`"${action}" on "${resourceType}" is not in the Application Schema (names are case-sensitive)`);
    }
  }

  /** Throws unless a new Permission may use this pair: in the Schema and not Deprecated. */
  assertUsable(resourceType: string, action: string): void {
    const usage = this.usage(resourceType, action);
    if (usage === 'unknown') {
      throw new BadRequestException(`"${action}" on "${resourceType}" is not in the Application Schema`);
    }
    if (usage === 'deprecated') {
      throw new BadRequestException(`"${action}" on "${resourceType}" is Deprecated and can't be used in new Permissions`);
    }
  }
}

/** A client that can read Resource Types: PrismaService or a transaction. */
type SchemaReader = Pick<ScopedTransaction, 'resourceType'>;

/** The Schema index of each Application, keyed by Application ID; an unknown ID gets an empty one. */
export async function loadSchemaIndexes(
  client: SchemaReader,
  applicationIds: readonly string[],
): Promise<ReadonlyMap<string, SchemaIndex>> {
  const rows = await client.resourceType.findMany({
    where: { applicationId: { in: [...applicationIds] } },
    include: { actions: true },
  });
  const indexes = new Map<string, SchemaIndex>();
  for (const id of applicationIds) indexes.set(id, new SchemaIndex(rows.filter((row) => row.applicationId === id)));
  return indexes;
}

export async function loadSchemaIndex(client: SchemaReader, applicationId: string): Promise<SchemaIndex> {
  const indexes = await loadSchemaIndexes(client, [applicationId]);
  return indexes.get(applicationId) ?? new SchemaIndex([]);
}
