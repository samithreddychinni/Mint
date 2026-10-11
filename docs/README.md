# MINT documentation

Use this page to find the guide that matches your task. The documents form a map of the system. They do not repeat every rule in every file.

## Learn the system

1. Read the [system architecture](architecture/overview.md) to learn the runtime components and trust boundaries.
2. Read [workflows](architecture/workflows.md) to follow the state changes across checkout, payment, pickup, and recovery.
3. Use the [technical reference](TECHNICAL_REFERENCE.md) for exact endpoint contracts, tables, policies, invariants, and error behavior.

## Work by task

| Task | Start with | Then consult |
| --- | --- | --- |
| Run the app locally | [Local development](development.md) | [Deployment guide](DEPLOYMENT.md) for environment roles and release checks |
| Change an API route | [System architecture](architecture/overview.md) | Technical reference: endpoint list, auth, validation, and workflow sections |
| Change checkout, payment, credit, or pickup | [Workflows](architecture/workflows.md) | Technical reference: relevant algorithm, invariant, and failure sections |
| Change the database | Technical reference: schema, invariants, and maintenance sections | `src/db/schema.ts` and ordered SQL files in `drizzle/` |
| Change menus or inventory | [Campus menu](frontend/CAMPUS_MENU.md) | `data/campus-menu.json` and `scripts/replace-menu.ts` |
| Change student purchasing rules | [Student order limits](frontend/ORDER_LIMITS_PROPOSAL.md) | Technical reference: order limits and reliability algorithm |
| Change the app interface | [Frontend handoff](frontend/HANDOFF.md) | [System architecture](architecture/overview.md) for API and privacy boundaries |
| Configure sign-in email | [OTP email template](OTP_EMAIL_TEMPLATE.md) | Supabase Auth settings and `supabase/templates/mint-otp.html` |
| Deploy or diagnose production | [Deployment guide](DEPLOYMENT.md) | Technical reference: configuration, testing, limitations, and failure behavior |
| Evaluate future campus delivery | [Campus delivery proposal](frontend/CAMPUS_DELIVERY_PROPOSAL.md) | This proposal is not implemented product behavior |

## How to read the source

The application is one Next.js codebase with browser components, one API dispatcher, domain modules, and a PostgreSQL database. Follow the request path instead of reading files in alphabetical order:

1. Find the browser action in `src/components/mint-app.tsx` or `src/components/manager-dashboard.tsx`.
2. Find its API path in `src/app/api/[...path]/route.ts`.
3. Follow authentication and request checks in `src/lib/auth.ts` and `src/lib/http.ts`.
4. Follow the domain operation in `src/modules/`.
5. Check its SQL schema and migration history in `src/db/schema.ts` and `drizzle/`.
6. Find unit, database workflow, or browser coverage in `tests/`.

Background recovery follows `src/jobs/tick.ts`, called by the private route in `src/app/api/internal/worker/route.ts`. `src/jobs/worker.ts` runs the same tick in a local loop.

## Source of truth and document status

Use these rules when sources differ:

1. Current code and applied migrations define runtime behavior.
2. `drizzle/` records schema changes in migration order. Do not edit an applied migration to change a live database.
3. This documentation explains behavior; it does not configure hosted services.
4. Files with `proposal` in their name describe future choices, not active features.
5. Deployment history records time-bound checks. A past check does not prove the current service is healthy.

Update the guide that owns a behavior when you change it. Add links from related guides instead of copying the same detailed rule into multiple files.
