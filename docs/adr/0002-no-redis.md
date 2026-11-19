# No Redis: token-based sessions are revoked when the token expires

The original stack included Redis, but Sentinel runs on Postgres alone. There is no rule cache and no token deny-list. Access Checks read Memberships, Role Assignments and Tenant status from Postgres every time, so removing a Membership, revoking a Role Assignment or suspending a Tenant affects Access Checks immediately. A User's existing access token, however, stays valid for Sentinel's own API until it expires, which takes at most 10 minutes. We accepted that delay to keep one fewer moving part in a portfolio project.

## Consequences

- Brute-force protection for logins and email MFA codes must come from Postgres, for example counters with a lockout, not from a Redis rate limiter.
- Making access tokens last longer also makes revocation slower. The token lifetime is a security setting, not just a convenience.
- An Application that trusts the JWT alone, without asking Sentinel, gets the same 10-minute delay. Applications should use an Access Check for anything sensitive.
