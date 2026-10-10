# MINT deployment

## Hosting

- Vercel hosts the PWA at `https://mint-campus-demo.vercel.app`.
- Render hosts the existing Next.js API as a Node 22 web service.
- Vercel forwards `/api/*` to the Render HTTPS origin using a `beforeFiles` rewrite. Browser requests retain the Vercel origin and session cookies.
- Supabase remains the database, Auth service, SMTP configuration, and durable scheduler.
- Supabase Cron dispatches the signed worker request every 30 seconds. Point its URL at Render after Render passes health checks.

There is no new database or migration required for the hosting change. Keep the existing restricted database role and verified TLS certificate.

## Runtime configuration

`APP_URL` is the Vercel browser origin on both hosts. Set `BACKEND_URL` only on Vercel; leave it unset on Render to avoid proxy loops. Set `DATABASE_SSL_CA_FILE=certs/supabase-ca.crt` on both hosts.

Render needs `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `WORKER_AUTH_SECRET` from the ignored local runtime configuration. Do not upload migration URLs, Supabase administrative tokens, SMTP secrets, demo passwords, or the complete local environment file.

The same repository builds on both hosts. Vercel's API rewrite runs before the bundled API handlers. Runtime environment validation still requires the server variables during the Next.js build.

The Render settings are recorded in `render.yaml`: Singapore region, Node 22.22.2, `npm ci --include=dev && npm run build`, `npm run start -- --port $PORT`, and `/api/health`.

## Deploy and verify

1. Run typecheck, lint, build, and `tests/deployment-config.test.ts`.
2. Scan the Git upload for actual configured credentials. Commit and push only application files to the existing private repository.
3. Create the Render service with the selected runtime variables. Wait for a successful build and `/api/health` response.
4. Set `BACKEND_URL` to the actual Render origin. Run the existing Vercel configuration script and deploy.
5. Verify the Vercel health response reports the same Render commit. Check cookie creation, authenticated requests, logout, origin rejection, scoped stock updates, and worker authentication.
6. Update Supabase's worker URL using `scripts/configure-hosted-worker.ts` with `BACKEND_URL` in its process environment. Keep the existing signing secret.
7. Confirm scheduled executions update the worker heartbeat. Do not claim scheduler success from a manual request alone.
8. Verify Razorpay merchant webhook delivery and university-email OTP using the approved provider settings.

## Release limits

The currently available Razorpay credentials are test keys. Existing canteen locations and menus are demo configuration. A public deployment does not make these live campus settings.

Render's free plan can sleep and has resource limits. An always-on paid service requires an agreed spending limit. A real campus launch also needs surveyed geofences, live payment configuration, and physical-device verification.

## Deployment record

Deployment is in progress. Replace this paragraph with the actual Render URL, deployed commit, verified checks, and remaining blockers after the hosts are live.
