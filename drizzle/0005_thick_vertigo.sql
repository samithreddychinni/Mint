ALTER TABLE "mint"."items" ADD COLUMN "default_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mint"."profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "mint"."profiles" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mint"."items" ADD CONSTRAINT "default_quantity_range" CHECK ("mint"."items"."default_quantity" between 0 and 10000);