/**
 * Every kind of Audit Log entry Sentinel writes, with the label the console shows for it.
 * Event types are stored as these strings, so never rename one: add a new type instead.
 */
export const AUDIT_EVENT_TYPES = {
  'user.signed_up': 'Signed up',
  'user.email_verified': 'Verified email address',
  'user.profile_updated': 'Updated profile',
  'user.mfa_enabled': 'Turned on MFA',
  'user.mfa_disabled': 'Turned off MFA',
  'user.password_reset_requested': 'Requested password reset',
  'user.password_reset': 'Reset password',
  'auth.login_succeeded': 'Logged in',
  'auth.login_failed': 'Failed login',
  'auth.email_code_sent': 'Sent email code',
  'auth.email_code_failed': 'Entered wrong email code',
  'auth.account_locked': 'Locked account',
  'auth.token_refreshed': 'Refreshed session',
  'auth.refresh_token_reused': 'Reused refresh token',
  'auth.logged_out': 'Logged out',
  'auth.logged_out_everywhere': 'Logged out everywhere',
  'tenant.created': 'Created Tenant',
  'tenant.switched': 'Switched Active Tenant',
} as const;

export type AuditEventType = keyof typeof AUDIT_EVENT_TYPES;

export const AUDIT_EVENT_TYPE_NAMES: readonly string[] = Object.keys(AUDIT_EVENT_TYPES);

export function isAuditEventType(value: string): value is AuditEventType {
  return Object.hasOwn(AUDIT_EVENT_TYPES, value);
}
