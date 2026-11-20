# Sentinel

Multi-tenant authorization service: NestJS 11 + Prisma 6 + Postgres, static frontend in `public/`, API under `/v1`.

## Commands

- `nvm use` - always first; needs Node 22 (`.nvmrc`). Node 18 segfaults in argon2
- `npm run typecheck` / `npm run lint` / `npm run build` - run after every change; all must be clean
- `npm run start:dev` - dev server on `PORT` from `.env` (9800 locally)
- `npm run mail:up` - Mailpit; every email lands at http://localhost:8025 (API: `/api/v1/search?query=to:<email>`)
- `npm run keys:generate` - creates `keys/jwt-private.pem` (git-ignored); the app won't start without it
- `npx prisma migrate dev --create-only --name <name>` - for any migration that needs hand-written SQL (RLS)

## No automated tests

This project has no automated tests by the owner's choice. Do not add Jest, Supertest or any other test framework, test files or test scripts, even when a skill (such as `/implement` or `/tdd`) says to write or run tests. Verify work with typechecking, linting and the HTTP collection instead.

- Verify by running the app and exercising it with curl or the `http/*.http` collections; add or update a collection for each ticket
- For pages, drive headless Chrome (`/usr/bin/google-chrome`) with `playwright-core` installed in the scratchpad, never as a project dependency

## Ticket workflow

1. Read the ticket in `.scratch/sentinel/issues/NN-*.md`, plus `spec.md`, `CONTEXT.md` and the relevant ADRs
2. Implement, then run typecheck, lint and a manual API and browser check
3. Commit only this ticket's files; the owner may have uncommitted work in progress, so stage paths explicitly (never `git add -A` blindly)
4. Run `/code-review HEAD~1` with the ticket as the spec, fix the findings, and commit the fixes separately
5. Mark the ticket `**Status:** done` and tick its boxes (`.scratch/` is git-ignored)
6. Raise spec conflicts with the owner instead of silently deviating

## Architecture rules

- Modules: `access-token` (JWT, guards, JWKS), `audit` (writer `AuditModule`; console `AuditConsoleModule`), `identity`, `sessions`, `tenancy`, `mail`, `prisma`. Guards come from `AccessTokenModule` so modules don't import each other circularly
- A Tenant-owned table has a non-null `tenantId` column, and its migration must add `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy using `app_current_tenant_id()` (see README "Tenants and isolation")
- Platform-level tables must not have a column named `tenantId`; the startup RLS check treats any such table as Tenant-owned
- The one exception is `audit_events`: its `tenantId` is null for platform-chain entries, and a second policy shows those only when no Tenant context is set. Record events only through `AuditLog`
- Tenant-scoped queries go through `ScopedPrisma.inTenant()`; a User's own cross-Tenant reads go through `ScopedPrisma.asUser()`
- Endpoints that use the refresh cookie must live under `/v1/auth/refresh` (the cookie's path)

## Conventions

- Nest `HttpException`s for errors; no barrel files; `readonly` interface fields; `unknown` + narrowing, no `as` casts
- Imports: Node built-ins, then third-party, then local, sorted within each group (ESLint doesn't check this)
- Prisma maps table names to snake_case, but columns stay camelCase: quote them in raw SQL (`"userId"`)

## Gotchas

- `.env` and `prisma/migrations/**` are denied for Write/Edit. Append RLS SQL to a new, not-yet-applied migration with a shell command, and never touch applied ones
- Locally the app connects as the `postgres` superuser, so RLS is not enforced. Prove RLS with `SET LOCAL ROLE` to a non-superuser role that owns the table, inside a transaction you roll back
- Process env overrides `.env`, so pass test settings inline (`CORS_ALLOWED_ORIGINS=... node dist/main`)
- Stop the app by killing the process on its port; `pkill -f 'node dist/main'` also matches and kills the calling shell

## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` (glossary) and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
