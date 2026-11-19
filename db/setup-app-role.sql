-- Creates the restricted role the Sentinel app connects as, inside the current database.
-- It owns nothing, is not a superuser and cannot bypass Row-Level Security, so RLS
-- policies on tables owned by the owner role always apply to it.
--
-- psql variables (pass with -v): owner_role, app_role, app_password
-- Run while connected to the Sentinel database as a superuser.
\set ON_ERROR_STOP on

CREATE ROLE :"app_role" LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role') \gexec
GRANT USAGE ON SCHEMA public TO :"app_role";

-- Tables and sequences that migrations (run as the owner role) create later
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
