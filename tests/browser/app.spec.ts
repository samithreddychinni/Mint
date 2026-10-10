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
  await expect(
    page.getByRole("heading", { name: "What sounds good?", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByLabel("Search menu", { exact: true }).fill("Dosa");
  await expect(
    page.getByRole("heading", { name: "Dosa", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fresh juice", exact: true }),
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
      "Scanning a valid pass checks in the collector and shows their portions. Confirm handover only after giving items.",
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
    await payer.getByRole("button", { name: "Add Dosa", exact: true }).click();
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
      .filter({ hasText: "Fresh juice × 1" })
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
      latitude: 0.01,
      longitude: 0.01,
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
      .filter({ hasText: view.order.reference })
      .first()
      .click();
    await friendContext.setGeolocation({
      latitude: 0.01,
      longitude: 0.01,
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
    await staff
      .getByLabel("Collection pass", { exact: true })
      .fill(
        studentPass.find(
          (p: { stationName: string }) => p.stationName === "Drinks",
        ).token,
      );
    await staff
      .getByRole("button", { name: "Resolve pass", exact: true })
      .click();
    await expect(
      staff.getByText(
        "Verify the collector identity. Confirm only the portions you give to the collector.",
      ),
    ).toBeVisible();
    await staff.locator("input[type=checkbox]").first().check();
    await staff
      .getByRole("button", { name: "Handed over: 1 portions" })
      .click();
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
      .getByLabel("Collection pass", { exact: true })
      .fill(friendPass[0].token);
    await staff
      .getByRole("button", { name: "Resolve pass", exact: true })
      .click();
    await staff.locator("input[type=checkbox]").first().check();
    await staff
      .getByRole("button", { name: "Handed over: 1 portions" })
      .click();
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
    await tiffin.getByRole("button", { name: "Queue", exact: true }).click();
    await tiffin.getByRole("button", { name: /^Awaiting prep/ }).click();
    await tiffin
      .locator("div.border.rounded-lg")
      .filter({ hasText: view.order.reference })
      .getByRole("button", { name: "Start preparation", exact: true })
      .click();
    await tiffin.getByRole("button", { name: /^Preparing/ }).click();
    await tiffin
      .locator("div.border.rounded-lg")
      .filter({ hasText: view.order.reference })
      .getByRole("button", { name: "Mark ready", exact: true })
      .click();
    await tiffin.getByRole("button", { name: /^Ready/ }).click();
    await tiffin
      .locator("div.border.rounded-lg")
      .filter({ hasText: view.order.reference })
      .getByRole("button", { name: "Inspect for handover" })
      .click();
    await tiffin.locator("input[type=checkbox]").first().check();
    await tiffin
      .getByRole("button", { name: "Handed over: 1 portions" })
      .click();
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
