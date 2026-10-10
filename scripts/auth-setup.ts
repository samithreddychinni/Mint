import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
  ".",
)[0];
const headers = {
  Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
  "Content-Type": "application/json",
};
if (!process.env.SUPABASE_SECRET_KEY) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
    { headers },
  );
  if (!r.ok)
    throw new Error(`Auth provisioning key access unavailable (${r.status}).`);
  const keys = await r.json();
  const key =
    keys.find((x: { type?: string; name?: string }) => x.type === "secret") ||
    keys.find((x: { name?: string }) => x.name === "service_role");
  if (!key?.api_key)
    throw new Error("No server-only Auth provisioning key available.");
  appendFileSync(
    ".env.local",
    `\n# Provisioning tooling only. Never sent to browser.\nSUPABASE_SECRET_KEY=${key.api_key}\n`,
  );
  chmodSync(".env.local", 0o600);
  console.log(
    "Server-only provisioning credential stored in ignored local configuration.",
  );
}
const config = {
  site_url:
    process.env.MINT_DEPLOYMENT_URL ||
    process.env.APP_URL ||
    "http://localhost:3000",
  hook_before_user_created_enabled: true,
  hook_before_user_created_uri:
    "pg-functions://postgres/mint/before_user_created",
};
const r = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/config/auth`,
  { method: "PATCH", headers, body: JSON.stringify(config) },
);
if (!r.ok) {
  console.log("Auth hook setup status:", r.status);
  throw new Error("Auth hook configuration not accepted.");
}
const get = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/config/auth`,
  { headers },
);
const c = await get.json();
if (
  c.hook_before_user_created_uri !== config.hook_before_user_created_uri ||
  !c.hook_before_user_created_enabled
)
  throw new Error("Hook read-back mismatch");
writeFileSync(
  ".local/auth-hook-readiness.json",
  JSON.stringify({
    enabled: true,
    hook: "mint.before_user_created",
    checkedAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);
console.log("Auth domain hook configured and verified.");
