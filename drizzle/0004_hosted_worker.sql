CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
--> statement-breakpoint
REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated, mint_backend;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC, anon, authenticated, mint_backend;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated, mint_backend;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mint.dispatch_worker() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  worker_url text;
  worker_secret text;
  stamp text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO worker_url FROM vault.decrypted_secrets WHERE name = 'mint_worker_url';
  SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name = 'mint_worker_auth';
  IF worker_url IS NULL OR worker_secret IS NULL THEN
    RAISE EXCEPTION 'MINT hosted worker settings are not configured';
  END IF;
  stamp := floor(extract(epoch FROM clock_timestamp()))::bigint::text;
  SELECT net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mint-worker-time', stamp,
      'x-mint-worker-signature', encode(extensions.hmac(stamp, worker_secret, 'sha256'), 'hex')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  ) INTO request_id;
  RETURN request_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mint.dispatch_worker() FROM PUBLIC, anon, authenticated, mint_backend;
