ALTER TABLE "profiles" ADD COLUMN "display_name" text DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_unique" ON "profiles" ("username");