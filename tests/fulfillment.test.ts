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

test("expired portions close the pickup and cannot appear as awaiting arrival", () => {
  assert.equal(
    fulfillmentSummary("confirmed", [{ state: "expired" }]),
    "Pickup expired",
  );
  assert.equal(isClosed([{ state: "expired" }, { state: "collected" }]), true);
  assert.equal(
    fulfillmentSummary("confirmed", [
      { state: "expired" },
      { state: "collected" },
    ]),
    "Closed · uncollected portions",
  );
  assert.equal(isClosed([{ state: "expired" }, { state: "ready" }]), false);
});
