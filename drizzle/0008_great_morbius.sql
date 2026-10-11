LOCK TABLE mint.credit_accounts,mint.credit_ledger,mint.orders IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE "mint"."credit_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"source" text NOT NULL,
	"order_id" uuid,
	"available" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"expired" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credit_lots_source_unique" UNIQUE("source"),
	CONSTRAINT "credit_lot_nonnegative" CHECK ("mint"."credit_lots"."available">=0 and "mint"."credit_lots"."reserved">=0 and "mint"."credit_lots"."expired">=0)
);
--> statement-breakpoint
CREATE TABLE "mint"."credit_reservations" (
	"order_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "credit_reservations_order_id_lot_id_pk" PRIMARY KEY("order_id","lot_id"),
	CONSTRAINT "credit_reservation_positive" CHECK ("mint"."credit_reservations"."amount">0)
);
--> statement-breakpoint
ALTER TABLE "mint"."units" ADD COLUMN "credit_returned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mint"."units" ADD COLUMN "missed_pickup_fine" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mint"."credit_lots" ADD CONSTRAINT "credit_lots_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "mint"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."credit_lots" ADD CONSTRAINT "credit_lots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."credit_reservations" ADD CONSTRAINT "credit_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "mint"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint"."credit_reservations" ADD CONSTRAINT "credit_reservations_lot_id_credit_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "mint"."credit_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_lots_account_expiry" ON "mint"."credit_lots" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE INDEX "credit_lots_due" ON "mint"."credit_lots" USING btree ("expires_at") WHERE "mint"."credit_lots"."available">0;--> statement-breakpoint
ALTER TABLE "mint"."units" ADD CONSTRAINT "unit_return" CHECK ("mint"."units"."credit_returned">=0 and "mint"."units"."missed_pickup_fine">=0 and "mint"."units"."credit_returned"+"mint"."units"."missed_pickup_fine"<="mint"."units"."price");
--> statement-breakpoint
ALTER TABLE mint.credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE mint.credit_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mint.credit_lots,mint.credit_reservations FROM public,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON mint.credit_lots,mint.credit_reservations TO mint_backend;
CREATE POLICY mint_server_access ON mint.credit_lots FOR ALL TO mint_backend USING(true) WITH CHECK(true);
CREATE POLICY mint_server_access ON mint.credit_reservations FOR ALL TO mint_backend USING(true) WITH CHECK(true);
--> statement-breakpoint
-- Existing balances get a full grace period; past refunds are not reduced.
INSERT INTO mint.credit_lots(account_id,source,available,reserved,expires_at)
SELECT id,'legacy:'||id,available,reserved,clock_timestamp()+interval '30 days'
FROM mint.credit_accounts WHERE available+reserved>0;
--> statement-breakpoint
INSERT INTO mint.credit_reservations(order_id,lot_id,amount)
SELECT o.id,l.id,o.credit FROM mint.orders o JOIN mint.credit_accounts a ON a.user_id=o.payer_id AND a.canteen_id=o.canteen_id JOIN mint.credit_lots l ON l.account_id=a.id
WHERE o.state='pending' AND o.credit>0;
