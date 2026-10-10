import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
const c = postgres(
  process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!,
  {
    ssl: {
      ca: readFileSync(process.env.DATABASE_SSL_CA_FILE!, "utf8"),
      rejectUnauthorized: true,
    },
    prepare: false,
    max: 1,
  },
);
try {
  await migrate(drizzle(c), {
    migrationsFolder: "drizzle",
    migrationsSchema: "mint_migrations",
  });
  console.log("MINT migrations applied with verified TLS.");
} finally {
  await c.end();
}
