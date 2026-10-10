# MINT deployment

## Hosting

- Vercel hosts the PWA at `https://mint-campus-demo.vercel.app`.
- Render hosts the existing Next.js API at `https://mint-api-nlqd.onrender.com` as a Node 22 web service in Singapore. Service: `srv-db577s142hec73fv33rg` in the personal workspace, Free plan.
- Vercel forwards `/api/*` to the Render HTTPS origin using a `beforeFiles` rewrite. Browser requests retain the Vercel origin and session cookies.
- Supabase remains the database, Auth service, SMTP configuration, and durable scheduler.
- Supabase Cron dispatches the signed worker request every 30 seconds. Point its URL at Render after Render passes health checks.

There is no new database or migration required for the hosting change. Keep the existing restricted database role and verified TLS certificate. Use the shared **session** pooler on port 5432 for this persistent backend. Do not force port 6543: Postgres.js pipelining is incompatible with the shared transaction pooler and caused observed stalls and mismatched results. See [Supabase's Postgres.js guidance](https://supabase.com/docs/guides/database/postgres-js).

## Runtime configuration

`APP_URL` is the Vercel browser origin on both hosts. Set `BACKEND_URL` only on Vercel; leave it unset on Render to avoid proxy loops. Set `DATABASE_SSL_CA_FILE=certs/supabase-ca.crt` on both hosts.

Render needs `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `WORKER_AUTH_SECRET` from the ignored local runtime configuration. Do not upload migration URLs, Supabase administrative tokens, SMTP secrets, demo passwords, or the complete local environment file.

The same repository builds on both hosts. Vercel's API rewrite runs before the bundled API handlers. Runtime environment validation still requires the server variables during the Next.js build.

The Render settings are recorded in `render.yaml`: Singapore region, Node 22.22.2, `npm ci --include=dev && npm run build`, and `npm run start -- --port $PORT`. Render uses its default TCP liveness probe. `/api/health` separately verifies database access and reports the Render Git commit; check it through both hostnames. The original HTTP probe exceeded Render's five-second deadline during the pooler failure and temporarily removed the service from traffic.

## Deploy and verify

1. Run typecheck, lint, build, and `tests/deployment-config.test.ts`.
2. Scan the Git upload for actual configured credentials. Commit and push only application files to the existing private repository.
3. Create the Render service with the selected runtime variables. Wait for a successful build and `/api/health` response.
4. Set `BACKEND_URL` to the actual Render origin. Run the existing Vercel configuration script and deploy.
5. Verify the Vercel health response reports the same Render commit. Check cookie creation, authenticated requests, logout, origin rejection, scoped stock updates, and worker authentication.
6. Update Supabase's worker URL using `scripts/configure-hosted-worker.ts` with `BACKEND_URL` in its process environment. Keep the existing signing secret.
7. Confirm scheduled executions update the worker heartbeat. Do not claim scheduler success from a manual request alone.
8. Verify Razorpay merchant webhook delivery and university-email OTP using the approved provider settings.

Use `BACKEND_URL=https://mint-api-nlqd.onrender.com` when running `scripts/deploy-config.ts` and `scripts/configure-hosted-worker.ts` with `npx tsx --env-file=.env.local`. The configuration script must retain the session-pooler port. Then deploy with `vercel deploy --prod --yes --archive=tgz`.

The merchant test webhook URL is `https://mint-campus-demo.vercel.app/api/payments/webhook`. Enable `payment.captured` and `order.paid`, with the same webhook secret as the backend. The user confirmed this setting was saved. A manually signed event proves endpoint processing, but does not prove provider-origin delivery.

Connected browser checks consume labelled demo credit and stock. Confirm the browser-payer fixture has enough same-canteen credit before the credit-only flow. Do not run diagnostic logout against the same account during another test: Supabase's default logout revokes that account's other sessions. Wait for Render rollouts to finish before running payment or handover checks.

## Release limits

The currently available Razorpay credentials are test keys, and menus remain demo data. Canteen centres now use the user's supplied campus map pins. Their radii and GPS tolerance need physical verification before campus launch.

Render's free plan can sleep and has resource limits. An always-on paid service requires an agreed spending limit. A real campus launch also needs surveyed geofences, live payment configuration, and physical-device verification.

## Deployment record

Initial application code commit: `02df618`. Initial Vercel deployment: `dpl_AgWgEsSoA4dXdHe1m3QaByGLfRYL`. Both hosts have completed builds, and the stable Vercel alias forwards API requests to Render. `/api/health` reports the current backend revision.

Verified: typecheck, lint, production build, API rewrite test, secure HttpOnly session cookies through the proxy, student/serving/manager roles, assigned-canteen stock controls, same-value stock update and idempotent retry, CSRF rejection, logout, signed worker authentication, scheduled worker heartbeat, and actual university-email OTP delivery and verification. The production dependency audit reported zero known vulnerabilities; development tooling still reports nine advisories.

After the session-pooler rollout, all 21 isolated frontend browser checks passed against the public deployment. The connected credit-checkout flow passed delegation, separate app check-ins, station passes, partial handovers, preparation start/ready, and collection of all three portions. A fresh Razorpay test payment was captured and confirmed by the deployed server, followed by app check-in and a scoped handover recorded through the serving UI. Six simultaneous catalogue/health reads returned consistent data, with a maximum observed duration of 792 ms; this is a smoke check, not a load-capacity benchmark.

Merchant-origin webhook delivery remains unverified: the user confirmed the webhook is enabled, but no provider event for the fresh payment reached `mint.provider_events`. Callback verification and scheduled reconciliation worked. Check the merchant Test Mode delivery log for the HTTP status; do not infer delivery from a confirmed payment.

Physical camera/GPS, installed Android/iOS behavior, sustained load, closed-checkout recovery on a phone, live payment credentials, and surveyed campus configuration remain outside the verified results. Runtime values were inadvertently included in a private diagnostic tool read during deployment; they were not committed. Rotate affected runtime/payment/webhook/worker secrets before a real campus launch.

## Arrival and installation correction

A valid pickup-pass scan by an assigned serving account now records arrival automatically, then shows the permitted portions. Arrival applies to that collector's outstanding portions across counters in the same order and canteen. It excludes friends' assignments. Repeat scans do not extend collection deadlines, and expired/revoked/wrong-counter passes cannot record arrival. Handover remains a separate confirmation of the portions actually given. A reference/email lookup alone does not establish arrival.

The production geofences replace synthetic coordinates with the user-provided centres:

| Canteen | Latitude | Longitude | Radius |
|---|---|---|---|
| Main | 10.9001514 | 76.9036917 | 65 m |
| IT | 10.9049225 | 76.8980684 | 55 m |
| MBA / ASB | 10.9046257 | 76.9022447 | 75 m |

All three retain a 25 m maximum reported GPS accuracy. Fresh foreground location, the server clock, and the uncertainty circle still determine check-in. These map pins are configured and read back through the public API; they are not a physical GPS survey.

Chrome's native installation event depends on browser eligibility and engagement. The automatic popup waits for that event or 30 idle seconds, then provides Android Chrome menu instructions when native installation is unavailable. Dismissal lasts seven days. The old permanent dismissal is expired. See [Chrome install criteria](https://web.dev/articles/install-criteria). A simulated native event verifies UI handling, not installation on a physical phone.

Correction release: `453866f`, Vercel deployment `dpl_MfxeC42uSu3FRcSPwVZ7d3r4mCSP`. Both public health endpoints returned this backend revision. Typecheck, lint, and production build passed. All 23 isolated frontend checks passed against the public host, including a real QR decoder fed a synthetic camera stream. Four focused database checks passed for scan/location arrival, collector scope, repeated scans, revoked/expired passes, and the final deadline. A live labelled-demo-credit workflow verified outside-location rejection, scan arrival across counters, unchanged retry deadlines, preserved preparation tokens, complete scoped handovers, and accepted geolocation at the configured Main centre. Chrome's manifest and installability diagnostics returned no errors. The user confirmed installation works in Chrome on a OnePlus Nord 2. Physical GPS, camera scanning, and installed-app layout remain unverified.

## Shared pickup and staff refinements — 11 October 2026

Release `f7c5aa7` is deployed on Render and Vercel; both public health endpoints returned that backend revision. The additive `0005_thick_vertigo` migration was applied with verified TLS. All 26 isolated frontend checks passed locally, and nine focused database workflows passed with cleanup. Build, typecheck, lint, and the database security advisor passed; the advisor returned no findings.

A public API workflow using labelled demo accounts and same-canteen credit verified accepted-friend pickup without payer matching, collector identity preserved on first scan, hidden payer receipt for the recipient, unchanged arrival on repeated scans, staff responses without phone numbers, private profile save, and complete collection of the demo order. No bank payment was used for this check. The serving UI hides pasted QR and reference lookup in camera recovery; `Pending items` contains preparation jobs. Managers can open name, price, note, availability status, and default quantity from a pencil. Existing holds and paid portions remain protected. Student profile onboarding stores name and phone privately; the number is not SMS verified. Student updates are in-app progress and invitations, not background push.

The user clarified that their location check was from an academic block, outside the canteen. That rejection is expected; no geofence boundary or eligibility rule was changed. Physical GPS at a canteen and physical camera behavior still require device verification. Campus delivery is proposal-only; see `docs/frontend/CAMPUS_DELIVERY_PROPOSAL.md`. No delivery fee or reward is active.

## Order speed and manager dashboard, 11 October 2026

The release adds independent order-detail loading, parallel database reads, a compact manager sales endpoint and the manager Dashboard tab. Dashboard reports online orders only and uses India-time day boundaries. Existing stock editing, collector rights, geofence and payment rules remain intact. No schema migration, hosting-plan change or delivery implementation is required.

The baseline warm API measurements were catalogue 428–637 ms, account 1365–1543 ms and order detail 1658–1745 ms across three samples each. Previous navigation waited for these sequentially. Local verification passed: production build, TypeScript, lint, 28 isolated browser checks, and four focused database workflow checks. The expiry check also covers overdue payment holds. Feature release `13c0e6b` is live on Render and Vercel deployment `dpl_2YiwSjC5yWiaDS7SV8D3iVdx1pA7`. Both health endpoints returned this release. All 28 isolated browser checks passed on the public host; the connected serving and manager checks passed too, including the actual manager dashboard at phone and desktop widths. Database security advisors and the production dependency audit reported zero findings.

Three warm public-host samples after release:

| Endpoint | Before (ms) | After (ms) | Median before → after |
| --- | --- | --- | --- |
| Catalogue | 428–637 | 269–296 | 434 → 273 ms |
| Account | 1365–1543 | 948–1242 | 1410 → 1010 ms |
| Order detail | 1658–1745 | 798–841 | 1675 → 828 ms |

Order API median latency fell by approximately 51%. Order navigation also no longer waits for catalogue and account reads before requesting details. These are three-sample warm measurements from the test client, with demo records; they are not a load test or an Android timing guarantee. Free Render cold starts are outside this baseline.
