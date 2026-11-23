import { mongoQueryMatcher } from '@casl/ability';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * The only placeholders a Condition may use. Each must be a whole string value; the Access Check
 * fills them in before it builds the CASL ability, never by substituting into evaluated code.
 */
export const CONDITION_PLACEHOLDERS: readonly string[] = ['${user.id}', '${membership.id}', '${tenant.id}'];

/** A stored Condition is at most this long as JSON. */
export const MAX_CONDITION_LENGTH = 4096;
const MAX_DEPTH = 8;
const MAX_LIST_LENGTH = 100;
const MAX_STRING_LENGTH = 500;

/**
 * Exactly the operators CASL's default mongoQueryMatcher evaluates, except $regex and its $options:
 * a pattern from a Tenant Admin could make every Access Check slow (ReDoS).
 */
const FIELD_OPERATORS: readonly string[] = [
  '$eq',
  '$ne',
  '$lt',
  '$lte',
  '$gt',
  '$gte',
  '$in',
  '$nin',
  '$all',
  '$size',
  '$exists',
  '$elemMatch',
];
const REGEX_OPERATORS: readonly string[] = ['$regex', '$options'];

/**
 * MongoDB's logical operators. CASL's default matcher doesn't implement them: it reads "$or" as an
 * attribute name, so a Condition using one never matches, and a Deny Rule built on it would deny
 * nothing. Rejected with an explanation; write one Permission per alternative instead.
 */
const UNSUPPORTED_LOGICAL_OPERATORS: readonly string[] = ['$and', '$or', '$nor', '$not'];

/** One segment of a dotted attribute path, such as "owner" in "owner.id", or an array index. */
const FIELD_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
/** Segments that would reach an attribute object's prototype rather than its own data. */
const FORBIDDEN_SEGMENTS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

type Primitive = string | number | boolean | null;

function invalid(path: string, problem: string): BadRequestException {
  return new BadRequestException(`${path}: ${problem}`);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function plainObject(value: unknown, path: string, expected: string): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw invalid(path, expected);
  return value;
}

function checkDepth(path: string, depth: number): void {
  if (depth > MAX_DEPTH) throw invalid(path, `Conditions may nest at most ${MAX_DEPTH} levels deep`);
}

function placeholderProblem(value: string): string | null {
  if (!value.includes('${') || CONDITION_PLACEHOLDERS.includes(value)) return null;
  return `unknown placeholder in "${value}"; use one of ${CONDITION_PLACEHOLDERS.join(', ')} as the whole value`;
}

function primitive(value: unknown, path: string): Primitive {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(path, 'numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw invalid(path, `strings may be at most ${MAX_STRING_LENGTH} characters`);
    const problem = placeholderProblem(value);
    if (problem) throw invalid(path, problem);
    return value;
  }
  throw invalid(path, 'expected a string, number, boolean or null');
}

function primitiveList(value: unknown, path: string): Primitive[] {
  if (!Array.isArray(value)) throw invalid(path, 'expected a list');
  if (value.length > MAX_LIST_LENGTH) throw invalid(path, `lists may have at most ${MAX_LIST_LENGTH} items`);
  return value.map((item: unknown, index) => primitive(item, `${path}[${index}]`));
}

function checkFieldPath(field: string, path: string): void {
  const segments = field.split('.');
  for (const segment of segments) {
    if (!FIELD_SEGMENT.test(segment)) {
      throw invalid(path, `"${field}" is not a valid attribute path (letters, digits, "_" or "-", joined by ".")`);
    }
    if (FORBIDDEN_SEGMENTS.includes(segment)) throw invalid(path, `"${segment}" can't be used in an attribute path`);
  }
}

function unknownOperator(operator: string, path: string): BadRequestException {
  if (REGEX_OPERATORS.includes(operator)) return invalid(path, `${operator} is not allowed in Conditions`);
  if (UNSUPPORTED_LOGICAL_OPERATORS.includes(operator)) {
    return invalid(path, `${operator} is not supported in Conditions; add one Permission per alternative instead`);
  }
  return invalid(path, `unknown operator "${operator}"`);
}

