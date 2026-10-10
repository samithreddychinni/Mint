REVOKE ALL ON SCHEMA mint FROM public, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA mint FROM public, anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA mint REVOKE ALL ON TABLES FROM public, anon, authenticated;
--> statement-breakpoint
DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='mint' LOOP EXECUTE format('ALTER TABLE mint.%I ENABLE ROW LEVEL SECURITY',r.tablename); END LOOP; END $$;
--> statement-breakpoint
CREATE FUNCTION mint.before_user_created(event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE address text:=lower(event->'user'->>'email');
BEGIN
 IF split_part(address,'@',2)='cb.students.amrita.edu' OR EXISTS(SELECT 1 FROM mint.allowed_identities WHERE email=address) THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Use your approved university student email. Staff accounts are provisioned by an administrator.'));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mint.before_user_created(jsonb) FROM public, anon, authenticated;
--> statement-breakpoint
GRANT USAGE ON SCHEMA mint TO supabase_auth_admin;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mint.before_user_created(jsonb) TO supabase_auth_admin;
--> statement-breakpoint
REVOKE ALL ON SCHEMA mint_migrations FROM public, anon, authenticated;
