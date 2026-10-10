import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const menu = JSON.parse(readFileSync("data/campus-menu.json", "utf8")) as {
  canteen: string;
  category: string;
  name: string;
  price: number;
  station: string;
  mode: string;
  quantity: number;
  estimatedPrice: boolean;
}[];
test("campus replacement preserves all items, canteen prices and supplied categories", () => {
  assert.equal(menu.length, 233);
  for (const [canteen, count] of [
    ["Main", 84],
    ["IT", 94],
    ["MBA", 55],
  ] as const)
    assert.equal(menu.filter((item) => item.canteen === canteen).length, count);
  assert.equal(
    new Set(menu.map((item) => item.canteen + ":" + item.name.toLowerCase()))
      .size,
    233,
  );
  for (const item of menu) {
    assert.ok(Number.isInteger(item.price) && item.price > 0);
    assert.ok(
      Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 10000,
    );
    assert.ok(["Main course", "Drinks", "Tiffin"].includes(item.station));
    assert.ok(["ready", "made"].includes(item.mode));
    assert.ok(item.category);
  }
  for (const [canteen, name, price] of [
    ["Main", "Veg Biriyani", 6500],
    ["IT", "Veg Biriyani", 9000],
    ["MBA", "Veg Fried Rice", 6000],
    ["Main", "Pringles (small)", 5500],
    ["Main", "Pringles (large)", 11000],
  ] as const)
    assert.equal(
      menu.find((item) => item.canteen === canteen && item.name === name)
        ?.price,
      price,
    );
});
test("missing prices are explicit and staple stocks exceed premium stocks", () => {
  assert.equal(menu.filter((item) => item.estimatedPrice).length, 11);
  const main = (name: string) =>
    menu.find((item) => item.canteen === "Main" && item.name === name)!;
  assert.ok(
    main("Chicken Biriyani K.L").quantity >
      main("Tandoori Chicken Full").quantity,
  );
  assert.ok(main("Tea").quantity > main("Baskin Robbins Hazelnuts").quantity);
  assert.equal(main("Dil Puff").price, 2500);
  assert.equal(main("Rasmalai").price, 4000);
  assert.equal(main("Egg Dosa").station, "Tiffin");
  assert.equal(main("Egg Dosa").mode, "made");
});
test("menu import defaults to a validated preview without touching the database", () => {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/replace-menu.ts"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "invalid",
        DATABASE_MIGRATION_URL: "invalid",
        DATABASE_SSL_CA_FILE: "missing",
      },
    },
  );
  const result = JSON.parse(output);
  assert.equal(result.mode, "preview");
  assert.equal(
    result.summary.reduce(
      (sum: number, row: { items: number }) => sum + row.items,
      0,
    ),
    233,
  );
});
