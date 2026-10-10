import { test, expect as browserExpect, type Page } from "@playwright/test";
import QRCode from "qrcode";
const expect = browserExpect.configure({ timeout: 5000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("mint-install-dismissed", String(Date.now())),
  );
});

const serverTime = new Date().toISOString();
const catalogue = {
  serverTime,
  canteens: ["Main", "IT", "MBA"].map((name) => ({
    id: name.toLowerCase(),
    name,
    paused: false,
    demo: false,
  })),
  stations: [
    { id: "drinks", name: "Drinks", canteen_id: "main", paused: false },
    { id: "tiffin", name: "Tiffin", canteen_id: "main", paused: false },
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
    {
      id: "dosa",
      name: "Dosa",
      price: 5000,
      available: 5,
      mode: "made",
      station_name: "Tiffin",
      station_id: "tiffin",
      canteen_id: "main",
      note: "Prepared after check-in",
      paused: false,
      station_paused: false,
    },
    {
      id: "idli",
      name: "Idli",
      price: 3000,
      available: 0,
      mode: "ready",
      station_name: "Tiffin",
      station_id: "tiffin",
      canteen_id: "main",
      note: "",
      paused: false,
      station_paused: false,
    },
  ],
};
const actor = {
  id: "student",
  email: "student@cb.students.amrita.edu",
  kind: "student",
};
const order = {
  id: "order-1",
  reference: "MINT-0001",
  state: "confirmed",
  payer: true,
  canteen_id: "main",
  canteen_name: "Main",
  total: 9000,
  credit: 9000,
  external: 0,
  hold_until: new Date(Date.now() + 180000).toISOString(),
  target_at: new Date(Date.now() + 1500000).toISOString(),
  deadline: new Date(Date.now() + 1800000).toISOString(),
  fulfillment: [{ state: "pending" }, { state: "pending" }],
};
const units = ["juice", "dosa"].map((id) => {
  const item = catalogue.items.find((item) => item.id === id)!;
  return {
    ...item,
    id: `unit-${id}`,
    state: "pending",
    version: 1,
    arrived_at: null as string | null,
    collection_deadline: null,
    collected_at: null,
    collector_id: actor.id,
    collector_name: "Student",
    token: `P-${id}`,
  };
});
const dashboard = {
  actor,
  roles: [],
  orders: [] as (typeof order)[],
  credits: [
    { canteen_id: "main", canteen_name: "Main", available: 20000, reserved: 0 },
  ],
  ledger: [],
  invitations: [],
  serverTime,
};
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
}

test("checkout acknowledges refreshed prices and retains its retry key after an uncertain failure", async ({
  page,
}) => {
  const menu = structuredClone(catalogue);
  const requests: { key: string; lines: { price: number }[] }[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: menu });
    if (path === "/api/checkouts") {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) {
        menu.items[0].price = 4500;
        return route.fulfill({
          status: 409,
          json: {
            code: "PRICE_CHANGED",
            message: "Menu prices changed. Please review.",
          },
        });
      }
      return route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<!DOCTYPE html><title>Gateway error</title>",
      });
    }
    return route.fulfill({ json: dashboard });
  });
  await page.goto("/menu");
  await page.getByRole("button", { name: "Add Fresh juice" }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(
    page.getByRole("button", { name: "Place order" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Accept updated menu prices" })
    .click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(
    page.getByText(
      "MINT is temporarily unavailable. Refresh to check your order before retrying.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Place order" })).toBeEnabled();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests.map((request) => request.lines[0].price)).toEqual([
    4000, 4500, 4500,
  ]);
  expect(requests[0].key).not.toBe(requests[1].key);
  expect(requests[1].key).toBe(requests[2].key);
});

