import { sql } from "drizzle-orm";
import { db } from "../db";
import { atomic, rows } from "../modules/core";
import { expireTx } from "../modules/orders";
import { reconcile, resolveRefunds } from "../modules/payments";
export async function tick(external = true) {
  try {
    for (const c of await rows(db, sql`select id from mint.canteens`))
      await atomic(String(c.id), (tx) => expireTx(tx, String(c.id)));
    if (external) {
      await reconcile();
      await resolveRefunds();
    }
    await db.execute(
      sql`insert into mint.worker_health(name,last_at,error) values('expiry-reconciliation',clock_timestamp(),null) on conflict(name) do update set last_at=excluded.last_at,error=null`,
    );
  } catch {
    await db.execute(
      sql`insert into mint.worker_health(name,last_at,error) values('expiry-reconciliation',clock_timestamp(),'Worker tick failed; inspect local process') on conflict(name) do update set last_at=excluded.last_at,error=excluded.error`,
    );
    throw new Error("Worker tick failed");
  }
}
