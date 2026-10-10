import { test, expect as browserExpect, type Page } from "@playwright/test";
import QRCode from "qrcode";
import campusMenu from "../../data/campus-menu.json" with { type: "json" };
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
    orderCap: 0,
    expectedOrderCap: 0,
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
    invitations: [
      {
        id: "incoming",
        state: "pending",
        sender_name: "Campus Friend",
        portions: [{ name: "Dosa", station: "Tiffin" }],
      },
    ],
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
  await page
    .getByRole("button", { name: "Order updates", exact: true })
    .click();
  const bell = await page
    .getByRole("button", { name: "Order updates", exact: true })
    .boundingBox();
  const dot = await page.locator(".update-dot").boundingBox();
  expect(dot!.x).toBeGreaterThanOrEqual(bell!.x);
  expect(dot!.x + dot!.width).toBeLessThanOrEqual(bell!.x + bell!.width);
  await expect(
    page.getByRole("dialog", { name: "Your updates" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Campus Friend invited you to collect"),
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

test("order details render while a menu refresh is blocked and an old response cannot replace another order", async ({
  page,
}) => {
  let slowMenu = false;
  let releaseMenu!: () => void;
  const menuGate = new Promise<void>((resolve) => {
    releaseMenu = resolve;
  });
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const second = { ...order, id: "order-2", reference: "MINT-0002" };
  let detailReads = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalogue") {
      if (slowMenu) await menuGate;
      return route.fulfill({ json: catalogue });
    }
    if (path === "/api/orders/order-1") {
      detailReads++;
      // The second request is a delayed refresh of the order being left behind.
      if (detailReads > 1) await oldGate;
      return route.fulfill({
        json: { order, units, invitations: [], resolutions: [], serverTime },
      });
    }
    if (path === "/api/orders/order-2")
      return route.fulfill({
        json: {
          order: second,
          units,
          invitations: [],
          resolutions: [],
          serverTime,
        },
      });
    return route.fulfill({ json: { ...dashboard, orders: [order, second] } });
  });
  await page.goto("/orders");
  await expect(
    page.getByRole("heading", { name: "Your orders", exact: true }),
  ).toBeVisible();
  slowMenu = true;
  await page.getByRole("button", { name: /MINT-0001/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your pickup" }),
  ).toBeVisible();
  await expect(
    page.getByText("MINT-0001", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => detailReads).toBe(2);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: /MINT-0002/ }).click();
  await expect(
    page.getByText("MINT-0002", { exact: false }).first(),
  ).toBeVisible();
  const oldResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/orders/order-1"),
  );
  releaseOld();
  releaseMenu();
  await (await oldResponse).finished();
  await expect(
    page.getByRole("main").getByText("MINT-0001", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your pickup" }),
  ).toBeVisible();
});