test("menu works at phone and desktop sizes, with readiness, stock, cart and offline states", async ({
  page,
  context,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("catalogue") ? catalogue : dashboard,
    }),
  );
  await page.goto("/menu");
  await expect(
    page.getByRole("heading", { name: "What sounds good?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Idli" })).toBeDisabled();
  await noOverflow(page);
  await page.screenshot({ path: ".local/new-menu-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await noOverflow(page);
  await page.screenshot({
    path: ".local/new-menu-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Ready now", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dosa", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "All items", exact: true }).click();
  await page.getByRole("button", { name: "Add Fresh juice" }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await expect(page.getByText(/not a bank refund/)).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "Place order" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Offline. Data is stale. Actions are disabled."),
  ).toBeVisible();
  await context.setOffline(false);
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
});

test("credit checkout sends prices and quantities, location check-in and portion sharing retain backend contracts", async ({
  page,
  context,
}) => {
  const localDashboard = structuredClone(dashboard);
  const localUnits = structuredClone(units);
  const requests: { path: string; data: Record<string, unknown> }[] = [];
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 11.1,
    longitude: 76.9,
    accuracy: 5,
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST")
      requests.push({ path, data: request.postDataJSON() });
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/me") return route.fulfill({ json: localDashboard });
    if (path === "/api/checkouts") {
      localDashboard.orders = [order];
      return route.fulfill({ json: order });
    }
    if (path === "/api/orders/order-1/check-in") {
      localUnits.forEach((unit) => {
        unit.arrived_at = serverTime;
      });
      return route.fulfill({
        json: {
          accepted: true,
          message: "Check-in accepted for your assigned portions.",
        },
      });
    }
    if (path === "/api/orders/order-1/passes")
      return route.fulfill({
        json: [{ stationName: "Drinks", token: "test-pass", arrived: true }],
      });
    if (path === "/api/orders/order-1/invite")
      return route.fulfill({ json: { ok: true } });
    if (path === "/api/orders/order-1")
      return route.fulfill({
        json: {
          order,
          units: localUnits,
          invitations: [],
          resolutions: [],
          serverTime,
        },
      });
    return route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: path },
    });
  });
  await page.goto("/menu");
  await page.getByRole("button", { name: "Add Fresh juice" }).click();
  await page.getByRole("button", { name: "Add Dosa" }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByLabel("Use same-canteen credit").check();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/orders\/order-1$/);
  const checkout = requests.find(
    (request) => request.path === "/api/checkouts",
  )!.data;
  expect(checkout).toMatchObject({
    canteenId: "main",
    credit: 9000,
    lines: [
      { itemId: "juice", quantity: 1, price: 4000 },
      { itemId: "dosa", quantity: 1, price: 5000 },
    ],
  });
  expect(checkout.key).toEqual(expect.any(String));
  await page.getByRole("button", { name: "Check in through my app" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re checked in." }),
  ).toBeVisible();
  expect(
    requests.find((request) => request.path.endsWith("check-in"))!.data,
  ).toMatchObject({
    latitude: 11.1,
    longitude: 76.9,
    accuracy: 5,
    timestamp: expect.any(Number),
  });
  await page.getByRole("button", { name: "Show my station passes" }).click();
  await expect(page.getByAltText("Collection pass for Drinks")).toBeVisible();
  await page.getByRole("button", { name: "Close pickup passes" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page
    .locator("label.portion")
    .filter({ hasText: "Fresh juice" })
    .locator("input")
    .check();
  await page.getByLabel("Friend email").fill("friend@cb.students.amrita.edu");
  await page.getByRole("button", { name: "Invite for 1 portions" }).click();
  await expect(
    page.getByText("Invitation sent. Rights transfer only after acceptance."),
  ).toBeVisible();
  expect(
    requests.find((request) => request.path.endsWith("invite"))!.data,
  ).toEqual({ ids: ["unit-juice"], email: "friend@cb.students.amrita.edu" });
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Invite for 1 portions" })
    .waitFor({ state: "visible" });
  await expect(
    page.getByRole("button", { name: "Invite for 1 portions" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pickup", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: ".local/new-pickup-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("manager sets online availability, reviews concurrent stock changes and has no billing controls", async ({
  page,
}) => {
  const menu = structuredClone(catalogue);
  const changes: Record<string, unknown>[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: menu });
    if (path === "/api/manager/main") {
      changes.push(route.request().postDataJSON());
      if (changes.length === 1) {
        menu.items[0].available = 6;
        return route.fulfill({
          status: 409,
          json: {
            code: "STOCK_CHANGED",
            message:
              "Stock changed while you were editing. Review the latest availability and save again.",
          },
        });
      }
      menu.items[0].available = Number(changes.at(-1)!.quantity);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        ...dashboard,
        actor: { ...actor, kind: "staff" },
        roles: [{ role: "manager", canteen_id: "main", station_id: null }],
      },
    });
  });
  await page.goto("/manager");
  await expect(
    page.getByRole("heading", { name: "Available stock" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Billing counter" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Record walk-in sale" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Canteen" }).locator("option"),
  ).toHaveCount(1);
  await page.getByLabel("Available portions for Fresh juice").fill("12");
  await page
    .getByRole("button", { name: "Save Fresh juice availability" })
    .click();
  await expect(
    page.getByRole("button", { name: "Review latest stock" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Available portions for Fresh juice"),
  ).toHaveValue("12");
  await page.getByRole("button", { name: "Review latest stock" }).click();
  await page
    .getByRole("button", { name: "Save Fresh juice availability" })
    .click();
  await expect(
    page.getByText("Fresh juice availability updated."),
  ).toBeVisible();
  expect(changes[0]).toMatchObject({
    action: "stock",
    itemId: "juice",
    quantity: 12,
    expectedAvailable: 8,
    key: expect.any(String),
  });
  expect(changes[1]).toMatchObject({ quantity: 12, expectedAvailable: 6 });
  expect(changes[0].key).not.toBe(changes[1].key);
  await expect(
    page.getByRole("button", { name: "Save Fresh juice availability" }),
  ).toBeDisabled();
  await noOverflow(page);
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await page.screenshot({ path: ".local/qa/manager-stock-390.png" });
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`fixed app frame and reachable controls at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const longMenu = {
      ...catalogue,
      items: [
        ...catalogue.items,
        ...Array.from({ length: 12 }, (_, i) => ({
          ...catalogue.items[0],
          id: `extra-${i}`,
          name: `Menu item ${i + 1}`,
        })),
      ],
    };
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json: route.request().url().endsWith("catalogue")
          ? longMenu
          : dashboard,
      }),
    );
    await page.goto("/menu");
    await expect(
      page.getByRole("heading", { name: "What sounds good?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add Menu item 12", exact: true })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "Add Menu item 12", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /View cart/ }),
    ).toBeInViewport();
    const frame = await page.evaluate(() => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).find(
        (button) => button.getAttribute("aria-label") === "Add Menu item 12",
      )!;
      const card = button.closest("article")!.getBoundingClientRect();
      const control = button.getBoundingClientRect();
      const main = document.querySelector("main")!;
      return {
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        height: innerHeight,
        width: innerWidth,
        buttonWidth: control.width,
        buttonHeight: control.height,
        insideCard:
          control.bottom <= card.bottom && control.right <= card.right,
        contentOverflow: main.scrollWidth > main.clientWidth,
      };
    });
    expect(frame.documentHeight).toBeLessThanOrEqual(frame.height);
    expect(frame.documentWidth).toBeLessThanOrEqual(frame.width);
    expect(frame.insideCard).toBe(true);
    expect(frame.contentOverflow).toBe(false);
    expect(frame.buttonWidth).toBeGreaterThanOrEqual(44);
    expect(frame.buttonHeight).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: /View cart/ }).click();
    await expect(
      page.getByRole("button", { name: "Place order" }),
    ).toBeInViewport();
    await page.getByRole("link", { name: "Account", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your account" }),
    ).toBeInViewport();
    await noOverflow(page);
    if (viewport.width === 390 || viewport.width === 1440) {
      await page.screenshot({
        path: `.local/qa/account-${viewport.width}.png`,
      });
      await page.getByRole("link", { name: "Menu", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "What sounds good?" }),
      ).toBeVisible();
      await page.screenshot({ path: `.local/qa/menu-${viewport.width}.png` });
    }
  });
}

test("delegated portions do not falsely claim check-in and delegates have no receipt", async ({
  page,
}) => {
  let payer = true;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/orders/order-1")
      return route.fulfill({
        json: {
          order: { ...order, payer },
          units: units.map((unit) => ({
            ...unit,
            collector_id: "friend",
            collector_name: "Friend",
          })),
          invitations: [],
          resolutions: [],
          serverTime,
        },
      });
    return route.fulfill({ json: dashboard });
  });
  await page.goto("/orders/order-1");
  await expect(
    page.getByRole("heading", { name: "Pickup assigned to friends" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check in through my app" }),
  ).toHaveCount(0);
  payer = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Receipt", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Total paid", { exact: true })).toHaveCount(0);
});

test("staff partial handover keeps preparation tokens and permits the next pickup", async ({
  page,
}) => {
  const ready = {
    ...units[0],
    arrived_at: serverTime,
    reference: order.reference,
  };
  const made = {
    ...units[1],
    arrived_at: serverTime,
    reference: order.reference,
  };
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/staff/resolve")
      return route.fulfill({
        json: {
          units: [ready, made],
          message: "Verify the collector identity.",
        },
      });
    if (path === "/api/staff/handover") {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/staff/worklist") return route.fulfill({ json: [made] });
    return route.fulfill({
      json: {
        ...dashboard,
        actor: { ...actor, kind: "staff" },
        roles: [
          {
            role: "serving",
            canteen_id: "main",
            canteen_name: "Main",
            station_id: "drinks",
            station_name: "Drinks",
          },
        ],
      },
    });
  });
  await page.goto("/staff");
  await expect(
    page.getByRole("link", { name: "Stock", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Billing counter" })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Paste QR code", { exact: true }),
  ).not.toBeVisible();
  await page.getByText("Camera not working?", { exact: true }).click();
  await page.getByLabel("Paste QR code", { exact: true }).fill("sample-pass");
  await page.getByRole("button", { name: "Open pickup", exact: true }).click();
  await page
    .locator("label")
    .filter({ hasText: "Fresh juice × 1" })
    .locator("input")
    .check();
  await expect(
    page.locator("label").filter({ hasText: "Dosa × 1" }).locator("input"),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Done · 1 item given" }).click();
  await expect(
    page.getByText(
      "Handover confirmed. Do not give these portions to another collector.",
    ),
  ).toBeVisible();
  expect(posts[0]).toMatchObject({
    stationId: "drinks",
    portions: [{ id: "unit-juice", version: 1 }],
    key: expect.any(String),
  });
  await expect(
    page
      .getByRole("region", { name: "Scanned pickup" })
      .getByText("Dosa × 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next pickup", exact: true }).click();
  await expect(page.getByLabel("Paste QR code", { exact: true })).toHaveValue(
    "",
  );
  await page.screenshot({ path: ".local/qa/serving-390.png" });
});

test("camera scan reads the QR and displays arrived portions without a second resolve click", async ({
  page,
}) => {
  const image = await QRCode.toDataURL("camera-test-pass", {
    width: 640,
    margin: 4,
  });
  await page.addInitScript((src) => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 640;
        const image = new Image();
        image.src = src;
        await image.decode();
        const ctx = canvas.getContext("2d")!;
        const draw = () => {
          ctx.drawImage(image, 0, 0);
          requestAnimationFrame(draw);
        };
        draw();
        return canvas.captureStream(10);
      },
    });
  }, image);
  let resolves = 0,
    handovers = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/staff/worklist") return route.fulfill({ json: [] });
    if (path === "/api/staff/resolve") {
      resolves++;
      expect(route.request().postDataJSON()).toMatchObject({
        token: "camera-test-pass",
        stationId: "drinks",
      });
      return route.fulfill({
        json: {
          units: [
            { ...units[0], arrived_at: serverTime, reference: order.reference },
          ],
          message: "Arrival confirmed. Verify the collector identity.",
        },
      });
    }
    if (path === "/api/staff/handover") handovers++;
    return route.fulfill({
      json: {
        ...dashboard,
        actor: { ...actor, kind: "staff" },
        roles: [
          {
            role: "serving",
            canteen_id: "main",
            station_id: "drinks",
            station_name: "Drinks",
          },
        ],
      },
    });
  });
  await page.goto("/staff");
  await page.getByRole("button", { name: "Scan collection QR" }).click();
  await expect(
    page.getByText("Arrival confirmed. Verify the collector identity."),
  ).toBeVisible();
  await expect(
    page
      .locator("label")
      .filter({ hasText: "Fresh juice × 1" })
      .locator("input"),
  ).toBeEnabled();
  expect(resolves).toBe(1);
  expect(handovers).toBe(0);
});

test("pencil exposes menu settings, saves paise and keeps stock editing separate", async ({
  page,
}) => {
  const menu = structuredClone(catalogue);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: menu });
    if (path === "/api/manager/main") {
      const data = route.request().postDataJSON();
      requests.push(data);
      Object.assign(menu.items[0], {
        name: data.name,
        price: data.price,
        paused: data.paused,
      });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        ...dashboard,
        actor: { ...actor, kind: "staff" },
        roles: [{ role: "manager", canteen_id: "main", station_id: null }],
      },
    });
  });
  await page.goto("/manager");
  await expect(page.getByLabel("Item name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Fresh juice details" }).click();
  await page.getByLabel("Item name", { exact: true }).fill("Orange juice");
  await page.getByLabel("Price in rupees").fill("45.50");
  await page.getByLabel("Default portions").fill("12");
  await page.getByLabel("Available for new orders").uncheck();
  await page.getByRole("button", { name: "Use default for stock" }).click();
  await expect(
    page.getByLabel("Available portions for Fresh juice"),
  ).toHaveValue("12");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Save item details" }).click();
  await expect(page.getByText("Item details updated.")).toBeVisible();
  expect(requests[0]).toMatchObject({
    action: "item-settings",
    name: "Orange juice",
    price: 4550,
    paused: true,
    defaultQuantity: 12,
    expectedSettings: JSON.stringify(["Fresh juice", 4000, "", false, 0]),
  });
  await expect(page.getByLabel("Item name", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Orange juice", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});

test("student completes private profile once, edits it and opens live in-app updates", async ({
  page,
}) => {
  const me = {
    ...structuredClone(dashboard),
    profile: {
      name: "email-id",
      phone: null as string | null,
      completed_at: null as string | null,
    },
    orders: [order],
  };
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/profile") {
      const data = route.request().postDataJSON();
      posted.push(data);
      me.profile = {
        name: data.name,
        phone: "+91" + data.phone.replace(/\s/g, ""),
        completed_at: serverTime,
      };
      return route.fulfill({ json: me.profile });
    }
    return route.fulfill({ json: me });
  });
  await page.goto("/menu");
  await expect(
    page.getByRole("heading", { name: "Make MINT yours" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What sounds good?" }),
  ).toHaveCount(0);
  await page.getByLabel("Your name", { exact: true }).fill("Campus Student");
  await page.getByLabel("Mobile number", { exact: true }).fill("9000000001");
  await page.getByRole("button", { name: "Continue to MINT" }).click();
  await expect(
    page.getByRole("heading", { name: "What sounds good?" }),
  ).toBeVisible();
  expect(posted).toEqual([{ name: "Campus Student", phone: "9000000001" }]);
  await page.getByRole("button", { name: "Order updates" }).click();
  await expect(
    page.getByRole("dialog", { name: "Your updates" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/MINT-0001/)).toBeVisible();
  await page.getByRole("button", { name: "Close order updates" }).click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Campus Student", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Your name", { exact: true }).fill("Updated Student");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated Student", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});

test("shared recipient has preparation controls beside scanned items and can complete handover", async ({
  page,
}) => {
  const portion = {
    ...units[1],
    collector_name: "Verified Friend",
    collector_id: "friend",
    version: 7,
    arrived_at: serverTime,
    reference: order.reference,
  };
  const handovers: Record<string, unknown>[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") return route.fulfill({ json: catalogue });
    if (path === "/api/staff/worklist")
      return route.fulfill({
        json: portion.state === "collected" ? [] : [portion],
      });
    if (path === "/api/staff/resolve")
      return route.fulfill({
        json: {
          units: [portion],
          message: "Pickup QR accepted. They may be collecting for a friend.",
        },
      });
    if (path === "/api/staff/preparation") {
      portion.state =
        route.request().postDataJSON().action === "start"
          ? "preparing"
          : "ready";
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/staff/handover") {
      handovers.push(route.request().postDataJSON());
      portion.state = "collected";
      return route.fulfill({ json: { collected: 1 } });
    }
    return route.fulfill({
      json: {
        ...dashboard,
        actor: { ...actor, kind: "staff" },
        roles: [{ role: "serving", canteen_id: "main", station_id: "tiffin" }],
      },
    });
  });
  await page.goto("/staff");
  await page.getByText("Camera not working?", { exact: true }).click();
  await page.getByLabel("Paste QR code", { exact: true }).fill("friend-pass");
  await page.getByRole("button", { name: "Open pickup", exact: true }).click();
  await expect(
    page.getByText("Verified Friend", { exact: true }),
  ).toBeVisible();
  const check = page
    .locator("label")
    .filter({ hasText: "Dosa × 1" })
    .locator("input");
  await expect(check).toBeDisabled();
  await page.getByRole("button", { name: "Start Dosa", exact: true }).click();
  await page
    .getByRole("button", { name: "Mark Dosa ready", exact: true })
    .click();
  await expect(check).toBeEnabled();
  await check.check();
  await page.getByRole("button", { name: "Done · 1 item given" }).click();
  expect(handovers[0]).toMatchObject({
    stationId: "tiffin",
    portions: [{ id: "unit-dosa", version: 7 }],
  });
  await expect(page.getByText("Dosa × 1", { exact: true })).toHaveCount(0);
});
