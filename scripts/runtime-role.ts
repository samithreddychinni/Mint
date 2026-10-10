import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
const owner = postgres(process.env.DATABASE_MIGRATION_URL!, {
  ssl: {
    ca: readFileSync(process.env.DATABASE_SSL_CA_FILE!, "utf8"),
    rejectUnauthorized: true,
  },
  prepare: false,
  max: 1,
});
let stage = "configure role login";
try {
  const password = randomBytes(32).toString("base64url");
  const [statement] =
    await owner`select format('ALTER ROLE mint_backend LOGIN PASSWORD %L',${password}::text) statement`;
  await owner.unsafe(statement.statement);
  const url = new URL(process.env.DATABASE_URL!);
  url.username =
    "mint_backend." +
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  url.password = password;
  stage = "connect with runtime role";
  const runtime = postgres(url.toString(), {
    ssl: {
      ca: readFileSync(process.env.DATABASE_SSL_CA_FILE!, "utf8"),
      rejectUnauthorized: true,
    },
    prepare: false,
    max: 1,
    connect_timeout: 15,
  });
  try {
    const [check] =
      await runtime`select current_user as role,exists(select 1 from mint.canteens) data_access,has_schema_privilege(current_user,'mint','CREATE') can_migrate`;
    if (
      check.role !== "mint_backend" ||
      !check.data_access ||
      check.can_migrate
    )
      throw new Error("Least privilege validation failed");
    const text = readFileSync(".env.local", "utf8").replace(
      /^DATABASE_URL=.*$/m,
      "DATABASE_URL=" + url.toString(),
    );
    writeFileSync(".env.local", text, { mode: 0o600 });
    console.log(
      "Dedicated MINT runtime role verified. Migration credentials remain separate.",
    );
  } finally {
    await runtime.end();
  }
} catch (error) {
  console.error(
    "Runtime role configuration unavailable:",
    error instanceof Error ? error.name : "Unknown",
    stage,
    (error as { code?: string }).code,
  );
  process.exitCode = 1;
} finally {
  await owner.end();
}
