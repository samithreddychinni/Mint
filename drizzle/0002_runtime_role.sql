DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mint_backend') THEN CREATE ROLE mint_backend NOLOGIN; END IF; END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA mint TO mint_backend;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA mint TO mint_backend;
--> statement-breakpoint
REVOKE ALL ON mint.allowed_identities FROM mint_backend;
--> statement-breakpoint
GRANT SELECT ON mint.allowed_identities TO mint_backend;
--> statement-breakpoint
DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='mint' LOOP EXECUTE format('CREATE POLICY mint_server_access ON mint.%I FOR ALL TO mint_backend USING (true) WITH CHECK (true)',r.tablename); END LOOP; END $$;
