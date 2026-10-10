import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const origin = process.env.MINT_DEPLOYMENT_URL || "http://localhost:3000";
const recipient = "cb.sc.u4cse24111@cb.students.amrita.edu";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript("window.__name=(f)=>f");
await page.goto(origin);
const start = Date.now();
try {
  const request = await page.evaluate(async (email) => {
    const r = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return { status: r.status };
  }, recipient);
  if (request.status !== 200)
    throw new Error("OTP request status " + request.status);
  let code: string | undefined;
  let delivered = false;
  for (let attempt = 0; attempt < 15 && !code; attempt++) {
    const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}` };
    const list = await (
      await fetch("https://api.resend.com/emails?limit=20", { headers })
    ).json();
    const item = list.data?.find(
      (x: { to: string[]; created_at: string; subject: string }) =>
        x.to?.includes(recipient) &&
        Date.parse(x.created_at) > start - 5000 &&
        /verification|confirm/i.test(x.subject),
    );
    if (item) {
      const message = await (
        await fetch("https://api.resend.com/emails/" + item.id, { headers })
      ).json();
      code = message.html?.match(/<strong>\s*(\d{6})\s*<\/strong>/i)?.[1];
      delivered = item.last_event === "delivered";
    }
    if (!code) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!code)
    throw new Error("No OTP message available for secure verification.");
  const result = await page.evaluate(
    async ({ email, token }) => {
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      return { status: r.status };
    },
    { email: recipient, token: code },
  );
  code = undefined;
  if (result.status !== 200)
    throw new Error("OTP verification status " + result.status);
  const me = await page.evaluate(async () => {
    const r = await fetch("/api/me");
    const data = await r.json();
    return {
      status: r.status,
      kind: data.actor?.kind,
      email: data.actor?.email,
    };
  });
  if (me.status !== 200 || me.kind !== "student" || me.email !== recipient)
    throw new Error("Verified student session check failed.");
  writeFileSync(
    origin.startsWith("https://")
      ? ".local/hosted-otp-end-to-end.json"
      : ".local/otp-end-to-end.json",
    JSON.stringify({
      origin,
      recipient,
      requested: true,
      delivered,
      codeVerified: true,
      sessionVerified: true,
      checkedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  console.log(
    "Actual student OTP transport, verification and authenticated MINT student session passed. No OTP or session values stored.",
  );
  await page.evaluate(() =>
    fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
} finally {
  await browser.close();
}
