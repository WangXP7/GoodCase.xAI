CREATE TABLE "builds" (
	"id" serial PRIMARY KEY,
	"profile_id" integer NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY,
	"auth0_id" text NOT NULL UNIQUE,
	"username" text NOT NULL,
	"about" text DEFAULT '',
	"image" text DEFAULT '',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_profile_id_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;