/** True when every key is a field operator, so the object compares a value rather than naming attributes. */
function isOperatorMap(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key.startsWith('$'));
}

/** { $gte: 3, $lt: 10 }: operators applied to one attribute. */
function operatorMap(value: Readonly<Record<string, unknown>>, path: string, depth: number): Prisma.InputJsonObject {
  checkDepth(path, depth);
  const entries = Object.entries(value);
  if (entries.length === 0) throw invalid(path, 'expected at least one operator');
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [operator, operand] of entries) {
    const at = `${path}.${operator}`;
    if (!FIELD_OPERATORS.includes(operator)) throw unknownOperator(operator, at);
    result[operator] = operatorOperand(operator, operand, at, depth);
  }
  return result;
}

function operatorOperand(
  operator: string,
  operand: unknown,
  path: string,
  depth: number,
): Prisma.InputJsonValue | null {
  switch (operator) {
    case '$eq':
    case '$ne':
      return primitive(operand, path);
    case '$lt':
    case '$lte':
    case '$gt':
    case '$gte':
      if (typeof operand !== 'string' && typeof operand !== 'number') throw invalid(path, 'expected a string or number');
      return primitive(operand, path);
    case '$in':
    case '$nin':
    case '$all':
      return primitiveList(operand, path);
    case '$size':
      if (typeof operand !== 'number' || !Number.isInteger(operand) || operand < 0) {
        throw invalid(path, 'expected a whole number of at least 0');
      }
      return operand;
    case '$exists':
      if (typeof operand !== 'boolean') throw invalid(path, 'expected true or false');
      return operand;
    case '$elemMatch': {
      const query = plainObject(operand, path, 'expected a non-empty object');
      if (Object.keys(query).length === 0) throw invalid(path, 'expected a non-empty object');
      return isOperatorMap(query) ? operatorMap(query, path, depth + 1) : conditionObject(query, path, depth + 1);
    }
    default:
      throw unknownOperator(operator, path);
  }
}

/** { status: "open", "owner.id": "${user.id}" }: attributes, all of which must match. */
function conditionObject(value: Readonly<Record<string, unknown>>, path: string, depth: number): Prisma.InputJsonObject {
  checkDepth(path, depth);
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, operand] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (key.startsWith('$')) {
      if (FIELD_OPERATORS.includes(key)) throw invalid(at, `${key} must be applied to an attribute, as in { "status": { "${key}": … } }`);
      throw unknownOperator(key, at);
    }
    checkFieldPath(key, at);
    result[key] = fieldValue(operand, at, depth);
  }
  return result;
}

function fieldValue(value: unknown, path: string, depth: number): Prisma.InputJsonValue | null {
  if (Array.isArray(value)) throw invalid(path, 'to compare with a list, use $in, $nin or $all');
  if (!isPlainObject(value)) return primitive(value, path);
  if (!isOperatorMap(value)) {
    throw invalid(path, 'expected a value or an object of operators; reach nested attributes with a dotted path such as "owner.id"');
  }
  return operatorMap(value, path, depth + 1);
}

/**
 * Checks a Condition from a Tenant Admin and returns a clean copy to store, or null for none (an
 * empty object counts as none). Throws a 400 naming the first problem: anything that isn't one of
 * CASL's Mongo-style operators, $regex, a placeholder other than the three allowed, or a value CASL
 * itself would refuse when an Access Check runs.
 */
export function parseConditions(value: unknown): Prisma.InputJsonObject | null {
  if (value === undefined || value === null) return null;
  const object = plainObject(value, 'conditions', 'expected a JSON object');
  if (JSON.stringify(object).length > MAX_CONDITION_LENGTH) {
    throw invalid('conditions', `a Condition may be at most ${MAX_CONDITION_LENGTH} characters of JSON`);
  }
  const conditions = conditionObject(object, 'conditions', 0);
  if (Object.keys(conditions).length === 0) return null;
  try {
    mongoQueryMatcher(conditions);
  } catch (error: unknown) {
    throw invalid('conditions', error instanceof Error ? error.message : 'CASL could not read this Condition');
  }
  return conditions;
}
