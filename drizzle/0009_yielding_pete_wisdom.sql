ALTER TABLE "mint"."credit_ledger" ADD COLUMN "lots_processed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_ledger_unprocessed" ON "mint"."credit_ledger" USING btree ("account_id","created_at","id") WHERE not "mint"."credit_ledger"."lots_processed";--> statement-breakpoint
-- The opening lots already represent this ledger history.
UPDATE mint.credit_ledger SET lots_processed=true;
--> statement-breakpoint
UPDATE mint.units u SET credit_returned=l.amount FROM mint.credit_ledger l WHERE l.source='cancel:'||u.id AND l.amount>0;
