import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** A Registered Resource's attributes are at most this long as JSON. */
export const MAX_ATTRIBUTES_LENGTH = 16384;
const MAX_DEPTH = 8;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(path: string, problem: string): BadRequestException {
  return new BadRequestException(`${path}: ${problem}`);
}

function jsonValue(value: unknown, path: string, depth: number): Prisma.InputJsonValue | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(path, 'expected a finite number');
    return value;
  }
  if (depth >= MAX_DEPTH) throw invalid(path, `attributes may nest at most ${MAX_DEPTH} levels deep`);
  if (Array.isArray(value)) return value.map((item: unknown, index) => jsonValue(item, `${path}[${index}]`, depth + 1));
  if (isRecord(value)) return jsonObject(value, path, depth + 1);
  throw invalid(path, 'expected a JSON value');
}

function jsonObject(value: Readonly<Record<string, unknown>>, path: string, depth: number): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) result[key] = jsonValue(item, `${path}.${key}`, depth);
  return result;
}

/**
 * Checks the attributes an Application sends and returns a copy to store: a JSON object of at most
 * MAX_ATTRIBUTES_LENGTH characters and MAX_DEPTH levels. They are the Application's data and are
 * never interpreted, only matched against Conditions as an Access Check's attributes are.
 */
export function parseAttributes(value: Readonly<Record<string, unknown>> | undefined): Prisma.InputJsonObject {
  if (value === undefined) return {};
  if (JSON.stringify(value).length > MAX_ATTRIBUTES_LENGTH) {
    throw invalid('attributes', `at most ${MAX_ATTRIBUTES_LENGTH} characters of JSON`);
  }
  return jsonObject(value, 'attributes', 0);
}

/** Stored attributes as the engine and the API take them; anything but an object reads as none. */
export function storedAttributes(value: Prisma.JsonValue): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}
