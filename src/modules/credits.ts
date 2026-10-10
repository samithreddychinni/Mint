import { sql } from "drizzle-orm";
import type { Executor } from "../db";
import { one, type Actor } from "./core";
import { insist } from "../lib/errors";
export async function account(tx: Executor, user: string, canteen: string) {
  await tx.execute(
    sql`insert into mint.credit_accounts(user_id,canteen_id) values(${user},${canteen}) on conflict(user_id,canteen_id) do nothing`,
  );
  return (await one(
    tx,
    sql`select * from mint.credit_accounts where user_id=${user} and canteen_id=${canteen} for update`,
  ))!;
}
export async function move(
  tx: Executor,
  a: Actor | null,
  user: string,
  canteen: string,
  amount: number,
  reserved: number,
  source: string,
  reason: string,
  orderId: string,
) {
  const ac = await account(tx, user, canteen);
  const previous = await one(
    tx,
    sql`select id from mint.credit_ledger where source=${source}`,
  );
  if (previous) return;
  insist(
    Number(ac.available) + amount >= 0 && Number(ac.reserved) + reserved >= 0,
    "CREDIT_UNAVAILABLE",
    "Available canteen credit changed.",
  );
  await tx.execute(
    sql`insert into mint.credit_ledger(account_id,amount,reserved_delta,source,reason,order_id,actor_id) values(${ac.id},${amount},${reserved},${source},${reason},${orderId},${a?.id || null})`,
  );
  await tx.execute(
    sql`update mint.credit_accounts set available=available+${amount},reserved=reserved+${reserved} where id=${ac.id}`,
  );
}
