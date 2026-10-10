import {
  appendFileSync,
  chmodSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
const linked = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
const auth = JSON.parse(
  readFileSync(`${homedir()}/.local/share/com.vercel.cli/auth.json`, "utf8"),
);
const origin = "https://mint-campus-demo.vercel.app";
const secret =
  process.env.WORKER_AUTH_SECRET || randomBytes(40).toString("hex");
if (!process.env.WORKER_AUTH_SECRET)
  appendFileSync(
    ".env.local",
    `\nWORKER_AUTH_SECRET=${secret}\nMINT_DEPLOYMENT_URL=${origin}\n`,
  );
chmodSync(".env.local", 0o600);
const remoteDatabase = new URL(process.env.DATABASE_URL!);
remoteDatabase.port = "6543";
const db = postgres(remoteDatabase.toString(), {
  ssl: {
    ca: readFileSync(process.env.DATABASE_SSL_CA_FILE!, "utf8"),
    rejectUnauthorized: true,
  },
  max: 1,
  prepare: false,
  connect_timeout: 15,
});
try {
  const check =
    await db`select current_user as role, (select count(*)::int from mint.canteens) as canteens`;
  if (check[0].role !== "mint_backend")
    throw new Error("Deployment database role mismatch");
  console.log("Deployment transaction-pooler TLS/runtime-role check passed.");
} finally {
  await db.end({ timeout: 3 });
}
const response = await fetch(
  `https://api.vercel.com/v9/projects/${linked.projectId}?teamId=${linked.orgId}`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ framework: "nextjs", nodeVersion: "22.x" }),
  },
);
if (!response.ok)
  throw new Error(`Project configuration failed (${response.status})`);
const variables: Record<string, string> = {
  DATABASE_URL: remoteDatabase.toString(),
  DATABASE_SSL_CA_FILE: "certs/supabase-ca.crt",
  APP_URL: origin,
  WORKER_AUTH_SECRET: secret,
};
if (process.env.BACKEND_URL) {
  const backend = new URL(process.env.BACKEND_URL);
  if (backend.protocol !== "https:") throw new Error("Backend must use HTTPS");
  variables.BACKEND_URL = backend.origin;
}
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
]) {
  if (!process.env[name]) throw new Error(`Missing configured value: ${name}`);
  variables[name] = process.env[name]!;
}
for (const [name, value] of Object.entries(variables)) {
  const result = spawnSync(
    "vercel",
    [
      "env",
      "add",
      name,
      "production",
      "--force",
      "--yes",
      name.startsWith("NEXT_PUBLIC_") ||
      name === "APP_URL" ||
      name === "BACKEND_URL" ||
      name === "DATABASE_SSL_CA_FILE"
        ? "--no-sensitive"
        : "--sensitive",
    ],
    { input: value, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      `Could not configure ${name}; provider exit ${result.status}`,
    );
  console.log(`Configured deployment variable: ${name}`);
}
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
  ".",
)[0];
const management = {
  Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
  "Content-Type": "application/json",
};
const current = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/config/auth`,
  { headers: management },
);
if (!current.ok)
  throw new Error(`Auth configuration read failed (${current.status})`);
const existing = await current.json();
const allow = Array.from(
  new Set([
    ...(existing.uri_allow_list || "").split(",").filter(Boolean),
    "http://localhost:3000",
    origin,
  ]),
);
const update = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/config/auth`,
  {
    method: "PATCH",
    headers: management,
    body: JSON.stringify({ site_url: origin, uri_allow_list: allow.join(",") }),
  },
);
if (!update.ok) throw new Error(`Auth origin update failed (${update.status})`);
const readback = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/config/auth`,
  { headers: management },
);
const configured = await readback.json();
if (
  configured.site_url !== origin ||
  !configured.hook_before_user_created_enabled
)
  throw new Error("Auth origin/hook read-back failed");
writeFileSync(
  ".local/deployment-config.json",
  JSON.stringify(
    {
      origin,
      projectId: linked.projectId,
      region: "hnd1",
      nodeVersion: "22.x",
      variableNames: Object.keys(variables),
      authOriginVerified: true,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "Hosted Auth origin verified; local origin retained. No provisioning or migration credentials uploaded.",
);
