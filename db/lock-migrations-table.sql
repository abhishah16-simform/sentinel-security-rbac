-- Prisma's own bookkeeping table picks up the app role's default privileges.
-- The app never needs it, so revoke every grant on it except the owner's.
DO $$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
      AND grantee <> current_user
  LOOP
    EXECUTE format('REVOKE ALL ON public._prisma_migrations FROM %I', grantee_name);
  END LOOP;
END $$;
