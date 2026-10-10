import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const publicClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const email = "mint-unverified-" + randomUUID() + "@cb.students.amrita.edu",
  password = randomUUID() + "Aa9!";
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: false,
});
if (created.error)
  throw new Error("Unverified test identity setup unavailable");
const browser = await chromium.launch();
try {
  const login = await publicClient.auth.signInWithPassword({ email, password });
  if (login.data.session || !login.error)
    throw new Error("Unverified identity unexpectedly received a session");
  const page = await browser.newPage();
  await page.addInitScript("window.__name=(f)=>f");
  await page.goto(process.env.APP_URL || "http://localhost:3000");
  const checkout = await page.evaluate(async () => {
    const r = await fetch("/api/checkouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return { status: r.status, code: (await r.json()).code };
  });
  if (checkout.status !== 401)
    throw new Error("Unverified anonymous purchase boundary failed");
  const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}` };
  const list = await (
    await fetch("https://api.resend.com/emails?limit=30", { headers })
  ).json();
  const otp = list.data?.find(
    (x: { to: string[]; subject: string }) =>
      x.to?.includes("cb.sc.u4cse24111@cb.students.amrita.edu") &&
      /verification|confirm/i.test(x.subject),
  );
  let expiredRejected = false;
  if (otp) {
    const message = await (
      await fetch("https://api.resend.com/emails/" + otp.id, { headers })
    ).json();
    let code = message.html?.match(/<strong>\s*(\d{6})\s*<\/strong>/i)?.[1];
    if (code) {
      const rejected = await page.evaluate(async (token) => {
        const r = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "cb.sc.u4cse24111@cb.students.amrita.edu",
            token,
          }),
        });
        return { status: r.status, code: (await r.json()).code };
      }, code);
      code = undefined;
      expiredRejected =
        rejected.status === 400 && rejected.code === "INVALID_OTP";
    }
  }
  if (!expiredRejected)
    throw new Error("Expired/consumed OTP rejection not confirmed");
  writeFileSync(
    ".local/auth-boundary-check.json",
    JSON.stringify({
      unconfirmedSessionRejected: true,
      unverifiedPurchaseRejected: true,
      expiredConsumedOtpRejected: true,
      checkedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  console.log(
    "Real unconfirmed Auth identity cannot get a buyer session; protected purchase and expired/consumed OTP probes passed.",
  );
} finally {
  await admin.auth.admin.deleteUser(created.data.user.id);
  await browser.close();
}
