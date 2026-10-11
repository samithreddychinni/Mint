import { test } from "node:test";
import assert from "node:assert/strict";
import { missedPickupCredit } from "../src/lib/credit-policy";
test("missed pickup returns 90% and rounds the fine to the nearest paise", () => {
  assert.deepEqual(missedPickupCredit(10000), { credit: 9000, fine: 1000 });
  assert.deepEqual(missedPickupCredit(999), { credit: 899, fine: 100 });
  assert.deepEqual(missedPickupCredit(1), { credit: 1, fine: 0 });
});
