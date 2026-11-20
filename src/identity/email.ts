/** Emails are compared case-insensitively, so they are stored trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
