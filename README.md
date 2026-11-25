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
- **Codes** are stored as SHA-256 hashes salted with their challenge ID, last 10 minutes, work once and allow 5 wrong attempts. A new code replaces the previous one, and can be requested at most once a minute and never while the account is locked. An MFA login attempt lasts 30 minutes, so a resent code always gets its full 10.
- **Lockout**: wrong passwords and codes are counted per User in `auth_failures`. The 5th within 15 minutes sets `users.lockedUntil` 15 minutes ahead, and login and code entry answer 429 until then. Only a completed login (or a password reset) clears the count, so a correct password alone can't reset it between code attempts. Password and code checks for one User run one at a time (a transaction-scoped advisory lock): a concurrent attempt gets 429 at once instead of slipping past the lock check. A locked account answers 429 rather than "Invalid email or password", which tells a guesser the address has an account; and a locked User can't finish a password reset until the lock ends.
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

## Invitations and Memberships

- Tenant Admins manage the Active Tenant under `/v1/tenants/current/`: `invitations` (list pending, `POST` to invite an email, `POST :id/resend`, `DELETE :id` to cancel) and `memberships` (list, `PATCH :id` with `{ "isTenantAdmin": bool }`, `DELETE :id`). The console page is `/members.html`.
- An Invitation lasts 7 days. Its emailed link is `/invitation.html#token=<tenantId>.<secret>`; only the secret's SHA-256 is stored, and resending replaces it. An email has at most one pending Invitation per Tenant (a partial unique index).
- The invited User answers from the inbox (`GET /v1/me/invitations`, `POST :id/accept` or `:id/decline`, page `/invitations.html`). Only accepting creates a Membership, and it needs a verified email. Someone without an account signs up from the link (`POST /v1/invitations/preview`, `POST /v1/invitations/signup`); the account starts verified, since the link reached the address, and joins the Tenant in the same transaction.
- `DELETE /v1/tenants/:tenantId/membership` leaves a Tenant.
- A change that would leave a Tenant with no Tenant Admin (removing the flag, removing or leaving) gets `409`. Each such change locks the Tenant row first, so concurrent changes can't both pass the check.
- The three lists are paginated like the Audit Log (`limit`, `cursor`, `nextCursor`): Memberships oldest first, Invitations newest first.
- `invitations` is Tenant-owned. Besides `tenant_isolation`, an `own_invitations` policy lets a User with a verified email read Invitations to that email under `ScopedPrisma.asUser()`; the inbox is refused (`403`) until the email is verified. Answering one switches the same transaction to the Invitation's Tenant context (`setTenantContext`) to write, as does signing up from a link, whose transaction also creates the User.
- Every change is recorded in the Tenant's audit chain (`invitation.*`, `membership.*`). [`http/invitations.http`](http/invitations.http) walks through it.

## Platform Admin and Applications

- A Platform Admin is a User with the Platform Admin flag and no Memberships. Create one after `npm run build` with `npm run platform-admin:create -- --email <email> --first-name <name> --last-name <name>`. The password comes from `PLATFORM_ADMIN_PASSWORD`, a hidden terminal prompt, or standard input. An email that already has an account is refused, so an existing User is never promoted.
- Platform Admin endpoints live under `/v1/platform/` and use plain `PrismaService`, never a Tenant context, so RLS keeps Tenant data out of reach. The one exception is the Tenant list's counts (see [Tenant list and suspension](#tenant-list-and-suspension)). `applications`, `resource_types` and `actions` are platform-level tables (no `tenantId`, no RLS).
- `POST /v1/platform/applications` registers an Application with a name and allowed origins (scheme, host and port only) and returns a client ID (`app_…`) and a client secret. The secret is shown once: only its SHA-256 is stored. `POST /v1/platform/applications/:id/secret` issues a new one, and the old one stops working at once.
- The Application Schema: `POST …/:id/resource-types` (with optional `actions`), `POST …/resource-types/:rtId/actions`, and `POST …/deprecate` on either. Entries are never removed. A Deprecated Resource Type makes its Actions count as Deprecated and takes no new Actions. Names are identifiers (a letter, then letters, digits, `_` or `-`), unique ignoring case; CASL's `manage` and `all` are reserved.
- Every Platform Admin action is recorded in the platform audit chain with the Application's ID. The console pages are `/platform-applications.html` and `/platform-application.html?id=…`, shown in a Platform section of the sidebar for Platform Admins only. [`http/platform-applications.http`](http/platform-applications.http) walks through it.

