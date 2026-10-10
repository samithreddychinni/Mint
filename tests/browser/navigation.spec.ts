import { test, expect as browserExpect } from "@playwright/test";
const expect = browserExpect.configure({ timeout: 5000 });
const catalogue = {
  canteens: [
    { id: "main", name: "Main", paused: false, demo: false },
    { id: "it", name: "IT", paused: false, demo: false },
  ],
  stations: [
    { id: "drinks", name: "Drinks", canteen_id: "main", paused: false },
  ],
  items: [
    {
      id: "juice",
      name: "Fresh juice",
      price: 4000,
      available: 8,
      mode: "ready",
      station_name: "Drinks",
      station_id: "drinks",
      canteen_id: "main",
      note: "",
      paused: false,
      station_paused: false,
    },
  ],
  serverTime: new Date().toISOString(),
};
test("app routes preserve the cart, require confirmation for canteen changes and clear private state on logout", async ({
  page,
}) => {
  let signedIn = true;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/auth/logout") {
      signedIn = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (!signedIn)
      return route.fulfill({
        status: 401,
        json: {
          code: "UNAUTHENTICATED",
          message: "Sign in with a verified account.",
        },
      });
    return route.fulfill({
      json: {
        actor: {
          id: "student",
          email: "student@cb.students.amrita.edu",
          kind: "student",
        },
        roles: [],
        orders: [],
        credits: [],
        ledger: [],
        invitations: [],
        serverTime: catalogue.serverTime,
      },
    });
  });
  await page.goto("/menu");
  await page.getByRole("button", { name: "Add Fresh juice" }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(
    page.getByRole("heading", { name: "Review order" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(
    page.getByRole("button", { name: /1 item · View cart/ }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Choose IT canteen" }).click();
  await expect(
    page.getByRole("button", { name: "Choose Main canteen" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: /Canteen credit/ }).click();
  await expect(page).toHaveURL(/\/credit$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Cart,/ })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "What sounds good?", exact: true }),
  ).toHaveCount(0);
});
test("Pending items contains preparation jobs and keeps ready stock in the scan flow", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/staff/worklist")
      return route.fulfill({
        json: [
          {
            id: "portion",
            name: "Fresh juice",
            state: "preparing",
            mode: "made",
            version: 1,
            station_id: "drinks",
            station_name: "Drinks",
            arrived_at: catalogue.serverTime,
            collector_name: "Student",
            reference: "MINT-TEST",
            token: "P1",
          },
        ],
      });
    return route.fulfill({
      json: {
        actor: { id: "staff", email: "staff@canteen.invalid", kind: "staff" },
        roles: [
          {
            role: "serving",
            canteen_id: "main",
            station_id: "drinks",
            canteen_name: "Main",
            station_name: "Drinks",
          },
        ],
        orders: [],
        credits: [],
        ledger: [],
        invitations: [],
        serverTime: catalogue.serverTime,
      },
    });
  });
  await page.goto("/staff");
  await page.getByRole("button", { name: /^Pending items/ }).click();
  await expect(
    page.getByText("Fresh juice × 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark ready", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scan pickup", exact: true }).click();
  await expect(
    page.getByLabel("Paste QR code", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /confirm arrival|override location/i }),
  ).toHaveCount(0);
});
test("sign-in has no marketing section or menu and the manifest includes installable icons", async ({
  page,
}) => {
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({ json: catalogue }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({
      status: 401,
      json: {
        code: "UNAUTHENTICATED",
        message: "Sign in with a verified account.",
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What sounds good?", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/development demo|your next break|live stock/i),
  ).toHaveCount(0);
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(
    manifest.icons.some((icon: { sizes: string }) => icon.sizes === "192x192"),
  ).toBeTruthy();
  for (const icon of manifest.icons)
    expect((await page.request.get(icon.src)).status()).toBe(200);
  await page.getByRole("button", { name: "Staff sign in" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Password", { exact: true }),
  ).toHaveAccessibleDescription(
    "Use the account assigned by your canteen administrator.",
  );
  await page.screenshot({
    path: ".local/app-signin-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: ".local/app-signin-desktop.png",
    fullPage: true,
  });
});
