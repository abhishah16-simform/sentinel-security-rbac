-- This is an empty migration.-- The Invitations inbox is only for a verified email: an unverified account that took someone's
-- address must not see the Invitations sent to it. The users subquery relies on users having no RLS.
DROP POLICY own_invitations ON "invitations";
CREATE POLICY own_invitations ON "invitations"
  FOR SELECT
  USING ("email" = (
    SELECT u."email" FROM "users" u WHERE u."id" = app_current_user_id() AND u."emailVerifiedAt" IS NOT NULL
  ));
