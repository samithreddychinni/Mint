import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "../db";
import {
  atomic,
  one,
  rows,
  student,
  hash,
  secret,
  now,
  audit,
  type Actor,
  type Row,
} from "./core";
import { account, move } from "./credits";
import { insist } from "../lib/errors";
export type Cart = {
  canteenId: string;
  lines: { itemId: string; quantity: number; price: number }[];
  credit: number;
  key: string;
};
export async function expireTx(tx: Tx, canteen: string) {
  const due = await one(
    tx,
    sql`select exists(select 1 from mint.orders where canteen_id=${canteen} and state='pending' and hold_until<=clock_timestamp()) or exists(select 1 from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${canteen} and o.state='confirmed' and o.deadline<=clock_timestamp() and u.arrived_at is null and u.state='pending') as due`,
  );
  if (!due?.due) return;
  const pending = await rows(
    tx,
    sql`select * from mint.orders where canteen_id=${canteen} and state='pending' and hold_until<=clock_timestamp() order by id for update`,
  );
  for (const o of pending) {
    const quantities = await rows(
      tx,
      sql`select batch_id,count(*)::int qty from mint.units where order_id=${o.id} group by batch_id`,
    );
    for (const q of quantities) {
      await tx.execute(
        sql`update mint.batches set held=held-${q.qty} where id=${q.batch_id}`,
      );
      await tx.execute(
        sql`insert into mint.stock_events(batch_id,quantity,kind,source) values(${q.batch_id},${q.qty},'hold_release',${"hold-release:" + o.id + ":" + q.batch_id}) on conflict(source) do nothing`,
      );
    }
    if (Number(o.credit) > 0)
      await move(
        tx,
        null,
        String(o.payer_id),
        canteen,
        Number(o.credit),
        -Number(o.credit),
        "hold-release:" + o.id,
        "Checkout hold expired",
        String(o.id),
      );
    await tx.execute(
      sql`update mint.orders set state='expired' where id=${o.id}`,
    );
  }
  const units = await rows(
    tx,
    sql`select u.*,o.payer_id from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${canteen} and o.state='confirmed' and o.deadline<=clock_timestamp() and u.arrived_at is null and u.state='pending' order by u.order_id,u.id for update of u`,
  );
  for (const u of units)
    await cancelUnit(
      tx,
      u,
      String(u.payer_id),
      canteen,
      "expired",
      null,
      "Final arrival deadline missed",
    );
}
export async function cancelUnit(
  tx: Tx,
  u: Row,
  payer: string,
  canteen: string,
  state: string,
  a: Actor | null,
  reason: string,
  forceWaste = false,
) {
  insist(
    u.state === "pending" ||
      u.state === "ready" ||
      (a?.kind === "staff" && u.state === "preparing"),
    "CANNOT_CANCEL",
    "Preparation or collection started. A manager must review this request.",
  );
  const batch = await one(
    tx,
    sql`select * from mint.batches where id=${u.batch_id} for update`,
  );
  const reusable = batch!.reusable && u.state === "pending" && !forceWaste;
  if (reusable) {
    await tx.execute(
      sql`update mint.batches set committed=committed-1 where id=${u.batch_id}`,
    );
  } else {
    await tx.execute(
      sql`update mint.batches set committed=committed-1,waste=waste+1 where id=${u.batch_id}`,
    );
  }
  await tx.execute(
    sql`insert into mint.stock_events(batch_id,quantity,kind,source,actor_id) values(${u.batch_id},1,${reusable ? "cancel_release" : "cancel_waste"},${"cancel:" + u.id},${a?.id || null}) on conflict(source) do nothing`,
  );
  await move(
    tx,
    a,
    payer,
    canteen,
    Number(u.price),
    0,
    "cancel:" + u.id,
    reason,
    String(u.order_id),
  );
  await tx.execute(
    sql`update mint.units set state=${state},resolved=true,version=version+1 where id=${u.id}`,
  );
  await audit(tx, a, "cancel_portion", String(u.id), "cancel-audit:" + u.id, {
    reason,
    treatment: "same-canteen credit",
  });
}
export async function hold(a: Actor, cart: Cart) {
  student(a);
  const requestHash = hash(JSON.stringify({ ...cart, key: undefined }));
  return atomic(cart.canteenId, async (tx) => {
    await expireTx(tx, cart.canteenId);
    const prior = await one(
      tx,
      sql`select * from mint.orders where request_key=${a.id + ":" + cart.key}`,
    );
    if (prior) {
      insist(
        prior.request_hash === requestHash,
        "IDEMPOTENCY_CONFLICT",
        "Use a new checkout request for a changed cart.",
      );
      return prior;
    }
    const c = await one(
      tx,
      sql`select * from mint.canteens where id=${cart.canteenId}`,
    );
    insist(
      c && !c.paused,
      "ORDERING_PAUSED",
      "This canteen is not accepting new orders.",
    );
    insist(
      cart.lines.reduce((sum, l) => sum + l.quantity, 0) <= 100 &&
        cart.lines.length > 0 &&
        cart.lines.length <= 20 &&
        new Set(cart.lines.map((l) => l.itemId)).size === cart.lines.length,
      "INVALID_CART",
      "Choose distinct menu items.",
      400,
    );
    let total = 0;
    const portions: { item: Row; batch: string }[] = [];
    for (const line of [...cart.lines].sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    )) {
      insist(
        Number.isInteger(line.quantity) &&
          line.quantity > 0 &&
          line.quantity <= 20,
        "INVALID_QUANTITY",
        "Quantity must be between 1 and 20.",
        400,
      );
      const item = await one(
        tx,
        sql`select i.*,s.paused station_paused,(select coalesce(sum(total-held-committed-waste),0) from mint.batches where item_id=i.id)::int available from mint.items i join mint.stations s on s.id=i.station_id where i.id=${line.itemId} and i.canteen_id=${cart.canteenId}`,
      );
      insist(
        item && !item.paused && !item.station_paused,
        "STOCK_UNAVAILABLE",
        "This item is unavailable.",
      );
      insist(
        item.price === line.price,
        "PRICE_CHANGED",
        "The menu price changed. Review the refreshed cart before checkout.",
      );
      insist(
        Number(item.available) >= line.quantity,
        "STOCK_UNAVAILABLE",
        "Stock changed. Refresh the menu and update your cart.",
      );
      let remaining = line.quantity;
      const batches = await rows(
        tx,
        sql`select *,total-held-committed-waste available from mint.batches where item_id=${line.itemId} order by created_at,id for update`,
      );
      for (const b of batches) {
        const qty = Math.min(Number(b.available), remaining);
        if (qty) {
          await tx.execute(
            sql`update mint.batches set held=held+${qty} where id=${b.id}`,
          );
          for (let i = 0; i < qty; i++)
            portions.push({ item, batch: String(b.id) });
          remaining -= qty;
        }
      }
      insist(
        remaining === 0,
        "STOCK_UNAVAILABLE",
        "Stock changed. Refresh the menu and update your cart.",
      );
      total += Number(item.price) * line.quantity;
    }
    insist(
      Number.isInteger(cart.credit) && cart.credit >= 0 && cart.credit <= total,
      "INVALID_CREDIT",
      "Credit must be integer paise within the total.",
      400,
    );
    const ac = await account(tx, a.id, cart.canteenId);
    insist(
      Number(ac.available) >= cart.credit,
      "CREDIT_UNAVAILABLE",
      "Not enough same-canteen credit.",
    );
    const id = randomUUID();
    const order = await one(
      tx,
      sql`insert into mint.orders(id,reference,payer_id,canteen_id,total,credit,external,request_key,request_hash,hold_until) values(${id},${"M" + secret().slice(0, 8).toUpperCase()},${a.id},${cart.canteenId},${total},${cart.credit},${total - cart.credit},${a.id + ":" + cart.key},${requestHash},clock_timestamp()+interval '3 minutes') returning *`,
    );
    if (cart.credit)
      await move(
        tx,
        a,
        a.id,
        cart.canteenId,
        -cart.credit,
        cart.credit,
        "reserve:" + id,
        "Credit reserved for checkout",
        id,
      );
    let allocated = 0;
    let cumulative = 0;
    const unitValues = portions.map((p) => {
      cumulative += Number(p.item.price);
      const next = Math.floor((cumulative * cart.credit) / total);
      const credit = next - allocated;
      allocated = next;
      return sql`(${id},${p.item.id},${p.batch},${p.item.station_id},${p.item.name},${p.item.price},${credit},${Number(p.item.price) - credit},${p.item.mode},${a.id},${secret().slice(0, 10).toUpperCase()})`;
    });
    await tx.execute(
      sql`insert into mint.units(order_id,item_id,batch_id,station_id,name,price,credit,external,mode,collector_id,token) values ${sql.join(unitValues, sql`,`)}`,
    );
    for (const batch of new Set(portions.map((p) => p.batch)))
      await tx.execute(
        sql`insert into mint.stock_events(batch_id,quantity,kind,source,actor_id) values(${batch},${portions.filter((p) => p.batch === batch).length},'hold',${"hold:" + id + ":" + batch},${a.id})`,
      );
    await audit(tx, a, "checkout", id, "checkout:" + id, {
      total,
      credit: cart.credit,
    });
    return order!;
  });
}
export async function confirmTx(tx: Tx, o: Row, paymentId: string | null) {
  const quantities = await rows(
    tx,
    sql`select batch_id,count(*)::int qty from mint.units where order_id=${o.id} group by batch_id order by batch_id`,
  );
  const late =
    o.state === "expired" ||
    new Date(String(o.hold_until)).getTime() <= Date.parse(await now(tx));
  if (late && o.state === "pending") await expireTx(tx, String(o.canteen_id));
  if (late) {
    const ac = await account(tx, String(o.payer_id), String(o.canteen_id));
    if (Number(ac.available) < Number(o.credit)) return false;
    const c = await one(
      tx,
      sql`select paused from mint.canteens where id=${o.canteen_id}`,
    );
    if (c?.paused) return false;
    for (const q of quantities) {
      const b = await one(
        tx,
        sql`select total-held-committed-waste available from mint.batches where id=${q.batch_id} for update`,
      );
      if (Number(b?.available) < Number(q.qty)) return false;
    }
    if (Number(o.credit))
      await move(
        tx,
        null,
        String(o.payer_id),
        String(o.canteen_id),
        -Number(o.credit),
        0,
        "late-debit:" + o.id,
        "Credit committed after late captured payment",
        String(o.id),
      );
    for (const q of quantities)
      await tx.execute(
        sql`update mint.batches set committed=committed+${q.qty} where id=${q.batch_id}`,
      );
  } else {
    for (const q of quantities)
      await tx.execute(
        sql`update mint.batches set held=held-${q.qty},committed=committed+${q.qty} where id=${q.batch_id}`,
      );
    if (Number(o.credit))
      await move(
        tx,
        null,
        String(o.payer_id),
        String(o.canteen_id),
        0,
        -Number(o.credit),
        "commit:" + o.id,
        "Reserved credit spent",
        String(o.id),
      );
  }
  await tx.execute(
    sql`update mint.orders set state='confirmed',payment_id=${paymentId},confirmed_at=clock_timestamp(),target_at=clock_timestamp()+interval '25 minutes',deadline=clock_timestamp()+interval '30 minutes' where id=${o.id}`,
  );
  await audit(tx, null, "order_confirmed", String(o.id), "confirmed:" + o.id, {
    paymentId,
  });
  return true;
}
export async function creditOnly(a: Actor, id: string) {
  const o = await one(
    db,
    sql`select * from mint.orders where id=${id} and payer_id=${a.id}`,
  );
  insist(o, "FORBIDDEN", "This checkout does not belong to you.", 403);
  insist(o.external === 0, "PAYMENT_REQUIRED", "External payment is required.");
  return atomic(String(o.canteen_id), async (tx) => {
    const current = (await one(
      tx,
      sql`select * from mint.orders where id=${id} for update`,
    ))!;
    if (current.state === "confirmed") return current;
    insist(
      current.state === "pending" &&
        new Date(String(current.hold_until)).getTime() >
          Date.parse(await now(tx)),
      "HOLD_EXPIRED",
      "Checkout expired. Start a new order.",
    );
    await confirmTx(tx, current, null);
    return (await one(tx, sql`select * from mint.orders where id=${id}`))!;
  });
}
export async function cancel(
  a: Actor,
  id: string,
  ids: string[],
  reason = "Student cancellation",
) {
  student(a);
  const o = await one(
    db,
    sql`select * from mint.orders where id=${id} and payer_id=${a.id}`,
  );
  insist(o, "FORBIDDEN", "Only the payer may cancel portions.", 403);
  return atomic(String(o.canteen_id), async (tx) => {
    await expireTx(tx, String(o.canteen_id));
    insist(
      o.state === "confirmed",
      "NOT_CONFIRMED",
      "Only confirmed portions may be cancelled.",
    );
    for (const uid of ids) {
      const u = await one(
        tx,
        sql`select * from mint.units where id=${uid} and order_id=${id} for update`,
      );
      insist(u, "NOT_FOUND", "Portion not found.");
      if (u!.state === "cancelled" || u!.state === "expired") continue;
      insist(
        u!.state === "pending",
        "CANNOT_CANCEL",
        "Only portions whose preparation has not started can be cancelled.",
      );
      await cancelUnit(
        tx,
        u!,
        a.id,
        String(o.canteen_id),
        "cancelled",
        a,
        reason,
      );
    }
  });
}
