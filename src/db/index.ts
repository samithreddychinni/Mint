import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readFileSync } from "node:fs";
import { env } from "../lib/env";
const config = env();
export const connection = postgres(config.DATABASE_URL, {
  ssl: {
    ca: readFileSync(config.DATABASE_SSL_CA_FILE, "utf8"),
    rejectUnauthorized: true,
  },
  max: 3,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 20,
});
export const db = drizzle(connection);
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;