## Tenant list and suspension

- `GET /v1/platform/tenants` lists every Tenant for Platform Admins, newest first and paginated: name, Membership count, enabled Application count, creation date and `suspendedAt`. The counts are the only Tenant-owned reads: each is made through `ScopedPrisma.inTenant()` in that Tenant's own RLS context, and only the numbers are returned.
- `POST /v1/platform/tenants/:id/suspend` and `…/reactivate` set and clear `tenants.suspendedAt` (409 when already in that state), locking the Tenant row (switches and refreshes read it `FOR SHARE`, so none can slip past a suspension), and record `tenant.suspended` or `tenant.reactivated` in the platform chain.
- While a Tenant is suspended: switching into it gets `403`; a refresh of a login whose Active Tenant it is drops the Tenant from the login (the new access token has no `tid`, and the Tenant picker shows it as Suspended); `TenantAdminGuard` refuses its console at once, even with an unexpired access token; and every Access Check in it is denied with `tenant-suspended`. Its data is untouched, and Users can still leave it.
- The console page is `/platform-tenants.html`. [`http/platform-tenants.http`](http/platform-tenants.http) walks through it.

## Role Templates and Enablement

- Role Templates are default Roles an Application ships, kept in the platform-level `role_templates` and `role_template_permissions` tables. Platform Admins manage them under `/v1/platform/applications/:id/role-templates` (list, `POST`, `PATCH :tid` for name and description, `DELETE :tid`, `POST :tid/permissions`, `DELETE :tid/permissions/:pid`). A Permission is `{ resourceType, action, inverted }`, CASL's raw-rule shape; a new one must use Schema entries that aren't Deprecated. Changes lock the Application row, like Schema changes, and are recorded in the platform chain (`role_template.*`).
- Tenant Admins browse every registered Application at `GET /v1/tenants/current/applications` and enable or disable one with `POST …/:id/enable` and `POST …/:id/disable`. The console pages are `/applications.html` and `/application.html?id=…`.
- `enablements`, `roles` and `permissions` are Tenant-owned (RLS). The first enable creates the Enablement row and copies each Role Template into the Tenant as an ordinary Role, leaving out Permissions on Deprecated entries. The copies are never synced: later template changes don't reach them. Disabling sets `disabledAt` and keeps the Roles; enabling again clears it and copies nothing. Each change locks the Tenant row and holds the Application row `FOR SHARE`, so templates can't change mid-copy.
- A Permission whose Resource Type or Action is Deprecated keeps working but is flagged (`deprecated: true`) on both consoles, and the Applications list counts them per Application.
- Enablement changes are recorded in the Tenant's chain (`application.enabled`, `application.disabled`). The code lives in `src/access-rules/` (Tenant side), which imports the platform-level `applications` module, never the reverse. [`http/enablement-role-templates.http`](http/enablement-role-templates.http) walks through it.

## Roles and Permissions

- Tenant Admins manage their Tenant's Roles under `/v1/tenants/current/roles` (list with an optional `applicationId` filter, `POST`, `GET :id`, `PATCH :id` for name and description, `DELETE :id`, `POST :id/permissions`, `DELETE :id/permissions/:pid`). `GET /v1/tenants/current/permissions` lists every Permission in the Tenant, filterable by `applicationId` and `resourceType`. The console pages are `/roles.html`, `/role.html?id=…` and `/permissions.html`.
- Creating a Role or adding a Permission needs the Application enabled (409 otherwise). Renaming, deleting and removing Permissions also work while it is disabled, so a Tenant can clean up. Role names are unique within an Application ignoring case; every change locks the Tenant row, and adding a Permission also holds the Application row `FOR SHARE` so its Schema entry can't be Deprecated at the same moment.
- A Permission is `{ resourceType, action, inverted, conditions }`. Conditions are CASL/Mongo-style JSON, checked on save by `parseConditions()` in `src/access-rules/conditions.ts`: only the operators CASL's default matcher evaluates (`$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$nin`, `$all`, `$size`, `$exists`, `$elemMatch`); no `$regex` or `$options`; no `$and`, `$or`, `$nor` or `$not`, which CASL reads as attribute names, so they would never match (use one Permission per alternative); attribute paths are dotted identifiers; the only placeholders are `${user.id}`, `${membership.id}` and `${tenant.id}`, each as a whole string value. The result must also compile with CASL's own matcher. An empty object means no Condition.
- The JSON body parser refuses any `__proto__` key (`src/common/json-body.ts`): copying a body into a DTO drops such keys silently, which would let part of a Condition vanish and widen its Permission.
- Every change is recorded in the Tenant's chain (`role.created`, `role.updated`, `role.deleted`, `role.permission_added`, `role.permission_removed`) with the Permission written out, Condition included. [`http/roles-permissions.http`](http/roles-permissions.http) walks through it.

