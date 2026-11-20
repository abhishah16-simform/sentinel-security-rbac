/** RFC 5321 caps an email address at 254 characters. */
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 12;
/** argon2 hashes any length, but a cap stops huge inputs being used to burn CPU. */
export const PASSWORD_MAX_LENGTH = 128;
