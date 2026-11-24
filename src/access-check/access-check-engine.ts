import { createMongoAbility, type MongoAbility, type MongoQuery, type RawRuleOf } from '@casl/ability';

/** One Permission the Membership holds through an active Role Assignment, as stored (ADR 0001). */
export interface EnginePermission {
  readonly id: string;
  readonly roleId: string;
  readonly action: string;
  readonly resourceType: string;
  /** true for a Deny Rule. */
  readonly inverted: boolean;
  /** A Condition checked when it was saved (parseConditions), or null for none. */
  readonly conditions: unknown;
}

/** Who is asking: the values the Condition placeholders stand for. */
export interface EngineContext {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenantId: string;
}

/** What is being asked. */
export interface EngineRequest {
  readonly action: string;
  readonly resourceType: string;
  /** The resource's attributes, which Conditions are matched against. */
  readonly attributes: Readonly<Record<string, unknown>>;
}

export type EngineDecision =
  | {
      readonly allowed: boolean;
      readonly reason: 'matched-allow' | 'matched-deny';
      readonly roleId: string;
      readonly permissionId: string;
    }
  | { readonly allowed: false; readonly reason: 'no-matching-permission' };

/** Subjects are Resource Type names, or resource attribute objects of the requested Resource Type. */
type Ability = MongoAbility<[string, string | Readonly<Record<string, unknown>>]>;
type Rule = RawRuleOf<Ability>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A copy of a stored Condition with every placeholder value replaced by what it stands for. Only a
 * string that is exactly a placeholder is replaced, as data: nothing is ever evaluated.
 */
function fillPlaceholders(value: unknown, values: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return values.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item: unknown) => fillPlaceholders(item, values));
  if (isRecord(value)) {
    const filled: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) filled[key] = fillPlaceholders(item, values);
    return filled;
  }
  return value;
}

function conditionsOf(permission: EnginePermission, values: ReadonlyMap<string, string>): MongoQuery | undefined {
  const filled = fillPlaceholders(permission.conditions, values);
  return isRecord(filled) && Object.keys(filled).length > 0 ? filled : undefined;
}

/**
 * The Access Check engine: may this Membership perform this Action on a resource of this Resource
 * Type, given the Permissions of its active Role Assignments in one Application? Pure: it knows
 * nothing about HTTP or the database, and the caller has already filtered out revoked and expired
 * Role Assignments and checked the Tenant, Enablement and Membership.
 *
 * All allows are added before all denies; CASL gives later rules priority, so a matching Deny Rule
 * always wins over a matching allow. With no matching Permission (or no Roles at all) the answer is
 * deny.
 */
export function evaluateAccess(
  permissions: readonly EnginePermission[],
  context: EngineContext,
  request: EngineRequest,
): EngineDecision {
  const values = new Map<string, string>([
    ['${user.id}', context.userId],
    ['${membership.id}', context.membershipId],
    ['${tenant.id}', context.tenantId],
  ]);
  const relevant = permissions.filter(
    (permission) => permission.action === request.action && permission.resourceType === request.resourceType,
  );
  const ordered = [...relevant.filter((permission) => !permission.inverted), ...relevant.filter((permission) => permission.inverted)];

  const permissionOf = new Map<Rule, EnginePermission>();
  const rules = ordered.map((permission): Rule => {
    const rule: Rule = {
      action: permission.action,
      subject: permission.resourceType,
      inverted: permission.inverted,
      conditions: conditionsOf(permission, values),
    };
    permissionOf.set(rule, permission);
    return rule;
  });

  // String subjects (ADR 0001): every object asked about is of the requested Resource Type.
  const ability: Ability = createMongoAbility<Ability>(rules, { detectSubjectType: () => request.resourceType });
  // A copy, so nothing CASL does to the object can reach the caller's attributes.
  const matched = ability.relevantRuleFor(request.action, { ...request.attributes });
  const permission = matched ? permissionOf.get(matched.origin) : undefined;
  if (!matched || !permission) return { allowed: false, reason: 'no-matching-permission' };
  return {
    allowed: !matched.inverted,
    reason: matched.inverted ? 'matched-deny' : 'matched-allow',
    roleId: permission.roleId,
    permissionId: permission.id,
  };
}
