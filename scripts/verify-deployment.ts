import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const origin = process.env.MINT_DEPLOYMENT_URL!;
assert.ok(origin?.startsWith("https://"));
const accounts = JSON.parse(readFileSync(".local/demo-accounts.json", "utf8"));
const results: Record<string, unknown> = {
  origin,
  checkedAt: new Date().toISOString(),
};
class Session {
  cookies = new Map<string, string>();
  async call(path: string, data?: unknown, expected = 200) {
    const r = await fetch(origin + "/api/" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(290000),
    });
    for (const value of r.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const result = await r.json();
    assert.equal(
      r.status,
      expected,
      `Hosted endpoint failed: ${path} (${result.code || "unknown"})`,
    );
    return result;
  }
  async login(email: string) {
    await this.call("auth/password", {
      email,
      password: accounts[email].password,
    });
  }
}
const publicSession = new Session();
const page = await fetch(origin, { signal: AbortSignal.timeout(30000) });
assert.equal(page.status, 200);
results.page = 200;
const start = Date.now();
const menu = await publicSession.call("catalogue");
results.catalogue = {
  status: 200,
  elapsedMs: Date.now() - start,
  canteens: menu.canteens.length,
};
await publicSession.call("me", undefined, 401);
results.unauthenticatedProtectedRequest = 401;
const forged = await fetch(origin + "/api/internal/worker", {
  method: "POST",
  body: "{}",
});
assert.equal(forged.status, 401);
results.unauthenticatedWorker = 401;
const time = String(Math.floor(Date.now() / 1000));
const signed = await fetch(origin + "/api/internal/worker", {
  method: "POST",
  headers: {
    "x-mint-worker-time": time,
    "x-mint-worker-signature": createHmac(
      "sha256",
      process.env.WORKER_AUTH_SECRET!,
    )
      .update(time)
      .digest("hex"),
  },
  body: "{}",
  signal: AbortSignal.timeout(290000),
});
assert.equal(signed.status, 200);
assert.equal((await signed.json()).completed, true);
results.authenticatedWorker = 200;
console.log(
  "Hosted app, private API boundary and shared Node worker checks passed.",
);
const buyer = new Session(),
  serving = new Session(),
  manager = new Session();
try {
  await buyer.login("payer@demo.mint.invalid");
  const me = await buyer.call("me");
  assert.equal(me.actor.kind, "student");
  const canteen = menu.canteens.find((c: { name: string }) => c.name === "IT");
  const juice = menu.items.find(
    (i: { name: string; canteen_id: string }) =>
      i.name === "Fresh juice" && i.canteen_id === canteen.id,
  );
  const existing = existsSync(".local/hosted-test-order.json")
    ? JSON.parse(readFileSync(".local/hosted-test-order.json", "utf8"))
    : null;
  const checkout = existing
    ? (await buyer.call(`orders/${existing.id}`)).order
    : await buyer.call("checkouts", {
        canteenId: canteen.id,
        lines: [{ itemId: juice.id, quantity: 1, price: juice.price }],
        credit: juice.price,
        key: randomUUID(),
      });
  writeFileSync(
    ".local/hosted-test-order.json",
    JSON.stringify({ id: checkout.id }),
    { mode: 0o600 },
  );
  assert.equal(checkout.state, "confirmed");
  const arrived = await buyer.call(`orders/${checkout.id}/check-in`, {
    latitude: Number(canteen.lat),
    longitude: Number(canteen.lng),
    accuracy: 5,
    timestamp: Date.now(),
  });
  assert.equal(arrived.accepted, true);
  const passes = await buyer.call(`orders/${checkout.id}/passes`, {});
  await serving.login("it.station2@staff.demo.invalid");
  const resolved = await serving.call("staff/resolve", {
    stationId: juice.station_id,
    token: passes[0].token,
  });
  const key = randomUUID();
  const request = {
    stationId: juice.station_id,
    portions: resolved.units.map((u: { id: string; version: number }) => ({
      id: u.id,
      version: u.version,
    })),
    key,
  };
  await serving.call("staff/handover", request);
  await serving.call("staff/handover", request);
  const final = await buyer.call(`orders/${checkout.id}`);
  assert.ok(
    final.units.every((u: { state: string }) => u.state === "collected"),
  );
  await buyer.call(`manager/${canteen.id}`, undefined, 403);
  await manager.login("it.manager@staff.demo.invalid");
  const review = await manager.call(`manager/${canteen.id}`);
  assert.ok(review.worker.length);
  results.studentServingManager = {
    verifiedSessions: true,
    creditCheckout: true,
    studentCheckIn: true,
    stationLookup: true,
    handoverAndRetry: true,
    unauthorizedManagerRejected: true,
    managerReview: true,
    demoOrder: checkout.id,
    syntheticLocation: true,
  };
  console.log(
    "Hosted credit checkout, student check-in, scoped handover/retry and manager checks passed.",
  );
} finally {
  for (const session of [buyer, serving, manager])
    if (session.cookies.size)
      await session.call("auth/logout", {}).catch(() => {});
  writeFileSync(
    ".local/hosted-verification.json",
    JSON.stringify(results, null, 2),
    { mode: 0o600 },
  );
}
