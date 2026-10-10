import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const accounts = JSON.parse(readFileSync(".local/demo-accounts.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
await page.addInitScript("window.__name=(f)=>f");
await page.goto(process.env.MINT_DEPLOYMENT_URL || "http://localhost:3000");
await page.evaluate(async (password) => {
  await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "second@demo.mint.invalid", password }),
  });
}, accounts["second@demo.mint.invalid"].password);
const result = await page.evaluate(async () => {
  const catalogue = await (await fetch("/api/catalogue")).json();
  const c = catalogue.canteens.find((c: { name: string }) => c.name === "Main");
  const item = catalogue.items.find(
    (i: { name: string; canteen_id: string }) =>
      i.canteen_id === c.id && i.name === "Fresh juice",
  );
  const r = await fetch("/api/checkouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      canteenId: c.id,
      lines: [{ itemId: item.id, quantity: 1, price: item.price }],
      credit: 0,
      key: crypto.randomUUID(),
    }),
  });
  return { status: r.status, order: await r.json() };
});
if (result.status !== 200) {
  console.log({
    status: result.status,
    code: result.order.code,
    message: result.order.message,
  });
  await browser.close();
  process.exit(1);
}
writeFileSync(
  ".local/provider-order-check.json",
  JSON.stringify({
    id: result.order.id,
    providerOrder: result.order.provider_order,
    amount: result.order.external,
    state: result.order.state,
    createdAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);
await page.evaluate(
  async ({ key, order }) => {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve();
      s.onerror = () => reject();
      document.head.appendChild(s);
    });
    const checkout = new window.Razorpay({
      key,
      order_id: order.provider_order,
      amount: order.external,
      currency: "INR",
      name: "MINT Test",
      description: "Test-mode integration verification",
      prefill: { email: "second@demo.mint.invalid", contact: "9000090000" },
      handler: async (p: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        await fetch("/api/orders/" + order.id + "/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: p.razorpay_payment_id,
            providerOrder: p.razorpay_order_id,
            signature: p.razorpay_signature,
          }),
        });
      },
    });
    checkout.open();
  },
  { key: process.env.RAZORPAY_KEY_ID!, order: result.order },
);
await page.waitForTimeout(2500);
const frame = page
  .frames()
  .find((f) => f.url().startsWith("https://api.razorpay.com"));
if (!frame) throw new Error("Checkout frame unavailable");
const phone = frame.locator('input[type="tel"]');
if (await phone.count()) {
  await phone.first().fill("9000090000");
  const email = frame.locator('input[name="email"]');
  if (await email.count()) await email.first().fill("demo@mint.samithreddy.me");
  await frame
    .getByRole("button", { name: "Continue", exact: true })
    .first()
    .click();
}
await frame.getByText("Netbanking", { exact: true }).first().click();
await page.waitForTimeout(1500);
const popup = context
  .waitForEvent("page", { timeout: 10000 })
  .catch(() => null);
await frame.getByText("Canara Bank", { exact: true }).click();
const bank = await popup;
if (bank) {
  await bank.waitForLoadState("domcontentloaded");
  console.log(
    "Provider test bank screen:",
    (await bank.locator("body").innerText()).slice(0, 1000),
  );
  await bank.getByRole("button", { name: /success/i }).click();
} else {
  console.log(
    "No bank popup; provider frame result:",
    (await frame.locator("body").innerText()).slice(0, 2500),
  );
  console.log(
    "Frame origins:",
    page.frames().map((f) => {
      try {
        return new URL(f.url()).origin;
      } catch {
        return "local";
      }
    }),
  );
}
await page.waitForTimeout(3000);
const { provider } = await import("../src/lib/razorpay");
const paid = await provider<{
  items: import("../src/lib/razorpay").ProviderPayment[];
}>(`orders/${result.order.provider_order}/payments`);
if (!paid.items.some((p) => p.status === "captured")) {
  await browser.close();
  throw new Error("The provider did not capture the test payment.");
}
const readOrder = () =>
  page.evaluate(async (id) => {
    const r = await fetch("/api/orders/" + id);
    const data = await r.json();
    return {
      status: r.status,
      state: data.order?.state,
      confirmedAt: data.order?.confirmed_at,
      deadline: data.order?.deadline,
    };
  }, result.order.id);
let final = await readOrder();
for (let attempt = 0; attempt < 30 && final.state !== "confirmed"; attempt++) {
  await page.waitForTimeout(2000);
  final = await readOrder();
}
if (final.status !== 200 || final.state !== "confirmed") {
  await browser.close();
  throw new Error(
    "The deployed server did not confirm the captured test payment.",
  );
}
writeFileSync(
  ".local/test-payment-end-to-end.json",
  JSON.stringify({
    orderId: result.order.id,
    providerOrder: result.order.provider_order,
    testMode: true,
    amount: result.order.external,
    ...final,
    checkedAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);
console.log("Actual test payment verification outcome:", final);
await page.screenshot({ path: ".local/test-checkout.png", fullPage: true });
await browser.close();
