/** A class-transformer @Transform that trims string values and leaves anything else for validation to reject. */
export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
