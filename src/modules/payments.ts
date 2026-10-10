import { sql } from "drizzle-orm";
import { db } from "../db";
import { atomic, one, rows, now, audit, type Actor, type Row } from "./core";
import { confirmTx, expireTx } from "./orders";
import {
  provider,
  captured,
  signature,
  type ProviderPayment,
} from "../lib/razorpay";
import { env } from "../lib/env";
import { insist } from "../lib/errors";
export async function createPayment(a: Actor, id: string) {
  const o = await one(
    db,
    sql`select * from mint.orders where id=${id} and payer_id=${a.id}`,
  );
  insist(o, "FORBIDDEN", "This checkout does not belong to you.", 403);
  insist(
    Number(o.external) > 0,
    "NO_EXTERNAL_PAYMENT",
    "This order is covered by canteen credit.",
  );
  insist(
    o.state === "pending" &&
      Date.parse(String(o.hold_until)) > Date.parse(await now(db)),
    "HOLD_EXPIRED",
    "Checkout expired. Start a new order.",
  );
  if (o.provider_order) return o;
  // Claim order creation durably. After an ambiguous network failure, reconcile by receipt; never create a second provider order blindly.
  const claimed = await one(
    db,
    sql`update mint.orders set reconcile_at=clock_timestamp() where id=${id} and provider_order is null and reconcile_at is null returning id`,
  );
  insist(
    claimed,
    "PAYMENT_PENDING",
    "MINT will verify payment setup. Refresh this order. Do not pay again.",
  );
  const remote = await provider<{
    id: string;
    amount: number;
    currency: string;
  }>("orders", "POST", {
    amount: o.external,
    currency: "INR",
    receipt: o.id,
    notes: { mint_order: o.id },
    payment_capture: 1,
  });
  insist(
    remote.amount === o.external && remote.currency === "INR",
    "PAYMENT_EXCEPTION",
    "Provider order amount did not match.",
  );
  await db.execute(
    sql`update mint.orders set provider_order=${remote.id},reconcile_at=null where id=${id}`,
  );
  return (await one(db, sql`select * from mint.orders where id=${id}`))!;
}
export async function applyCaptured(p: ProviderPayment) {
  insist(
    p.status === "captured" && p.captured,
    "PAYMENT_PENDING",
    "Payment is not captured yet.",
  );
  const o = await one(
    db,
    sql`select * from mint.orders where provider_order=${p.order_id}`,
  );
  insist(o, "PAYMENT_EXCEPTION", "Payment is not linked to a MINT order.");
  const outcome = await atomic(String(o.canteen_id), async (tx) => {
    await expireTx(tx, String(o.canteen_id));
    const current = (await one(
      tx,
      sql`select * from mint.orders where id=${o.id} for update`,
    ))!;
    if (
      p.amount !== Number(current.external) ||
      p.currency !== "INR" ||
      p.order_id !== current.provider_order
    ) {
      await audit(
        tx,
        null,
        "payment_mismatch",
        String(current.id),
        "payment-mismatch:" + p.id,
        { paymentId: p.id, amount: p.amount, currency: p.currency },
      );
      return { ...current, paymentMismatch: true };
    }
    const previous = await one(
      tx,
      sql`select * from mint.payments where id=${p.id}`,
    );
    if (previous) {
      insist(
        previous.order_id === current.id,
        "PAYMENT_EXCEPTION",
        "Payment already belongs to a different order.",
      );
      return current;
    }
    await tx.execute(
      sql`insert into mint.payments(id,order_id,amount,status) values(${p.id},${current.id},${p.amount},'captured')`,
    );
    let resolution = "";
    if (current.state === "confirmed") {
      resolution = "Duplicate captured payment; fulfillment confirmed once";
    } else if (current.state === "exception") {
      resolution = "Order already in financial exception";
    } else if (!(await confirmTx(tx, current, p.id))) {
      resolution = "Late captured payment could not safely reserve fulfillment";
      await tx.execute(
        sql`update mint.orders set state='exception' where id=${current.id}`,
      );
    }
    if (resolution)
      await tx.execute(
        sql`insert into mint.resolutions(order_id,payment_id,amount,reason) values(${current.id},${p.id},${p.amount},${resolution}) on conflict(payment_id) do nothing`,
      );
    return (await one(
      tx,
      sql`select * from mint.orders where id=${current.id}`,
    ))!;
  });
  insist(
    !outcome.paymentMismatch,
    "PAYMENT_EXCEPTION",
    "Payment amount, currency or order linkage does not match. Manager review is recorded.",
  );
  return outcome;
}
export async function verifyPayment(
  a: Actor,
  id: string,
  paymentId: string,
  providerOrder: string,
  sig: string,
) {
  const o = await one(
    db,
    sql`select * from mint.orders where id=${id} and payer_id=${a.id}`,
  );
  insist(o, "FORBIDDEN", "Only the payer may verify this payment.", 403);
  insist(
    o.provider_order === providerOrder &&
      signature(
        providerOrder + "|" + paymentId,
        sig,
        env().RAZORPAY_KEY_SECRET,
      ),
    "BAD_SIGNATURE",
    "Payment signature is invalid.",
    400,
  );
  const p = await captured(paymentId);
  return applyCaptured(p);
}
export async function webhook(raw: string, sig: string, eventId: string) {
  insist(
    signature(raw, sig, env().RAZORPAY_WEBHOOK_SECRET),
    "BAD_SIGNATURE",
    "Invalid webhook signature.",
    401,
  );
  const payload = JSON.parse(raw);
  const p = payload.payload?.payment?.entity;
  const pid = typeof p?.id === "string" ? p.id : null;
  const event = await one(
    db,
    sql`insert into mint.provider_events(id,kind,payment_id) values(${eventId},${String(payload.event)},${pid}) on conflict(id) do nothing returning id`,
  );
  if (!event) {
    const prior = await one(
      db,
      sql`select state from mint.provider_events where id=${eventId}`,
    );
    if (prior?.state === "processed") return;
  }
  if (pid && ["payment.captured", "order.paid"].includes(payload.event)) {
    const verified = await captured(pid);
    await applyCaptured(verified);
  }
  await db.execute(
    sql`update mint.provider_events set state='processed' where id=${eventId}`,
  );
}
export async function claimResolutions() {
  return rows(
    db,
    sql`with candidates as (select id from mint.resolutions where state in ('pending','retry','processing') and retry_at<=clock_timestamp() and (claimed_until is null or claimed_until<clock_timestamp()) order by created_at for update skip locked limit 5) update mint.resolutions r set state='processing',claimed_until=clock_timestamp()+interval '1 minute',attempts=attempts+1 from candidates c where r.id=c.id returning r.*`,
  );
}
export async function resolveRefunds() {
  const claimed = await claimResolutions();
  for (const r of claimed) {
    try {
      const existing = await provider<{
        items: {
          id: string;
          amount: number;
          status: string;
          receipt: string;
        }[];
      }>(`payments/${r.payment_id}/refunds`);
      let refund = existing.items.find((x) => x.receipt === r.id);
      if (!refund)
        refund = await provider(
          `payments/${r.payment_id}/refund`,
          "POST",
          {
            amount: r.amount,
            speed: "normal",
            receipt: r.id,
            notes: { mint_resolution: r.id },
          },
          { "X-Refund-Idempotency": String(r.id) },
        );
      if (refund) {
        await db.execute(
          sql`update mint.resolutions set state=${refund.status === "processed" ? "completed" : "retry"},provider_refund=${refund.id},claimed_until=null,retry_at=clock_timestamp()+interval '30 seconds',last_error=null where id=${r.id}`,
        );
      }
    } catch {
      await db.execute(
        sql`update mint.resolutions set state='retry',claimed_until=null,retry_at=clock_timestamp()+interval '1 minute',last_error='Provider request failed; retry scheduled' where id=${r.id}`,
      );
    }
  }
}
export async function reconcile() {
  const pending = await rows(
    db,
    sql`with candidates as (select id from mint.orders where external>0 and state in ('pending','expired','exception') and created_at>clock_timestamp()-interval '7 days' and next_payment_check_at<=clock_timestamp() order by (state='pending') desc,next_payment_check_at,created_at for update skip locked limit 40) update mint.orders o set next_payment_check_at=clock_timestamp()+interval '1 minute' from candidates c where o.id=c.id returning o.*`,
  );
  for (const o of pending) {
    try {
      let providerId = o.provider_order;
      if (!providerId && o.reconcile_at) {
        const matches = await provider<{ items: Row[] }>(
          "orders?receipt=" + encodeURIComponent(String(o.id)),
        );
        const found = matches.items.find(
          (x) =>
            x.receipt === o.id &&
            x.amount === o.external &&
            x.currency === "INR",
        );
        if (found) {
          providerId = found.id;
          await db.execute(
            sql`update mint.orders set provider_order=${found.id},reconcile_at=null where id=${o.id}`,
          );
        }
      }
      if (providerId) {
        const list = await provider<{ items: ProviderPayment[] }>(
          `orders/${providerId}/payments`,
        );
        for (const p of list.items)
          if (p.status === "captured") await applyCaptured(p);
      }
    } catch {
      /* Durable pending state remains visible for the next tick. */
    }
  }
  const events = await rows(
    db,
    sql`select * from mint.provider_events where state='pending' and payment_id is not null limit 30`,
  );
  for (const e of events) {
    try {
      await applyCaptured(await captured(String(e.payment_id)));
      await db.execute(
        sql`update mint.provider_events set state='processed' where id=${e.id}`,
      );
    } catch {}
  }
}
