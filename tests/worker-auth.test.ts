import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { workerAuthorized } from "../src/jobs/auth";
test("scheduler authentication rejects missing, forged, stale and future signatures", () => {
  const secret = "controlled-test-secret-not-a-credential";
  const now = 1791644400000;
  const headers = (time: string, signature?: string) =>
    new Headers({
      "x-mint-worker-time": time,
      "x-mint-worker-signature":
        signature ?? createHmac("sha256", secret).update(time).digest("hex"),
    });
  assert.equal(
    workerAuthorized(headers(String(now / 1000)), secret, now),
    true,
  );
  assert.equal(workerAuthorized(new Headers(), secret, now), false);
  assert.equal(
    workerAuthorized(headers(String(now / 1000), "0".repeat(64)), secret, now),
    false,
  );
  assert.equal(
    workerAuthorized(headers(String(now / 1000 - 61)), secret, now),
    false,
  );
  assert.equal(
    workerAuthorized(headers(String(now / 1000 + 6)), secret, now),
    false,
  );
  assert.equal(
    workerAuthorized(headers(String(now / 1000)), undefined, now),
    false,
  );
});
