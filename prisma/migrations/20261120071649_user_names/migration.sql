-- Users created before names existed get empty strings; the default is dropped so new rows must supply both.
ALTER TABLE "users" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';

ALTER TABLE "users" ALTER COLUMN "firstName" DROP DEFAULT,
ALTER COLUMN "lastName" DROP DEFAULT;
