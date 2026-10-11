# MINT

MINT is a campus canteen pickup app. Students order from a menu, pay online or with canteen credit, and collect food at a serving station. Staff and managers use the same app with canteen-scoped permissions.

The app is a progressive web app. It needs a network connection for sign-in, menu data, checkout, payment, and pickup actions. Offline mode shows a fallback page; it does not queue orders.

## Start here

- [Documentation map](docs/README.md) — choose a guide by task.
- [System architecture](docs/architecture/overview.md) — follow a request from browser to database and external services.
- [Workflows](docs/architecture/workflows.md) — learn how checkout, payment, pickup, credit, and background recovery work together.
- [Local development](docs/development.md) — configure and run the project safely.
- [Technical reference](docs/TECHNICAL_REFERENCE.md) — find exact API, schema, policy, security, and failure behavior.
- [Deployment guide](docs/DEPLOYMENT.md) — configure hosting and verify a release.

## Quick start

Use Node.js 22 and npm. Copy `.env.example` to `.env.local`, then set the required local service values. See [Local development](docs/development.md) before running database commands.

```bash
npm ci
npm run dev
```

The development server listens on `http://localhost:3000`. The app needs a working Auth and database configuration for authenticated or data-backed screens.

## Project status

The current product supports pickup at Main, IT, and MBA canteens. Campus delivery documents describe proposals, not live features. The current payment configuration accepts Razorpay test keys only.

Source code and applied database migrations define current behavior. Documentation explains that behavior and links to the code that owns it. If a guide disagrees with the current code, treat the code and migration history as authoritative and update the guide with the change.
