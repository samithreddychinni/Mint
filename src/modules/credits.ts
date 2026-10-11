import { sql } from "drizzle-orm";
import type { Tx } from "../db";
import { one, rows, type Actor } from "./core";
import { insist } from "../lib/errors";

export async function account(tx: Tx, user: string, canteen: string) {
  await tx.execute(
    sql`insert into mint.credit_accounts(user_id,canteen_id) values(${user},${canteen}) on conflict(user_id,canteen_id) do nothing`,
  );
  const ac = (await one(
    tx,
    sql`select * from mint.credit_accounts where user_id=${user} and canteen_id=${canteen} for update`,
  ))!;
  // Replay ledger entries from the previous backend during a rolling release.
  for (const entry of await rows(
    tx,
    sql`select * from mint.credit_ledger where account_id=${ac.id} and not lots_processed order by created_at,id for update`,
  )) {
    await applyLots(
      tx,
      ac,
      Number(entry.amount),
      Number(entry.reserved_delta),
      String(entry.source),
      entry.order_id as string | null,
      String(entry.created_at),
    );
    if (Number(entry.amount) > 0 && String(entry.source).startsWith("cancel:"))
      await tx.execute(
        sql`update mint.units set credit_returned=${entry.amount} where 'cancel:'||id=${entry.source}`,
      );
    await tx.execute(
      sql`update mint.credit_ledger set lots_processed=true where id=${entry.id}`,
    );
  }
  const due = await rows(
    tx,
    sql`select * from mint.credit_lots where account_id=${ac.id} and available>0 and expires_at<=clock_timestamp() order by expires_at,id for update`,
  );
  for (const lot of due) {
    const amount = Number(lot.available);
    await tx.execute(
      sql`insert into mint.credit_ledger(account_id,amount,source,reason,order_id,lots_processed) values(${ac.id},${-amount},${`credit-expiry:${lot.id}:${Number(lot.expired) + amount}`},'Credit expired after 30 days',${lot.order_id},true)`,
    );
    await tx.execute(
      sql`update mint.credit_lots set expired=expired+available,available=0 where id=${lot.id}`,
    );
    await tx.execute(
      sql`update mint.credit_accounts set available=available-${amount} where id=${ac.id}`,
    );
    ac.available = Number(ac.available) - amount;
  }
  return ac;
}

export async function expireCredits(tx: Tx, canteen: string, user?: string) {
  const due = await rows(
    tx,
    sql`select a.user_id from mint.credit_accounts a where a.canteen_id=${canteen} and (${user || null}::uuid is null or a.user_id=${user || null}::uuid) and (exists(select 1 from mint.credit_lots l where l.account_id=a.id and l.available>0 and l.expires_at<=clock_timestamp()) or exists(select 1 from mint.credit_ledger l where l.account_id=a.id and not l.lots_processed)) order by a.id`,
  );
  for (const ac of due) await account(tx, String(ac.user_id), canteen);
}

export async function move(
  tx: Tx,
  a: Actor | null,
  user: string,
  canteen: string,
  amount: number,
  reserved: number,
  source: string,
  reason: string,
  orderId: string | null,
) {
  const ac = await account(tx, user, canteen);
  const previous = await one(
    tx,
    sql`select id from mint.credit_ledger where source=${source}`,
  );
  if (previous) return;
  insist(
    Number.isSafeInteger(amount) &&
      Number.isSafeInteger(reserved) &&
      Number(ac.available) + amount >= 0 &&
      Number(ac.reserved) + reserved >= 0,
    "CREDIT_UNAVAILABLE",
    "Available canteen credit changed.",
  );
  await applyLots(tx, ac, amount, reserved, source, orderId);
  await tx.execute(
    sql`insert into mint.credit_ledger(account_id,amount,reserved_delta,source,reason,order_id,actor_id,lots_processed) values(${ac.id},${amount},${reserved},${source},${reason},${orderId},${a?.id || null},true)`,
  );
  await tx.execute(
    sql`update mint.credit_accounts set available=available+${amount},reserved=reserved+${reserved} where id=${ac.id}`,
  );
  // A released checkout hold keeps its original expiry; it never renews credit.
  if (reserved < 0 && amount > 0) await account(tx, user, canteen);
}

async function applyLots(
  tx: Tx,
  ac: import("./core").Row,
  amount: number,
  reserved: number,
  source: string,
  orderId: string | null,
  issuedAt?: string,
) {
  if (reserved < 0) {
    const allocations = await rows(
      tx,
      sql`select r.*,l.account_id from mint.credit_reservations r join mint.credit_lots l on l.id=r.lot_id where r.order_id=${orderId} order by l.expires_at,l.id for update of r,l`,
    );
    insist(
      allocations.every((l) => l.account_id === ac.id) &&
        allocations.reduce((sum, l) => sum + Number(l.amount), 0) ===
          -reserved &&
        (amount === 0 || amount === -reserved),
      "CREDIT_UNAVAILABLE",
      "Reserved canteen credit changed.",
    );
    for (const lot of allocations) {
      await tx.execute(
        sql`update mint.credit_lots set reserved=reserved-${lot.amount},available=available+${amount > 0 ? Number(lot.amount) : 0} where id=${lot.lot_id}`,
      );
    }
    await tx.execute(
      sql`delete from mint.credit_reservations where order_id=${orderId}`,
    );
  } else if (amount < 0) {
    insist(
      reserved === 0 || reserved === -amount,
      "INVALID_CREDIT",
      "Invalid credit reservation.",
      400,
    );
    let remaining = -amount;
    const lots = await rows(
      tx,
      sql`select * from mint.credit_lots where account_id=${ac.id} and available>0 and expires_at>clock_timestamp() order by expires_at,id for update`,
    );
    for (const lot of lots) {
      const take = Math.min(remaining, Number(lot.available));
      if (!take) break;
      await tx.execute(
        sql`update mint.credit_lots set available=available-${take},reserved=reserved+${reserved > 0 ? take : 0} where id=${lot.id}`,
      );
      if (reserved > 0)
        await tx.execute(
          sql`insert into mint.credit_reservations(order_id,lot_id,amount) values(${orderId},${lot.id},${take})`,
        );
      remaining -= take;
    }
    insist(
      remaining === 0,
      "CREDIT_UNAVAILABLE",
      "Available canteen credit changed.",
    );
  } else {
    insist(
      amount > 0 && reserved === 0,
      "INVALID_CREDIT",
      "Invalid credit issuance.",
      400,
    );
    await tx.execute(
      sql`insert into mint.credit_lots(account_id,source,order_id,available,expires_at) values(${ac.id},${source},${orderId},${amount},coalesce(${issuedAt || null}::timestamptz,clock_timestamp())+interval '30 days')`,
    );
  }
}