test("manager dashboard is scoped, shows separate money totals, changes period and stays inside the app frame", async ({
  page,
}) => {
  let fail = false;
  const periods: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/catalogue")
      return route.fulfill({ json: catalogue });
    if (url.pathname.endsWith("/summary")) {
      expect(url.pathname).toBe("/api/manager/main/summary");
      const period = url.searchParams.get("period")!;
      periods.push(period);
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            code: "UNAVAILABLE",
            message: "Sales are temporarily unavailable.",
          },
        });
      return route.fulfill({
        json: {
          canteen_id: "main",
          period,
          start_at: serverTime,
          server_time: serverTime,
          paid_orders: period === "today" ? 12 : 48,
          paid_value: period === "today" ? 145000 : 650000,
          payments_captured: 100000,
          credit_used: 45000,
          credit_issued: 5000,
          credit_balance: 250000,
          collected_portions: 26,
          pending_portions: 7,
          arrived_portions: 3,
          payment_reviews: 1,
          pending_refunds: 0,
          overdue_portions: 0,
          paused_items: 1,
          worker_healthy: true,
          popular_items: [{ name: "Fresh juice", portions: 18, value: 72000 }],
          low_stock: [{ id: "idli", name: "Idli", available: 0 }],
        },
      });
    }
    return route.fulfill({
      json: {
        ...dashboard,
        actor: { ...actor, kind: "staff" },
        roles: [{ role: "manager", canteen_id: "main", station_id: null }],
      },
    });
  });
  await page.goto("/dashboard");
  const panel = page.getByRole("region", { name: "Online sales dashboard" });
  await expect(panel.getByText("₹1,450.00", { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await noOverflow(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBeTruthy();
    await expect(
      page.getByRole("link", { name: "Dashboard", exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole("button", { name: "Last 7 days" }).click();
  await expect(panel.getByText("₹6,500.00", { exact: true })).toBeVisible();
  expect(periods).toContain("week");
  await expect(panel.getByText("Sold out", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".local/qa/manager-dashboard-mobile.png",
    fullPage: true,
  });
  fail = true;
  await panel.getByRole("button", { name: "Today", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Sales are temporarily unavailable.",
  );
  fail = false;
  await panel.getByRole("button", { name: "Retry sales" }).click();
  await expect(panel.getByText("₹1,450.00", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Stock", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Available stock" }),
  ).toBeVisible();
});

test("navigation and repeated refresh share pending reads without retaining completed data", async ({
  page,
}) => {
  let delayed = false;
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/catalogue") {
      reads++;
      if (delayed) await gate;
      return route.fulfill({ json: catalogue });
    }
    return route.fulfill({ json: dashboard });
  });
  await page.goto("/menu");
  await expect(
    page.getByRole("button", { name: "Add Fresh juice" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  const initial = reads;
  delayed = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => reads).toBe(initial + 1);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your orders", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  expect(reads).toBe(initial + 1);
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveAttribute("aria-busy", "true");
  delayed = false;
  release();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => reads).toBe(initial + 2);
});

test("full campus menu categories, canteen prices and manager search fit the fixed app", async ({
  page,
}) => {
  let manager = false;
  const fullCatalogue = {
    ...catalogue,
    items: campusMenu.map((item, index) => ({
      ...catalogue.items[0],
      id: `campus-${index}`,
      canteen_id: item.canteen.toLowerCase(),
      name: item.name,
      category: item.category,
      price: item.price,
      mode: item.mode,
      available: item.quantity,
      default_quantity: item.quantity,
      station_name: item.station,
    })),
  };
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("catalogue")
        ? fullCatalogue
        : manager
          ? {
              ...dashboard,
              actor: { ...actor, kind: "staff" },
              roles: [
                { role: "manager", canteen_id: "main", station_id: null },
              ],
            }
          : dashboard,
    }),
  );
  await page.goto("/menu");
  await expect(page.locator(".food-card")).toHaveCount(84);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await noOverflow(page);
    await expect(page.getByLabel("Menu category")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Menu category").selectOption("Curries");
  await expect(page.locator(".food-card")).toHaveCount(6);
  const paneer = page.locator(".food-card").filter({
    has: page.getByRole("heading", {
      name: "Paneer Butter Masala",
      exact: true,
    }),
  });
  await expect(paneer.getByText("₹95.00", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".local/campus-menu-mobile.png" });
  await page.getByRole("button", { name: "Choose IT canteen" }).click();
  await expect(page.locator(".food-card")).toHaveCount(94);
  await page.getByLabel("Menu category").selectOption("Tiffins");
  await expect(page.locator(".food-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Choose MBA canteen" }).click();
  await expect(page.locator(".food-card")).toHaveCount(55);
  await expect(page.getByLabel("Menu category")).toHaveValue("");
  manager = true;
  await page.goto("/manager");
  await expect(page.locator(".stock-editor")).toHaveCount(84);
  await page.getByLabel("Menu category").selectOption("Curries");
  await expect(page.locator(".stock-editor")).toHaveCount(6);
  await page.getByLabel("Search stock").fill("paneer");
  await expect(page.locator(".stock-editor")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Paneer Butter Masala", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});

test("student ordering allowances explain active caps and block meal variants without hiding pickups", async ({
  page,
}) => {
  let blocked = false;
  const limits = {
    tier: "standard",
    limits: {
      activeOrders: 2,
      perOrder: 6,
      outstanding: 10,
      meals: 2,
      drinks: 4,
      perItem: 2,
    },
    usage: { activeOrders: 0, outstanding: 0, meals: 0, drinks: 0, byItem: {} },
    completedDays: 0,
    cooldownUntil: null,
  };
  const menu = {
    ...catalogue,
    items: catalogue.items.map((i) => ({
      ...i,
      available: 30,
      order_group: i.id === "juice" ? "drink" : "meal",
    })),
  };
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("catalogue")
        ? menu
        : {
            ...dashboard,
            limits: {
              ...limits,
              usage: { ...limits.usage, activeOrders: blocked ? 2 : 0 },
            },
          },
    }),
  );
  await page.goto("/menu");
  await page.getByRole("button", { name: "Add Dosa", exact: true }).click();
  await page.getByRole("button", { name: "Add Dosa", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Idli", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add Fresh juice", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Remove Dosa", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Idli", exact: true }),
  ).toBeEnabled();
  blocked = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(
      "You have 2 active orders. Open Orders to finish a pickup or resume payment.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add Fresh juice", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Open Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your orders", exact: true }),
  ).toBeVisible();
});
