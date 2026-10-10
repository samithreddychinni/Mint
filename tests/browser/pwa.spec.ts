import { test, expect as browserExpect } from "@playwright/test";
const expect = browserExpect.configure({ timeout: 5000 });
const catalogue = {
  canteens: [{ id: "main", name: "Main", paused: false }],
  stations: [],
  items: [],
  serverTime: new Date().toISOString(),
};
const me = {
  actor: {
    id: "student",
    kind: "student",
    email: "student@cb.students.amrita.edu",
  },
  roles: [],
  orders: [],
  credits: [],
  ledger: [],
  invitations: [],
  serverTime: catalogue.serverTime,
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("catalogue") ? catalogue : me,
    }),
  );
});
test("automatic install popup is dismissible and manual instructions remain available", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/menu");
  await expect(
    page.getByRole("button", { name: "Install MINT" }),
  ).toBeVisible();
  await page.clock.runFor(8000);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.clock.runFor(22000);
  await expect(
    page.getByRole("dialog", { name: "Add MINT to your home screen" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(page.getByText(/Open your browser menu/)).toBeVisible();
  await page.getByRole("button", { name: "Keep using the browser" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    Number(
      await page.evaluate(() => localStorage.getItem("mint-install-dismissed")),
    ),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Install MINT" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Install MINT" }),
  ).toBeFocused();
});
test("native prompt requires a click and accepted prompt waits for installation completion", async ({
  page,
}) => {
  await page.goto("/menu");
  await expect(
    page.getByRole("button", { name: "Install MINT" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        (window as Window & { prompted?: boolean }).prompted = true;
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Install MINT" }).click();
  await expect(
    page.getByRole("button", { name: "Add to home screen" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { prompted?: boolean }).prompted,
    ),
  ).toBeUndefined();
  await page.getByRole("button", { name: "Add to home screen" }).click();
  expect(
    await page.evaluate(
      () => (window as Window & { prompted?: boolean }).prompted,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Install MINT" }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByRole("button", { name: "Install MINT" })).toHaveCount(
    0,
  );
});
test("iOS manual instructions explain Safari Share", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("catalogue") ? catalogue : me,
    }),
  );
  await page.goto("/menu");
  await page.getByRole("button", { name: "Install MINT" }).click();
  await expect(page.getByText(/Tap Share in Safari/)).toBeVisible();
  await page.screenshot({ path: ".local/qa/install-ios.png" });
  await context.close();
});
test("standalone mode suppresses the install control", async ({ page }) => {
  await page.addInitScript(() => {
    const match = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === "(display-mode: standalone)"
        ? Object.defineProperty(match(query), "matches", { value: true })
        : match(query);
  });
  await page.goto("/menu");
  await expect(
    page.getByRole("heading", { name: "What sounds good?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Install MINT" })).toHaveCount(
    0,
  );
});
test("checkout does not display the automatic install popup", async ({
  page,
}) => {
  await page.goto("/cart");
  await expect(
    page.getByRole("heading", { name: "Review order" }),
  ).toBeVisible();
  await page.waitForTimeout(8500);
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("activity postpones the automatic install popup until the user is idle", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/menu");
  await expect(
    page.getByRole("heading", { name: "What sounds good?" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {},
      userChoice: new Promise(() => {}),
    });
    window.dispatchEvent(event);
  });
  await page.clock.runFor(7000);
  await page.keyboard.press("Tab");
  await page.clock.runFor(2000);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.clock.runFor(6000);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Android Chrome shows actionable installation steps and old dismissal expires", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; DN2101) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  });
  await context.addInitScript(() =>
    localStorage.setItem("mint-install-dismissed", "1"),
  );
  const page = await context.newPage();
  await page.clock.install();
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("catalogue") ? catalogue : me,
    }),
  );
  await page.goto("/menu");
  await expect(
    page.getByRole("button", { name: "Install MINT" }),
  ).toBeVisible();
  await page.clock.runFor(31000);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/In Chrome, tap/)).toContainText(
    "Add to home screen → Install",
  );
  await page.screenshot({ path: ".local/qa/install-android.png" });
  await page.getByRole("button", { name: "Keep using the browser" }).click();
  await page.clock.runFor(30000);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await context.close();
});
