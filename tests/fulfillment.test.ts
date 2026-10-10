import { test } from "node:test";
import assert from "node:assert/strict";
import { fulfillmentSummary, isClosed } from "../src/lib/fulfillment";
test("pickup summaries distinguish payment, partial collection and cancelled closure", () => {
  assert.equal(
    fulfillmentSummary("pending", [{ state: "ready" }]),
    "Payment pending",
  );
  assert.equal(
    fulfillmentSummary("confirmed", [
      { state: "collected" },
      { state: "cancelled" },
    ]),
    "Closed · partial cancellation",
  );
  assert.equal(
    fulfillmentSummary("confirmed", [
      { state: "collected" },
      { state: "preparing" },
    ]),
    "Partially collected",
  );
  assert.equal(
    fulfillmentSummary("confirmed", [{ state: "collected" }]),
    "Completed",
  );
  assert.equal(
    fulfillmentSummary("confirmed", [{ state: "pending", arrived: true }]),
    "Checked in",
  );
  assert.equal(
    fulfillmentSummary("confirmed", [{ state: "pending" }]),
    "Awaiting arrival",
  );
  assert.equal(
    isClosed([{ state: "collected" }, { state: "cancelled" }]),
    true,
  );
  assert.equal(
    isClosed([{ state: "collected" }, { state: "preparing" }]),
    false,
  );
});
