/**
 * Resource Type and Action names become CASL subjects and actions (ADR 0001), and Applications
 * send them in every Access Check. They are short identifiers: a letter, then letters, digits,
 * "_" or "-". Names are unique within their Application (Resource Types) or Resource Type
 * (Actions) ignoring case, so "Document" and "document" can't both exist.
 */
export const SCHEMA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const SCHEMA_NAME_RULE = 'must start with a letter and use only letters, digits, "_" or "-" (at most 64 characters)';

/** CASL gives these names special meaning ("manage" is every action, "all" every subject). */
export const RESERVED_ACTION_NAMES: readonly string[] = ['manage'];
export const RESERVED_RESOURCE_TYPE_NAMES: readonly string[] = ['all'];
