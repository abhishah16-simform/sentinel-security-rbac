import { Prisma } from '@prisma/client';

/** True when a Prisma write failed because it would break a unique constraint. */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
