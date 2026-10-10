import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { sql } from "drizzle-orm";
import { db, connection } from "../src/db";
import { hold, expireTx } from "../src/modules/orders";
import { atomic, one, type Actor } from "../src/modules/core";
import { provider, type ProviderPayment } from "../src/lib/razorpay";
import { applyCaptured, resolveRefunds } from "../src/modules/payments";
const fixture = randomUUID(),
  station = randomUUID(),
  item = randomUUID(),
  batch = randomUUID();
const identities = JSON.parse(
  readFileSync(".local/demo-accounts.json", "utf8"),
);
const payer: Actor = {
  id: identities["second@demo.mint.invalid"].id,
  email: "second@demo.mint.invalid",
  kind: "student",
};
const browser = await chromium.launch();
try {
  await db.execute(
    sql`insert into mint.canteens(id,name,lat,lng,radius,max_accuracy) values(${fixture},${"Test refund verification " + fixture},'0.04','0.01',65,25)`,
  );
  await db.execute(
    sql`insert into mint.stations(id,canteen_id,name) values(${station},${fixture},'Test refund station')`,
  );
  await db.execute(
    sql`insert into mint.items(id,canteen_id,station_id,name,price,mode) values(${item},${fixture},${station},'Test-only late payment resolution',4000,'ready')`,
  );
  await db.execute(
    sql`insert into mint.batches(id,item_id,total) values(${batch},${item},1)`,
  );
  const o = await hold(payer, {
    canteenId: fixture,
    lines: [{ itemId: item, quantity: 1, price: 4000 }],
    credit: 0,
    key: randomUUID(),
  });
  const remote = await provider<{ id: string }>("orders", "POST", {
    amount: 4000,
    currency: "INR",
    receipt: o.id,
    payment_capture: 1,
  });
  await db.execute(
    sql`update mint.orders set provider_order=${remote.id},hold_until=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await atomic(fixture, async (tx) => {
    await expireTx(tx, fixture);
    await tx.execute(
      sql`update mint.canteens set paused=true where id=${fixture}`,
    );
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript("window.__name=(f)=>f");
  await page.goto(process.env.APP_URL || "http://localhost:3000");
  await page.evaluate(
    async ({ key, order }) => {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve();
        s.onerror = () => reject();
        document.head.appendChild(s);
      });
      new window.Razorpay({
        key,
        order_id: order,
        amount: 4000,
        currency: "INR",
        name: "MINT Test Refund Verification",
        prefill: { contact: "9000090000", email: "demo@mint.samithreddy.me" },
        handler: () => {},
      }).open();
    },
    { key: process.env.RAZORPAY_KEY_ID!, order: remote.id },
  );
  await page.waitForTimeout(2500);
  const frame = page.frameLocator("iframe").first();
  await frame.getByText("Netbanking", { exact: true }).first().click();
  const popup = context.waitForEvent("page", { timeout: 30000 });
  await frame.getByText("Canara Bank", { exact: true }).click();
  const bank = await popup;
  await bank.getByRole("button", { name: /success/i }).click();
  let payment: ProviderPayment | undefined;
  for (let attempt = 0; attempt < 10 && !payment; attempt++) {
    const list = await provider<{ items: ProviderPayment[] }>(
      `orders/${remote.id}/payments`,
    );
    payment = list.items.find((p) => p.status === "captured");
    if (!payment) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!payment) throw new Error("Captured test payment not available");
  await applyCaptured(payment);
  const order = await one(
    db,
    sql`select state from mint.orders where id=${o.id}`,
  );
  if (order?.state !== "exception")
    throw new Error("Unavailable fulfillment was not rejected");
  await Promise.all([resolveRefunds(), resolveRefunds()]);
  const result = await one(
    db,
    sql`select state,provider_refund,attempts from mint.resolutions where order_id=${o.id}`,
  );
  if (!result?.provider_refund)
    throw new Error("Provider refund creation was not confirmed");
  const remoteRefund = await provider<{
    id: string;
    amount: number;
    status: string;
  }>(`refunds/${result.provider_refund}`);
  if (remoteRefund.amount !== 4000) throw new Error("Refund amount mismatch");
  writeFileSync(
    ".local/refund-end-to-end.json",
    JSON.stringify({
      orderId: o.id,
      fixtureCanteen: fixture,
      actualCapturedTestPayment: true,
      unavailableLateFulfillmentRejected: true,
      refundCreated: true,
      refundStatus: remoteRefund.status,
      resolutionState: result.state,
      amount: 4000,
      overlappingWorkers: true,
      checkedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  console.log(
    "Actual captured test payment became a durable late-payment exception; overlapping processors issued one provider test refund:",
    remoteRefund.status,
  );
} finally {
  await browser.close();
  await connection.end();
}
