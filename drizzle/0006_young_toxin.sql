ALTER TABLE "mint"."items" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mint"."items" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;