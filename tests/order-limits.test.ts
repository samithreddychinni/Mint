import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickupTier,
  LIMIT_TIERS,
  itemAllowance,
  type OrderLimits,
} from "../src/lib/order-limits";
test("pickup tiers reward successful days and recover from attributable no-shows", () => {
  assert.equal(pickupTier(0, 0, 0, 0), "standard");
  assert.equal(pickupTier(5, 5, 0, 0), "reliable");
  assert.equal(pickupTier(20, 21, 0, 0), "established");
  assert.equal(pickupTier(20, 30, 0, 0), "standard");
  assert.equal(pickupTier(20, 21, 3, 1), "restricted");
  assert.equal(pickupTier(20, 21, 3, 2), "established");
});
test("item exceptions stay inside scarcity and restricted-tier safety caps", () => {
  const p: OrderLimits = {
    tier: "standard",
    limits: LIMIT_TIERS.standard,
    usage: { activeOrders: 0, outstanding: 0, meals: 0, drinks: 0, byItem: {} },
    completedDays: 0,
    cooldownUntil: null,
  };
  assert.equal(itemAllowance({ available: 80 }, p), 2);
  assert.equal(itemAllowance({ available: 80, order_group: "bread" }, p), 6);
  assert.equal(itemAllowance({ available: 10, order_group: "bread" }, p), 1);
  assert.equal(itemAllowance({ available: 80, order_cap: 1 }, p), 1);
  assert.equal(
    itemAllowance(
      { available: 80, order_group: "bread" },
      { ...p, tier: "restricted", limits: LIMIT_TIERS.restricted },
    ),
    1,
  );
});
