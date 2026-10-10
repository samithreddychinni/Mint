import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
const origin = process.env.BACKEND_URL || process.env.MINT_DEPLOYMENT_URL;
if (!origin?.startsWith("https://") || !process.env.WORKER_AUTH_SECRET)
  throw new Error(
    "Hosted URL and scheduler authentication must be configured locally first.",
  );
const db = postgres(process.env.DATABASE_MIGRATION_URL!, {
  ssl: {
    ca: readFileSync(process.env.DATABASE_SSL_CA_FILE!, "utf8"),
    rejectUnauthorized: true,
  },
  max: 1,
  prepare: false,
});
try {
  await db.begin(async (tx) => {
    for (const [name, value] of [
      ["mint_worker_url", origin + "/api/internal/worker"],
      ["mint_worker_auth", process.env.WORKER_AUTH_SECRET!],
    ]) {
      const found = await tx`select id from vault.secrets where name=${name}`;
      if (found[0])
        await tx`select vault.update_secret(${found[0].id}::uuid,${value}::text)`;
      else
        await tx`select vault.create_secret(${value}::text,${name}::text,'MINT hosted demo scheduler')`;
    }
    await tx`select cron.schedule('mint-hosted-worker','30 seconds','select mint.dispatch_worker();')`;
    await tx`select cron.schedule('mint-worker-history-cleanup','23 3 * * *','delete from cron.job_run_details where jobid in(select jobid from cron.job where jobname in(''mint-hosted-worker'',''mint-worker-history-cleanup'')) and end_time<now()-interval ''7 days'';')`;
  });
  const jobs =
    await db`select jobname,schedule,active from cron.job where jobname like 'mint-%' order by jobname`;
  const permissions =
    await db`select has_function_privilege('anon','mint.dispatch_worker()','execute') as anon_dispatch,has_function_privilege('mint_backend','mint.dispatch_worker()','execute') as runtime_dispatch,has_schema_privilege('anon','vault','usage') as anon_vault,has_schema_privilege('mint_backend','vault','usage') as runtime_vault`;
  if (
    permissions[0].anon_dispatch ||
    permissions[0].runtime_dispatch ||
    permissions[0].anon_vault ||
    permissions[0].runtime_vault
  )
    throw new Error("Scheduler permission check failed");
  writeFileSync(
    ".local/hosted-worker-config.json",
    JSON.stringify(
      { jobs, permissionsVerified: true, checkedAt: new Date().toISOString() },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Hosted worker scheduled every 30 seconds; Vault and private dispatch permissions verified.",
  );
} finally {
  await db.end({ timeout: 3 });
}