## Role Assignments

- Tenant Admins give Roles to Memberships under `/v1/tenants/current/role-assignments` (list newest first, filterable by `membershipId`, `roleId`, `applicationId` and `status`; `POST` with `{ membershipId, roleId, expiresAt? }`; `GET :id`; `POST :id/revoke`). `GET /v1/tenants/current/memberships/:id/effective-permissions` shows every Permission a Membership holds now, by Application, flagging allows that an unconditional deny of the same Action always beats. The console page is `/role-assignments.html`, linked from each member on `/members.html`.
- A Role Assignment applies across the whole Tenant. Assigning needs the Role's Application enabled (409 otherwise), and a Membership can't hold the same Role twice at once. `expiresAt` (with a time zone, in the future, within 10 years) makes it a Temporary Role Assignment.
- `role_assignments` is Tenant-owned (RLS) and rows are never deleted. Active means not revoked and `expiresAt` empty or later than now (`activeAssignmentWhere()` in `src/access-rules/role-assignment-ending.ts`); every reader that decides access applies it itself, so an assignment stops counting at exactly its expiry time whether or not the Scheduler has marked it yet.
- Revoking sets `revokedAt` and `endReason`. Deleting a Role or removing a Membership (or leaving) revokes its active assignments in the same transaction (`endReason` `ROLE_DELETED` or `MEMBERSHIP_ENDED`), then the foreign key is set to null; the row keeps the User, Application and Role name for reports and Access Reviews. Any new path that deletes a Membership or Role (such as erasure) must call `endRoleAssignments()` the same way; as a backstop, a row whose Membership or Role is gone never counts as active.
- Every change is recorded in the Tenant's chain (`role_assignment.created`, `role_assignment.revoked` with `reason`), targeting the User so the Audit Log's user filter finds it. [`http/role-assignments.http`](http/role-assignments.http) walks through it.

## Scheduler and expiring access

- One `@nestjs/schedule` cron job runs every minute (`src/scheduler/`). It only records what time has already decided; no access decision waits for it. A run still going when the next minute starts is skipped on that instance.
- It marks Temporary Role Assignments whose expiry time has passed (not revoked, not yet marked) by setting `expiryRecordedAt`, and writes `role_assignment.expired` (no actor, `expiresAt` in the payload) to that Tenant's chain, in the same transaction (`RoleAssignmentExpiry` in `src/access-rules/role-assignment-expiry.ts`). RLS hides Role Assignments outside a Tenant context, so it walks the Tenant list and works inside each Tenant in turn, taking the Tenant lock only when something is due. A marked row is never picked again, so a repeated or concurrent run (another instance) changes nothing more; a Tenant that fails is logged and retried next minute.
- Tenant Admins see the report at `GET /v1/tenants/current/reports/expiring-role-assignments?withinDays=7` (active Temporary Role Assignments expiring within the look-ahead window, 1 to 365 days, default 7, soonest first) and `GET /v1/tenants/current/reports/expired-role-assignments` (most recently expired first). Both are paginated and keyed on `expiresAt`. The console page is `/expiring-access.html`; [`http/expiry-report.http`](http/expiry-report.http) walks through it.

## Access Checks

