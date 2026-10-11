import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const accounts = JSON.parse(
  readFileSync(".local/demo-accounts.json", "utf8"),
) as Record<string, { password: string }>;
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Staff sign in" }).click();
  await page.getByLabel("Staff account email").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(accounts[email].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  if (email.endsWith("@demo.mint.invalid")) {
    const me = await (await page.request.get("/api/me")).json();
    if (me.profile && !me.profile.completed_at) {
      await page
        .getByLabel("Your name", { exact: true })
        .fill("Demo " + email.split("@")[0]);
      await page
        .getByLabel("Mobile number", { exact: true })
        .fill("9000000001");
      await page.getByRole("button", { name: "Continue to MINT" }).click();
      await expect(
        page.getByRole("heading", { name: "Make MINT yours" }),
      ).toHaveCount(0);
    }
  }
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
}
test("slow refresh does not accumulate automatic polling requests", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/catalogue", async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 11000));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        canteens: [],
        stations: [],
        items: [],
        serverTime: new Date().toISOString(),
      }),
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Loading the menu…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No matching items.", { exact: false }),
  ).toHaveCount(0);
  await page.waitForTimeout(10500);
  expect(requests).toBe(1);
});
test("student mobile interface, real Supabase session, CSRF/role rejection and offline guard", async ({
  page,
  context,
}) => {
  await login(page, "payer@demo.mint.invalid");
  const me = await (await page.request.get("/api/me")).json();
  expect(me.limits.tier).toBe("standard");
  expect(me.limits.limits.activeOrders).toBe(2);
  expect(me.limits.limits.perOrder).toBe(6);
  expect(Number.isInteger(me.limits.usage.outstanding)).toBe(true);
  await expect(
    page.getByRole("heading", { name: "What sounds good?", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByLabel("Search menu", { exact: true }).fill("Set Dosa");
  await expect(
    page.getByRole("heading", { name: "Set Dosa", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Badam Milk", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Search menu", { exact: true })
    .fill("no-such-demo-item");
  await expect(
    page.getByText("No matching items.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Search menu", { exact: true }).fill("");
  await page.screenshot({ path: ".local/app-menu-mobile.png", fullPage: true });
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: /Canteen credit/ }).click();
  await expect(
    page.getByRole("heading", { name: "Credit activity" }),
  ).toBeVisible();
  await noOverflow(page);
  const result = await page.evaluate(async () => {
    const catalogue = await (await fetch("/api/catalogue")).json();
    const response = await fetch("/api/manager/" + catalogue.canteens[0].id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "pause",
        key: crypto.randomUUID(),
        paused: true,
        reason: "unauthorized browser probe",
      }),
    });
    return { status: response.status, data: await response.json() };
  });
  expect(result.status).toBe(403);
  expect(result.data.code).toBe("FORBIDDEN");
  const csrf = await page.request.post(
    "/api/manager/00000000-0000-4000-a000-000000000000",
    {
      headers: { Origin: "https://unapproved.example" },
      data: {
        action: "pause",
        paused: true,
        reason: "CSRF rejection probe",
        key: "csrf-test-key",
      },
    },
  );
  expect(csrf.status()).toBe(403);
  expect((await csrf.json()).code).toBe("BAD_ORIGIN");
  await context.setOffline(true);
  await expect(
    page.getByText("Offline. Data is stale. Actions are disabled."),
  ).toBeVisible();
  await context.setOffline(false);
  await page.screenshot({ path: ".local/student-mobile.png", fullPage: true });
});
test("serving mobile interface uses scoped worklists and no arrival control", async ({
  page,
}) => {
  await login(page, "main.station1@staff.demo.invalid");
  await page.getByRole("link", { name: "Serving", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Serving", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Scan collection QR" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Scan the student’s pickup QR. They can collect for themselves or a friend.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /confirm arrival|override location/i }),
  ).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: ".local/staff-mobile.png", fullPage: true });
});
test("manager mobile interface keeps stock updates scoped to assigned canteens", async ({
  page,
}) => {
  await login(page, "main.manager@staff.demo.invalid");
  await expect(
    page.getByRole("heading", { name: "A good day, in numbers." }),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: "Online sales dashboard" });
  await expect(
    panel.getByText("PAID ORDER VALUE", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: ".local/manager-dashboard-live.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Last 7 days" }).click();
  await expect(
    panel.getByRole("button", { name: "Last 7 days" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel.getByText("Campus favourites", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await noOverflow(page);
  await page.screenshot({
    path: ".local/manager-dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Stock", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Available stock" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Billing counter", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Canteen" }).locator("option"),
  ).toHaveCount(1);
  await noOverflow(page);
  await page.screenshot({ path: ".local/manager-mobile.png", fullPage: true });
});

test("connected partial pickup: credit checkout, invitation, app geofence, station passes and persistent preparation", async ({
  browser,
  request,
}) => {
  // Live PostgreSQL transactions cross the network; this verifies correctness, not the production latency target.
  test.setTimeout(480000);
  const catalogue = await (await request.get("/api/catalogue")).json();
  const main = catalogue.canteens.find(
    (c: { name: string }) => c.name === "Main",
  );
  expect(main).toBeTruthy();
  const geolocation = {
    latitude: Number(main.lat),
    longitude: Number(main.lng),
    accuracy: 5,
  };
  const payerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation,
  });
  const friendContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation,
  });
  const staffContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const tiffinContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const payer = await payerContext.newPage(),
    friend = await friendContext.newPage(),
    staff = await staffContext.newPage(),
    tiffin = await tiffinContext.newPage();
  try {
    await login(payer, "browser-payer@demo.mint.invalid");
    await payer.getByRole("button", { name: "Choose Main canteen" }).click();
    await payer
      .getByRole("button", { name: "Add Fresh juice", exact: true })
      .click();
    await payer
      .getByRole("button", { name: "Add Fresh juice", exact: true })
      .click();
    await payer
      .getByRole("button", { name: "Add Set Dosa", exact: true })
      .click();
    await payer.getByRole("button", { name: /View cart/ }).click();
    await payer.getByText("Use same-canteen credit", { exact: false }).click();
    await payer.getByRole("button", { name: "Place order" }).click();
    await expect(
      payer.getByText(
        "Order confirmed. Check in with location or show your pass at the counter.",
      ),
    ).toBeVisible();
    const me = await payer.evaluate(
      async () => await (await fetch("/api/me")).json(),
    );
    const orderId = me.orders[0].id as string;
    const view = await payer.evaluate(
      async (id) => await (await fetch("/api/orders/" + id)).json(),
      orderId,
    );
    await payer.getByRole("button", { name: "Share", exact: true }).click();
    await payer
      .locator("label.portion")
      .filter({ hasText: "Badam Milk × 1" })
      .first()
      .locator("input[type=checkbox]")
      .check();
    await payer
      .getByLabel("Friend email", { exact: true })
      .fill("browser-friend@demo.mint.invalid");
    await payer
      .getByRole("button", { name: "Invite for 1 portions", exact: true })
      .click();
    await expect(
      payer.getByText(
        "Invitation sent. Rights transfer only after acceptance.",
      ),
    ).toBeVisible();
    await login(friend, "browser-friend@demo.mint.invalid");
    await friend.getByRole("link", { name: "Orders", exact: true }).click();
    await friend.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(friend.getByText("Pickup assignment accepted.")).toBeVisible();
    // Refresh the emulator's sample timestamp after the network workflow; stale samples must remain rejected.
    await payerContext.setGeolocation({
      latitude: geolocation.latitude,
      longitude: geolocation.longitude,
      accuracy: 5,
    });
    await payer
      .getByRole("button", { name: "Check in through my app" })
      .click();
    await expect(
      payer.getByText("Check-in accepted for your assigned portions."),
    ).toBeVisible();
    await friend
      .getByRole("button")
      .filter({
        hasText: view.units.find(
          (unit: { mode: string }) => unit.mode === "made",
        ).token,
      })
      .first()
      .click();
    await friendContext.setGeolocation({
      latitude: geolocation.latitude,
      longitude: geolocation.longitude,
      accuracy: 5,
    });
    await friend
      .getByRole("button", { name: "Check in through my app" })
      .click();
    await expect(
      friend.getByText("Check-in accepted for your assigned portions."),
    ).toBeVisible();
    await payer.getByRole("button", { name: "Pickup", exact: true }).click();
    await payer.getByRole("button", { name: "Show my station passes" }).click();
    await expect(
      payer.getByAltText("Collection pass for Drinks"),
    ).toBeVisible();
    await noOverflow(payer);
    console.log("Connected check: passes displayed and pickup screenshot");
    await payer.screenshot({
      path: ".local/pickup-mobile.png",
      fullPage: true,
    });
    console.log("Connected check: serving login");
    await login(staff, "main.station2@staff.demo.invalid");
    console.log("Connected check: serving signed in");
    await staff.getByRole("link", { name: "Serving", exact: true }).click();
    console.log("Connected check: student pass fetch");
    const studentPass = await payer.evaluate(
      async (id) =>
        await (
          await fetch("/api/orders/" + id + "/passes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).json(),
      orderId,
    );
    await staff.getByText("Camera not working?", { exact: true }).click();
    await staff
      .getByLabel("Paste QR code", { exact: true })
      .fill(
        studentPass.find(
          (p: { stationName: string }) => p.stationName === "Drinks",
        ).token,
      );
    await staff
      .getByRole("button", { name: "Open pickup", exact: true })
      .click();
    await expect(
      staff.getByText(
        "Verify the collector identity. Confirm only the portions you give to the collector.",
      ),
    ).toBeVisible();
    await staff.locator("input[type=checkbox]").first().check();
    await staff.getByRole("button", { name: "Done · 1 item given" }).click();
    await expect(
      staff.getByText(
        "Handover confirmed. Do not give these portions to another collector.",
      ),
    ).toBeVisible();
    console.log("Connected check: payer portion handed over");
    const friendPass = await friend.evaluate(
      async (id) =>
        await (
          await fetch("/api/orders/" + id + "/passes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).json(),
      orderId,
    );
    await staff
      .getByLabel("Paste QR code", { exact: true })
      .fill(friendPass[0].token);
    await staff
      .getByRole("button", { name: "Open pickup", exact: true })
      .click();
    await staff.locator("input[type=checkbox]").first().check();
    await staff.getByRole("button", { name: "Done · 1 item given" }).click();
    await expect(
      staff.getByText(
        "Handover confirmed. Do not give these portions to another collector.",
      ),
    ).toBeVisible();
    console.log(
      "Connected check: friend portion handed over, preparation login",
    );
    await login(tiffin, "main.station3@staff.demo.invalid");
    await tiffin.getByRole("link", { name: "Serving", exact: true }).click();
    await tiffin.getByRole("button", { name: /^Pending items/ }).click();
    await tiffin
      .locator("div.border.rounded-lg")
      .filter({
        hasText: view.units.find(
          (unit: { mode: string }) => unit.mode === "made",
        ).token,
      })
      .getByRole("button", { name: "Start preparation", exact: true })
      .click();
    await tiffin
      .locator("div.border.rounded-lg")
      .filter({
        hasText: view.units.find(
          (unit: { mode: string }) => unit.mode === "made",
        ).token,
      })
      .getByRole("button", { name: "Mark ready", exact: true })
      .click();
    const madePasses = await payer.evaluate(
      async (id) =>
        await (
          await fetch("/api/orders/" + id + "/passes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).json(),
      orderId,
    );
    const madePass = madePasses.find(
      (pass: { stationName: string }) => pass.stationName === "Tiffin",
    );
    await tiffin
      .getByRole("button", { name: "Scan pickup", exact: true })
      .click();
    await tiffin.getByText("Camera not working?", { exact: true }).click();
    await tiffin
      .getByLabel("Paste QR code", { exact: true })
      .fill(madePass.token);
    await tiffin
      .getByRole("button", { name: "Open pickup", exact: true })
      .click();
    await tiffin.locator("input[type=checkbox]").first().check();
    await tiffin.getByRole("button", { name: "Done · 1 item given" }).click();
    await expect(
      tiffin.getByText(
        "Handover confirmed. Do not give these portions to another collector.",
      ),
    ).toBeVisible();
    console.log("Connected check: prepared portion handed over");
    const final = await payer.evaluate(
      async (id) => await (await fetch("/api/orders/" + id)).json(),
      orderId,
    );
    expect(final.units.length).toBe(3);
    expect(
      final.units.every((u: { state: string }) => u.state === "collected"),
    ).toBeTruthy();
  } finally {
    await Promise.allSettled([
      payerContext.close(),
      friendContext.close(),
      staffContext.close(),
      tiffinContext.close(),
    ]);
  }
});

test("live campus replacement has exact canteen counts and searchable categories", async ({
  page,
}) => {
  await login(page, "payer@demo.mint.invalid");
  await page.getByRole("button", { name: "Choose Main canteen" }).click();
  await expect(page.locator(".food-card")).toHaveCount(84);
  await page.getByRole("button", { name: "Filter menu", exact: true }).click();
  await page.getByLabel("Menu category").selectOption("Today's special");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".food-card")).toHaveCount(7);
  await expect(
    page.getByRole("heading", { name: "Butter Naan", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: ".local/campus-menu-live.png" });
  await page.getByRole("button", { name: "Choose IT canteen" }).click();
  await expect(page.locator(".food-card")).toHaveCount(94);
  await page.getByRole("button", { name: "Filter menu", exact: true }).click();
  await page.getByLabel("Menu category").selectOption("Tiffins");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".food-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Choose MBA canteen" }).click();
  await expect(page.locator(".food-card")).toHaveCount(55);
  await page.getByRole("button", { name: "Filter menu", exact: true }).click();
  await page.getByLabel("Menu category").selectOption("Sweets & puddings");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".food-card")).toHaveCount(5);
  await noOverflow(page);
});
