# Local development

This guide covers local setup and the checks most contributors need. Read the [system architecture](architecture/overview.md) before changing a cross-cutting workflow. Read the installed Next.js guide named by `AGENTS.md` before changing framework code.

## Requirements

- Node.js 22, as declared by the Render service configuration.
- npm and the checked-in `package-lock.json`.
- A configured Supabase Auth project and PostgreSQL database for authenticated or data-backed behavior.
- The Supabase PostgreSQL CA certificate at the path in `DATABASE_SSL_CA_FILE`.

## Install and run

1. Install the locked dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and set the required values. Keep credentials local. Do not commit `.env.local` or paste secrets into logs, chat, or documentation.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`.

The root route renders the client app shell. The API and its protected views need working service configuration. A running page alone does not prove database or provider integration.

## Configuration

`src/lib/env.ts` validates the server runtime settings. `.env.example` also includes values used only by setup, deployment, seed, or verification scripts.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Backend runtime and local server | Use the restricted runtime role for normal app work. |
| `DATABASE_SSL_CA_FILE` | Database clients and scripts | Path to the certificate used for verified TLS. |
| `DATABASE_MIGRATION_URL` | Migration and seed scripts | Optional separate authorized connection. Prefer it over runtime credentials for schema or seed work. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server Auth clients | Public project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server Auth clients | Publishable key; never use a secret key here. |
| `APP_URL` | Cookie security and origin checks | Local default is `http://localhost:3000`; hosted values use the canonical app origin. |
| `RAZORPAY_KEY_ID` | Server payment adapter | Current validation requires a Razorpay test key. |
| `RAZORPAY_KEY_SECRET` | Server payment adapter | Secret. Keep it on the server. |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature check | Secret shared with the merchant webhook configuration. |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Browser payment flow | Public identifier paired with the server key ID. |
| `WORKER_AUTH_SECRET` | Hosted worker setup and private route | Keep separate from database and payment credentials. |
| `BACKEND_URL` | Vercel rewrite and deployment tooling | Set to the backend origin for frontend deployments. Leave unset for direct local development. |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SECRET_KEY` | Explicit admin tooling | High-privilege setup values. Do not expose them to browser code or ordinary runtime. |
| `MINT_DEPLOYMENT_URL` | Verification scripts | Optional deployed origin for checks. |
| `RESEND_API_KEY` | No runtime call in this repository | Email delivery is configured in Supabase Auth. |

`APP_URL` must match the browser origin for protected non-GET requests. Vercel uses `BACKEND_URL` to forward `/api/*`; Render does not need that rewrite variable.

## Common checks

Run the checks that match your change:

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run test:browser
```

Pure policy tests need no live payment. Workflow tests and connected browser checks can use a database and write or remove records. Inspect the test and its environment before running it. Use an isolated test project for operations that change data or contact a payment provider.

The main test groups are:

- `tests/credit-policy.test.ts`, `tests/order-limits.test.ts`, and `tests/fulfillment.test.ts`: pure policy rules.
- `tests/workflows.test.ts`: database transactions and multi-step business behavior.
- `tests/browser/`: browser interactions and request contracts.
- `tests/deployment-config.test.ts` and `tests/worker-auth.test.ts`: configuration and signed worker rules.
- `scripts/verify-*.ts`: explicit integration checks. Read each script before use.

Tests are evidence for their stated scope. A mocked browser test does not verify a real payment, provider webhook delivery, physical GPS accuracy, or a scheduled production worker.

## Database changes

1. Read the current model in `src/db/schema.ts` and the latest applied migration.
2. Change the schema definition, then generate a new migration with `npm run db:generate`.
3. Review the generated SQL. Add safe backfill and rollback-aware behavior where required.
4. Apply migrations only to an authorized development or deployment database:

   ```bash
   npm run db:migrate
   ```

5. Update workflows, tests, and the [technical reference](TECHNICAL_REFERENCE.md) that depend on the changed schema.

Never edit an applied migration to change an existing database. Migrations use verified TLS. `db:seed` creates identities and demo data; it is not a harmless local reset command.

## Menu data

The source menu is `data/campus-menu.json`. `scripts/replace-menu.ts` validates and imports this file. Re-importing can restore source settings and archive removed items. It does not replenish consumed stock. Read [Campus menu](frontend/CAMPUS_MENU.md) before importing or changing its data.

## Where to look next

- [Documentation map](README.md)
- [System architecture](architecture/overview.md)
- [Core workflows](architecture/workflows.md)
- [Technical reference](TECHNICAL_REFERENCE.md)
- [Deployment guide](DEPLOYMENT.md)
