import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { provider, type ProviderPayment } from "../src/lib/razorpay";
import { one } from "../src/modules/core";
import { db, connection } from "../src/db";
const origin =
  process.env.MINT_DEPLOYMENT_URL ||
  process.env.APP_URL ||
  "http://localhost:3000";
const record = JSON.parse(
  readFileSync(".local/test-payment-end-to-end.json", "utf8"),
);
try {
  const list = await provider<{ items: ProviderPayment[] }>(
    `orders/${record.providerOrder}/payments`,
  );
  const p = list.items.find((p) => p.status === "captured");
  if (!p) throw new Error("No actual captured test payment available");
  const raw = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: p } },
  });
  const id = "local-verification-" + randomUUID();
  const sig = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(raw)
    .digest("hex");
  const post = (body: string, signature: string, eventId: string) =>
    fetch(origin + "/api/payments/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": eventId,
      },
      body,
    });
  const forged = await post(raw, "invalid", id + "-forged");
  const first = await post(raw, sig, id);
  const duplicate = await post(raw, sig, id);
  const earlier = JSON.stringify({
    event: "payment.authorized",
    payload: {
      payment: { entity: { ...p, status: "authorized", captured: false } },
    },
  });
  const outOfOrder = await post(
    earlier,
    createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(earlier)
      .digest("hex"),
    id + "-earlier",
  );
  const count = await one(
    db,
    sql`select count(*)::int count from mint.payments where id=${p.id}`,
  );
  const o = await one(
    db,
    sql`select state from mint.orders where id=${record.orderId}`,
  );
  if (
    forged.status !== 401 ||
    first.status !== 200 ||
    duplicate.status !== 200 ||
    outOfOrder.status !== 200 ||
    count?.count !== 1 ||
    o?.state !== "confirmed"
  )
    throw new Error("Signed-webhook verification failed");
  writeFileSync(
    origin.startsWith("https://")
      ? ".local/webhook-hosted-check.json"
      : ".local/webhook-local-check.json",
    JSON.stringify({
      origin,
      forgedRejected: true,
      signedAccepted: true,
      duplicateIdempotent: true,
      outOfOrderSafe: true,
      actualProviderPaymentFetched: true,
      publicProviderDelivery: false,
      checkedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  console.log(
    "HTTP webhook signature, duplicate and out-of-order processing passed using an actual captured provider test payment. Public webhook delivery remains untested.",
  );
} finally {
  await connection.end();
}