- An Application asks `POST /v1/access-checks` with its client ID and secret over HTTP Basic (`ClientCredentialsGuard` in `src/applications/client-credentials.guard.ts`, 401 with a `WWW-Authenticate` challenge otherwise) and a body of `{ accessToken, action, resourceType, resource?: { id?, attributes? } }`, where `accessToken` is the User's Sentinel access token with an Active Tenant. The answer is `200 { allowed, reason }`, plus `roleId` and `permissionId` for `matched-allow` and `matched-deny`. The other reasons are `no-matching-permission`, `tenant-suspended`, `application-not-enabled` and `no-membership`.
- An Action or Resource Type outside the Application Schema is a 400, not a deny. Names match exactly, so `invoice` against `Invoice` is a 400. Deprecated entries can still be asked about, because existing Permissions may use them. An invalid or expired access token is a 401, and a token without an Active Tenant is a 400.
- Order: the Application is authenticated, then the User's token is verified, then, inside one transaction in the token's Tenant, the Schema is checked (so an unknown Action is a 400 even for a suspended Tenant: it's a bug in the Application, not a question), then the Tenant (`tenants.suspendedAt`; ticket 12 adds the endpoints that set it), the Enablement, the Membership (the token's `mid`, which must still exist for that User), and the Permissions of the Membership's active Role Assignments in this Application. Then the engine runs and the Audit Log entry is written. Everything is read fresh from Postgres, so a Temporary Role Assignment stops counting at exactly its expiry time.
- The engine, `evaluateAccess()` in `src/access-check/access-check-engine.ts`, is a pure function with no HTTP or Prisma. It replaces placeholder values (`${user.id}`, `${membership.id}`, `${tenant.id}`, only as whole strings) in a copy of each Condition, adds all allows before all denies so a matching Deny Rule always wins, and asks CASL for the rule that decides the request. If no Permission matches, including when there are no Roles, the answer is deny.
- Every Access Check is written to the Tenant's Audit Log as `access_check.allowed` or `access_check.denied`, with the Membership, Action, Resource Type, resource ID, reason and deciding Role and Permission. The resource's attributes are not stored. Requests refused with a 400 or 401 never become Access Checks and aren't recorded. These entries are unchained (`AuditLog.recordUnchainedIn()`: no `seq` or hashes, and no chain-head lock), so concurrent checks don't queue, and integrity verification skips them. [`http/access-checks.http`](http/access-checks.http) walks through the whole flow.
- Tenant Admins can try one from the console at `/test-access.html` (linked from each member on `/members.html`): `POST /v1/tenants/current/test-access` with `{ membershipId, applicationId, action, resourceType, resource? }` runs the same gates and engine for one of the Tenant's Memberships and returns the same answer, without the client secret. An unknown Membership or Application is a 404. A test isn't an Access Check, so it isn't written to the Audit Log. [`http/test-access.http`](http/test-access.http) shows it.

## Registered Resources

- An Application tells Sentinel about specific resources with its client ID and secret over HTTP Basic, under `/v1/registered-resources/:tenantId`: `PUT :resourceType/:resourceId` with `{ "attributes": { ... } }` registers one (`201`) or replaces its attributes (`200`), `GET` reads it, `DELETE` removes it (`204`), and `GET` on the Tenant lists the Application's own, newest first (`resourceType` filter). `resourceId` is the Application's own ID, URL-encoded in the path, as it sends in an Access Check's `resource.id`.
- The Tenant must have the Application enabled; otherwise, or for an unknown Tenant, it is a `403`. A Resource Type outside the Application Schema is a `400`; Deprecated ones are accepted. Attributes are a JSON object of at most 16 KiB and 8 levels.
- Each change is in the Tenant's audit chain with no actor (`registered_resource.created`, `.updated` with the changed attribute names, `.deleted`); attribute values are left out. A `PUT` that changes nothing writes nothing.
- `registered_resources` is Tenant-owned (RLS).
- Tenant Admins see them at `/registered-resources.html`: `GET /v1/tenants/current/registered-resources` (filters `applicationId`, `resourceType`, `resourceId`) and `GET .../:id`. They can also register one by hand from that page: `POST /v1/tenants/current/registered-resources` with `{ applicationId, resourceType, resourceId, attributes? }` (`201`; `409` if already registered or the Application isn't enabled, `404` for an unknown Application, `400` for a Resource Type outside its Schema). Its audit entry has the Tenant Admin as actor; keeping attributes current is still the Application's job. The access-by-Registered-Resource report, `GET .../:id/access` and the page `/registered-resource.html?id=`, runs the Access Check gates and engine for each Membership with an active Role in the resource's Application (oldest first, paginated), for each Action of its Resource Type, against the stored attributes. Each answer is the Access Check's `{ allowed, reason, roleId?, permissionId? }`; `deniedBecause` names a suspension or missing Enablement that denies them all.
- [`http/registered-resources.http`](http/registered-resources.http) walks through it.

## Audit Log

- Every authentication event, admin change and Access Check goes through one writer (`AuditLog`), in the same transaction as the change it records. See `src/audit/audit-event-types.ts` for the event types.
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
