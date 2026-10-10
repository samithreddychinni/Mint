CREATE SCHEMA "mint";
--> statement-breakpoint
CREATE TABLE "mint"."credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"canteen_id" uuid NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "credit_nonnegative" CHECK ("mint"."credit_accounts"."available">=0 and "mint"."credit_accounts"."reserved">=0)
);
--> statement-breakpoint
CREATE TABLE "mint"."allowed_identities" (
	"email" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint"."batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"total" integer NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"committed" integer DEFAULT 0 NOT NULL,
	"waste" integer DEFAULT 0 NOT NULL,
	"reusable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_capacity" CHECK ("mint"."batches"."total">=0 and "mint"."batches"."held">=0 and "mint"."batches"."committed">=0 and "mint"."batches"."waste">=0 and "mint"."batches"."held"+"mint"."batches"."committed"+"mint"."batches"."waste"<="mint"."batches"."total")
);
--> statement-breakpoint
CREATE TABLE "mint"."canteens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"lat" text NOT NULL,
	"lng" text NOT NULL,
	"radius" integer NOT NULL,
	"max_accuracy" integer NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"demo" boolean DEFAULT true NOT NULL,
	"collection_minutes" integer DEFAULT 20 NOT NULL,
	CONSTRAINT "canteens_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "mint"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"source" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_source_unique" UNIQUE("source")
);
--> statement-breakpoint
CREATE TABLE "mint"."worker_health" (
	"name" text PRIMARY KEY NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "mint"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"versions" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint"."items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canteen_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"mode" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	CONSTRAINT "positive_price" CHECK ("mint"."items"."price">0),
	CONSTRAINT "item_mode" CHECK ("mint"."items"."mode" in ('ready','made'))
);
--> statement-breakpoint
CREATE TABLE "mint"."credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"order_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_source_unique" UNIQUE("source")
);
--> statement-breakpoint
CREATE TABLE "mint"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"payer_id" uuid NOT NULL,
	"canteen_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"total" integer NOT NULL,
	"credit" integer NOT NULL,
	"external" integer NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"provider_order" text,
	"payment_id" text,
	"hold_until" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"target_at" timestamp with time zone,
	"deadline" timestamp with time zone,
	"policy" text DEFAULT 'demo-credit-v1-25+5' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconcile_at" timestamp with time zone,
	CONSTRAINT "orders_reference_unique" UNIQUE("reference"),
	CONSTRAINT "orders_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "orders_provider_order_unique" UNIQUE("provider_order"),
	CONSTRAINT "orders_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "order_money" CHECK ("mint"."orders"."total">0 and "mint"."orders"."credit">=0 and "mint"."orders"."external">=0 and "mint"."orders"."credit"+"mint"."orders"."external"="mint"."orders"."total")
);
--> statement-breakpoint
CREATE TABLE "mint"."passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"order_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"versions" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passes_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "mint"."payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint"."profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "mint"."provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"payment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint"."resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"provider_refund" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolutions_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "mint"."roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"canteen_id" uuid NOT NULL,
	"station_id" uuid,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint"."stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canteen_id" uuid NOT NULL,
	"name" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mint"."stock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_events_source_unique" UNIQUE("source")
);
--> statement-breakpoint
CREATE TABLE "mint"."units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"credit" integer NOT NULL,
	"external" integer NOT NULL,
	"mode" text NOT NULL,
	"collector_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"arrived_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"collection_deadline" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"resolved" boolean DEFAULT false NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "units_token_unique" UNIQUE("token"),
	CONSTRAINT "unit_money" CHECK ("mint"."units"."credit">=0 and "mint"."units"."external">=0 and "mint"."units"."credit"+"mint"."units"."external"="mint"."units"."price"),
	CONSTRAINT "unit_state" CHECK ("mint"."units"."state" in ('pending','preparing','ready','collected','cancelled','expired'))
);
--> statement-breakpoint
ALTER TABLE "mint"."credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."credit_accounts" ADD CONSTRAINT "credit_accounts_canteen_id_canteens_id_fk" FOREIGN KEY ("canteen_id") REFERENCES "mint"."canteens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."batches" ADD CONSTRAINT "batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "mint"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."invitations" ADD CONSTRAINT "invitations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."invitations" ADD CONSTRAINT "invitations_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."invitations" ADD CONSTRAINT "invitations_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."items" ADD CONSTRAINT "items_canteen_id_canteens_id_fk" FOREIGN KEY ("canteen_id") REFERENCES "mint"."canteens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."items" ADD CONSTRAINT "items_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "mint"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."credit_ledger" ADD CONSTRAINT "credit_ledger_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "mint"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."credit_ledger" ADD CONSTRAINT "credit_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."credit_ledger" ADD CONSTRAINT "credit_ledger_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."orders" ADD CONSTRAINT "orders_payer_id_profiles_id_fk" FOREIGN KEY ("payer_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."orders" ADD CONSTRAINT "orders_canteen_id_canteens_id_fk" FOREIGN KEY ("canteen_id") REFERENCES "mint"."canteens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."passes" ADD CONSTRAINT "passes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."passes" ADD CONSTRAINT "passes_collector_id_profiles_id_fk" FOREIGN KEY ("collector_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."passes" ADD CONSTRAINT "passes_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "mint"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."resolutions" ADD CONSTRAINT "resolutions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."roles" ADD CONSTRAINT "roles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."roles" ADD CONSTRAINT "roles_canteen_id_canteens_id_fk" FOREIGN KEY ("canteen_id") REFERENCES "mint"."canteens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."roles" ADD CONSTRAINT "roles_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "mint"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."stations" ADD CONSTRAINT "stations_canteen_id_canteens_id_fk" FOREIGN KEY ("canteen_id") REFERENCES "mint"."canteens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."stock_events" ADD CONSTRAINT "stock_events_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "mint"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."stock_events" ADD CONSTRAINT "stock_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."units" ADD CONSTRAINT "units_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."units" ADD CONSTRAINT "units_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "mint"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."units" ADD CONSTRAINT "units_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "mint"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."units" ADD CONSTRAINT "units_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "mint"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."units" ADD CONSTRAINT "units_collector_id_profiles_id_fk" FOREIGN KEY ("collector_id") REFERENCES "mint"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_owner" ON "mint"."credit_accounts" USING btree ("user_id","canteen_id");--> statement-breakpoint
CREATE INDEX "batch_item" ON "mint"."batches" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "menu_canteen" ON "mint"."items" USING btree ("canteen_id");--> statement-breakpoint
CREATE INDEX "orders_payer" ON "mint"."orders" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "orders_expiry" ON "mint"."orders" USING btree ("state","hold_until");--> statement-breakpoint
CREATE INDEX "roles_user" ON "mint"."roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "station_names" ON "mint"."stations" USING btree ("canteen_id","name");--> statement-breakpoint
CREATE INDEX "units_order" ON "mint"."units" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "collector_units" ON "mint"."units" USING btree ("collector_id","order_id");--> statement-breakpoint
CREATE INDEX "station_worklist" ON "mint"."units" USING btree ("station_id","state");