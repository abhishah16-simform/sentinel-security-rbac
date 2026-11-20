# Sentinel

A multi-tenant authorization and security compliance service. See [CONTEXT.md](CONTEXT.md) for the domain language and [`.scratch/sentinel/spec.md`](.scratch/sentinel/spec.md) for the specification.

## Requirements

- Node.js 22 (`nvm use` picks it up from `.nvmrc`)
- Docker with `docker-compose`

## Local setup

These steps use a **local PostgreSQL** on port 5432, connecting as the `postgres` user. To run Postgres in Docker instead, use `npm run db:up` (port 5433, password `postgres`) and point `DATABASE_URL` there.

1. Create the database (run once):

   ```bash
   sudo -u postgres createdb sentinel
   ```

2. Create a `.env` file in the project root, using your `postgres` password:

   ```bash
   cat > .env <<'ENV'
   PORT=3000
   DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/sentinel
   ENV
   ```

3. Generate the RSA key that signs access tokens. It is written to `keys/jwt-private.pem` (git-ignored), where the app looks by default:

   ```bash
   npm run keys:generate
   ```

4. Start the Mailpit mail catcher (inbox at <http://localhost:8025>):

   ```bash
   npm run mail:up
   ```

5. Install dependencies, apply migrations and start the app:

   ```bash
   npm install
   npm run prisma:deploy
   npm run start:dev
   ```

   Behind a TLS-inspecting proxy such as Zscaler, `npm install` fails when Prisma downloads its engines with `unable to get local issuer certificate`. Tell Node to trust the system certificates, then run the install again:

   ```bash
   export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
   ```

6. Open <http://localhost:3000> to sign up and log in, or <http://localhost:3000/v1/health> for the JSON health check. Verification emails land in Mailpit.

## Configuration

Only `DATABASE_URL` is required. Everything else has a local-development default.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | none | Postgres connection string |
| `APP_URL` | `http://localhost:$PORT` | Public base URL, used for links in emails |
| `JWT_PRIVATE_KEY_FILE` | `keys/jwt-private.pem` | PEM RSA private key (2048 bits or more) that signs access tokens |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | SMTP server (Mailpit in development) |
| `SMTP_USER` / `SMTP_PASSWORD` | none | SMTP credentials, if the server needs them |
| `MAIL_FROM` | `Sentinel <no-reply@sentinel.local>` | Sender of Sentinel's emails |
| `CORS_ALLOWED_ORIGINS` | none | Comma-separated origins allowed to call the API from a browser, such as an Application's login page. Temporary until Applications register their own origins (ticket 07) |

## Logging in and sessions

- `POST /v1/auth/signup`, `POST /v1/auth/verify-email` and `POST /v1/auth/resend-verification` handle signup and email verification. Passwords are hashed with argon2id.
- `POST /v1/auth/login` returns a 10-minute RS256 access token in the body and sets the refresh token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie whose path is `/v1/auth/refresh`, so the browser sends it nowhere else.
- `POST /v1/auth/refresh` swaps the cookie for a new refresh token and a new access token. Each refresh token works once. Presenting one that was already used revokes every refresh token from that login.
- `DELETE /v1/auth/refresh` logs out on this device. `POST /v1/auth/logout-all` (Bearer token) logs out everywhere.
- Applications verify access tokens with the public key at `/.well-known/jwks.json`. The key ID (`kid`) is the key's RFC 7638 thumbprint, so a new key always gets a new ID.
- [`http/auth.http`](http/auth.http) walks through the whole flow.

## MFA, lockout and password reset

- **MFA** is a 6-digit code emailed after the password. `POST /v1/me/mfa` turns it on (verified email required). Turning it off takes a current code: `POST /v1/me/mfa/disable-code`, then `POST /v1/me/mfa/disable` with `{ code }`.
- With MFA on, `POST /v1/auth/login` answers `{ mfaRequired: true, mfaToken, expiresIn }` instead of tokens. `POST /v1/auth/login/mfa` with `{ mfaToken, code }` finishes the login; `POST /v1/auth/login/mfa/resend` emails a new code.
- **Codes** are stored as SHA-256 hashes salted with their challenge ID, last 10 minutes, work once and allow 5 wrong guesses. A new code replaces the previous one, and can be requested at most once a minute and never while the account is locked. An MFA login attempt lasts 30 minutes, so a resent code always gets its full 10.
- **Lockout**: wrong passwords and codes are counted per User in `auth_failures`. The 5th within 15 minutes sets `users.lockedUntil` 15 minutes ahead, and login and code entry answer 429 until then. Only a completed login (or a password reset) clears the count, so a correct password alone can't reset it between code guesses. Password and code checks for one User run one at a time (a transaction-scoped advisory lock): a concurrent attempt gets 429 at once instead of slipping past the lock check. A locked account answers 429 rather than "Invalid email or password", which tells a guesser the address has an account; and a locked User can't finish a password reset until the lock ends.
- **Password reset**: `POST /v1/auth/password-reset` emails a link that works for an hour (it answers before the email is sent, so response time doesn't reveal whether the address has an account). The page it opens asks for a fresh code (`POST /v1/auth/password-reset/code`), then `POST /v1/auth/password-reset/complete` with `{ token, code, password }` sets the password and revokes every refresh token the User holds, in one transaction.
- All of it is recorded in the platform audit chain. Pages: the login page's code step, the Two-step verification card on the overview page, `/forgot-password.html` and `/reset-password.html`. [`http/mfa-reset.http`](http/mfa-reset.http) walks through it.

## Tenants and isolation

- `POST /v1/tenants` creates a Tenant; the caller becomes its first Tenant Admin. Only Users with a verified email may.
- `GET /v1/tenants` lists the caller's Tenants (the Tenant picker). `GET /v1/tenants/current` returns the Active Tenant.
- `PUT /v1/auth/refresh/active-tenant` with `{ "tenantId": "..." }` switches the Active Tenant. It uses the refresh-token cookie and returns new tokens in the same login, with `tid` and `mid` claims.
- Tenant isolation is enforced by Postgres Row-Level Security. Every Tenant-owned table has a `tenantId` column, and its migration must add, by hand, after `prisma migrate dev --create-only`:

  ```sql
  ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "x" FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON "x"
    USING ("tenantId" = app_current_tenant_id())
    WITH CHECK ("tenantId" = app_current_tenant_id());
  ```

- Tenant-scoped code runs through `ScopedPrisma.inTenant(tenantId, tx => ...)`, which sets `app.tenant_id` for that transaction before any query. At startup the app warns about any table with a `tenantId` column that is missing `ENABLE`, `FORCE` or a policy.
- RLS doesn't apply while the app connects as `postgres` (a superuser). See [Database user](#database-user).
- [`http/tenants.http`](http/tenants.http) walks through it.

## Audit Log

- Every authentication event and admin change goes through one writer (`AuditLog`), in the same transaction as the change it records. See `src/audit/audit-event-types.ts` for the event types.
- Entries are hash-chained: `hash = SHA-256(prevHash || canonical JSON of the entry)`, starting from 64 zeros. Each Tenant has its own chain. Events not tied to a Tenant (signup, verification, logins, logging out everywhere, profile changes, and later Platform Admin actions) go to the platform chain. Session events (refresh, reuse, logout) join the login's Active Tenant's chain once one is chosen.
- Writes to one chain are serialized by locking its row in `audit_chain_heads` until the transaction ends. The head also records the newest entry, so removing entries from the end is detected too.
- `audit_events` is the one table whose `tenantId` may be null (platform entries). RLS shows a Tenant's entries in its context, and platform entries only when no Tenant context is set. A trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`.
- Tenant Admins: `GET /v1/audit-events` (filters `from`, `to` (exclusive), `user` (ID or email, as actor or target), `eventType`, `applicationId`; paginated with `limit` and `cursor`), `GET /v1/audit-events/types` and `GET /v1/audit-events/integrity`, which reports the first broken link, if any. The console page is `/audit-log.html`.
- Platform Admins: `GET /v1/platform/audit-events` and `GET /v1/platform/audit-events/integrity` for the platform chain.
- The chain proves entries weren't changed, removed or inserted by anyone who can't also rewrite `audit_chain_heads`. A database superuser who rewinds the head after deleting the newest entries goes undetected; anchoring head hashes outside the database (in a signed export, say) would close that.
- [`http/audit.http`](http/audit.http) walks through it, including how to tamper with an entry to see the check fail.

## Commands

| Command | What it does |
|---|---|
| `npm run mail:up` | Start only Mailpit (when using a local PostgreSQL) |
| `npm run db:up` / `npm run db:down` | Start or stop Postgres and Mailpit in Docker |
| `npm run start:dev` | Run the app with reload on change |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Typecheck with `tsc --noEmit` |
| `npm run prisma:migrate` | Create a migration file and apply it (development) |
| `npm run prisma:deploy` | Apply existing migrations (deployment) |
| `npm run keys:generate` | Create the access-token signing key at `keys/jwt-private.pem` |

## Database user

The app and migrations both connect as the `postgres` user. Because `postgres` is a superuser, Postgres never applies Row-Level Security to it, so the app logs a warning at startup.
