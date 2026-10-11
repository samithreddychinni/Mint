import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, connection } from "../src/db";
import { one, rows, atomic, type Actor, type Row } from "../src/modules/core";
import { hold, creditOnly, cancel, expireTx } from "../src/modules/orders";
import {
  checkIn,
  passes,
  invite,
  invitationAction,
  locationDecision,
} from "../src/modules/pickup";
import {
  handover,
  resolvePass,
  preparation,
  cashierSale,
  manage,
} from "../src/modules/operations";
import { orderView, dashboard } from "../src/modules/catalogue";
import {
  applyCaptured,
  webhook,
  claimResolutions,
} from "../src/modules/payments";
import { signature } from "../src/lib/razorpay";
import { createHmac } from "node:crypto";
import { tick } from "../src/jobs/tick";
import { updateProfile, profileSchema } from "../src/modules/profiles";
import { CREDIT_POLICY } from "../src/lib/credit-policy";
import { account, move } from "../src/modules/credits";
const fixtures: string[] = [];
const profiles: string[] = [];
async function fixture(stock = 20, balance = 100000) {
  const c = randomUUID(),
    s = randomUUID(),
    d = randomUUID();
  fixtures.push(c);
  const actor = async (kind: string, name: string): Promise<Actor> => {
    const a = {
      id: randomUUID(),
      email: name + "-" + randomUUID() + "@fixture.mint.invalid",
      kind,
    };
    profiles.push(a.id);
    await db.execute(
      sql`insert into mint.profiles(id,email,name,kind) values(${a.id},${a.email},${name},${kind})`,
    );
    return a;
  };
  const payer = await actor("student", "payer"),
    friend = await actor("student", "friend"),
    staff = await actor("staff", "staff"),
    manager = await actor("staff", "manager");
  await db.execute(
    sql`insert into mint.canteens(id,name,lat,lng,radius,max_accuracy) values(${c},${"Verification " + c},'11','77',65,25)`,
  );
  await db.execute(
    sql`insert into mint.stations(id,canteen_id,name) values(${s},${c},'Main course'),(${d},${c},'Tiffin')`,
  );
  for (const [a, role, station] of [
    [staff, "serving", s],
    [manager, "manager", null],
  ] as const)
    await db.execute(
      sql`insert into mint.roles(user_id,canteen_id,station_id,role) values(${a.id},${c},${station},${role})`,
    );
  const item = randomUUID(),
    made = randomUUID(),
    batch = randomUUID();
  await db.execute(
    sql`insert into mint.items(id,canteen_id,station_id,name,price,mode,order_cap) values(${item},${c},${s},'Fixture rice',500,'ready',6),(${made},${c},${d},'Fixture dosa',300,'made',6)`,
  );
  await db.execute(
    sql`insert into mint.batches(id,item_id,total) values(${batch},${item},${stock}),(${randomUUID()},${made},20)`,
  );
  await atomic(c, async (tx) => {
    if (balance > 0)
      await move(
        tx,
        null,
        payer.id,
        c,
        balance,
        0,
        "fixture-credit:" + c,
        "Test fixture credit",
        null,
      );
    else await account(tx, payer.id, c);
  });
  return { c, s, d, payer, friend, staff, manager, item, made, batch, actor };
}
const cart = (
  f: Awaited<ReturnType<typeof fixture>>,
  qty = 1,
  credit = qty * 500,
) => ({
  policy: CREDIT_POLICY,
  canteenId: f.c,
  lines: [{ itemId: f.item, quantity: qty, price: 500 }],
  credit,
  key: randomUUID(),
});
async function confirmed(f: Awaited<ReturnType<typeof fixture>>, qty = 1) {
  const o = await hold(f.payer, cart(f, qty));
  return creditOnly(f.payer, String(o.id));
}
const sample = () => ({
  latitude: 11,
  longitude: 77,
  accuracy: 5,
  timestamp: Date.now(),
});
const portions = async (id: unknown) =>
  rows(db, sql`select * from mint.units where order_id=${id} order by id`);
const safeError = (code: string) => (e: unknown) =>
  e instanceof Error && "code" in e && e.code === code;
test("accepted friend pickup scans and collects with the recipient name, without payer matching", async () => {
  const f = await fixture();
  f.friend.email = `qa-${f.friend.id}@cb.students.amrita.edu`;
  await db.execute(
    sql`update mint.profiles set email=${f.friend.email} where id=${f.friend.id}`,
  );
  const order = await confirmed(f, 2);
  const before = await portions(order.id);
  const old = (await passes(f.payer, String(order.id)))[0];
  const invitation = await invite(
    f.payer,
    String(order.id),
    [String(before[0].id)],
    f.friend.email,
  );
  await invitationAction(f.friend, String(invitation!.id), "accept");
  const friendPass = (await passes(f.friend, String(order.id)))[0];
  const found = await resolvePass(f.staff, friendPass.token, f.s);
  assert.equal(found.units.length, 1);
  assert.equal(found.units[0].collector_id, f.friend.id);
  assert.equal(found.units[0].collector_name, "friend");
  assert.equal(found.units[0].collector_email, f.friend.email);
  assert.equal(found.units[0].reference, order.reference);
  assert.match(found.message, /collecting for a friend/);
  const requested = [
    { id: String(found.units[0].id), version: Number(found.units[0].version) },
  ];
  await handover(f.staff, f.s, requested, randomUUID());
  const current = await portions(order.id);
  assert.equal(
    current.find((unit) => unit.collector_id === f.friend.id)!.state,
    "collected",
  );
  assert.equal(
    current.find((unit) => unit.collector_id === f.payer.id)!.state,
    "pending",
  );
  const { orderLimits } = await import("../src/modules/order-limits");
  assert.equal((await orderLimits(db, f.friend)).completedDays, 1);
  assert.equal((await orderLimits(db, f.payer)).completedDays, 0);
  assert.equal(
    current.find((unit) => unit.collector_id === f.payer.id)!.arrived_at,
    null,
  );
  const payer = await resolvePass(f.staff, old.token, f.s);
  assert.equal(payer.units.length, 1);
  assert.equal(payer.units[0].collector_id, f.payer.id);
  assert.equal(
    (await orderView(f.friend, String(order.id))).order.total,
    undefined,
  );
});
test("manager pencil settings preserve paid snapshots, reject stale edits and remain scoped", async () => {
  const f = await fixture();
  const order = await confirmed(f);
  const settings = {
    itemId: f.item,
    name: "New rice name",
    price: 700,
    note: "Updated menu",
    paused: true,
    defaultQuantity: 15,
    orderCap: 1,
    expectedOrderCap: 6,
    expectedSettings: JSON.stringify(["Fixture rice", 500, "", false, 0]),
    reason: "Edit menu defaults",
    key: randomUUID(),
  };
  await assert.rejects(
    manage(f.staff, f.c, "item-settings", settings),
    safeError("FORBIDDEN"),
  );
  await manage(f.manager, f.c, "item-settings", settings);
  await manage(f.manager, f.c, "item-settings", settings);
  const item = (await one(
    db,
    sql`select * from mint.items where id=${f.item}`,
  ))!;
  assert.equal(item.name, settings.name);
  assert.equal(item.price, 700);
  assert.equal(item.paused, true);
  assert.equal(item.default_quantity, 15);
  assert.equal(item.order_cap, 1);
  await assert.rejects(
    manage(f.manager, f.c, "item-settings", {
      ...settings,
      key: randomUUID(),
      orderCap: 2,
      expectedSettings: JSON.stringify([
        settings.name,
        700,
        settings.note,
        true,
        15,
      ]),
    }),
    safeError("ITEM_CHANGED"),
  );
  const unit = (await portions(order.id))[0];
  assert.equal(unit.name, "Fixture rice");
  assert.equal(unit.price, 500);
  assert.equal(
    (await one(
      db,
      sql`select committed from mint.batches where id=${f.batch}`,
    ))!.committed,
    1,
  );
  await assert.rejects(
    manage(f.manager, f.c, "item-settings", {
      ...settings,
      key: randomUUID(),
      price: 800,
    }),
    safeError("ITEM_CHANGED"),
  );
  await assert.rejects(
    hold(f.payer, cart(f, 1, 0)),
    safeError("STOCK_UNAVAILABLE"),
  );
});
test("profile edits normalize phone, preserve identity and cannot change a peer", async () => {
  const f = await fixture();
  const result = await updateProfile(f.payer, {
    name: "  Campus Student  ",
    phone: "90000 00001",
    id: f.friend.id,
    kind: "staff",
  });
  assert.equal(result.name, "Campus Student");
  assert.equal(result.phone, "+919000000001");
  assert.ok(result.completed_at);
  const again = await updateProfile(f.payer, {
    name: "Campus Student",
    phone: "+91 90000 00001",
  });
  assert.deepEqual(again.completed_at, result.completed_at);
  const peer = (await one(
    db,
    sql`select name,phone,kind from mint.profiles where id=${f.friend.id}`,
  ))!;
  assert.equal(peer.name, "friend");
  assert.equal(peer.phone, null);
  assert.equal(peer.kind, "student");
  assert.equal((await dashboard(f.payer)).profile!.phone, "+919000000001");
  assert.equal(
    profileSchema.safeParse({ name: "Campus Student", phone: "123" }).success,
    false,
  );
});
test("manager stock updates preserve reservations and reject serving staff", async () => {
  const f = await fixture(20);
  await confirmed(f, 2);
  await hold(f.payer, cart(f, 1, 0));
  const change = {
    itemId: f.item,
    quantity: 3,
    expectedAvailable: 17,
    reason: "Update online availability",
    key: randomUUID(),
  };
  await assert.rejects(
    manage(f.staff, f.c, "stock", change),
    safeError("FORBIDDEN"),
  );
  await assert.rejects(
    manage(f.payer, f.c, "stock", change),
    safeError("FORBIDDEN"),
  );
  await manage(f.manager, f.c, "stock", change);
  const batch = (await one(
    db,
    sql`select * from mint.batches where id=${f.batch}`,
  ))!;
  assert.equal(batch.held, 1);
  assert.equal(batch.committed, 2);
  assert.equal(batch.waste, 14);
  await hold(f.friend, cart(f, 1, 0));
  await manage(f.manager, f.c, "stock", change);
  assert.equal(
    (await one(
      db,
      sql`select sum(total-held-committed-waste)::int available from mint.batches where item_id=${f.item}`,
    ))!.available,
    2,
  );
  await assert.rejects(
    manage(f.manager, f.c, "stock", {
      ...change,
      key: randomUUID(),
      quantity: 0,
      expectedAvailable: 3,
    }),
    safeError("STOCK_CHANGED"),
  );
  await assert.rejects(
    manage(f.manager, f.c, "stock", { ...change, quantity: 4 }),
    safeError("IDEMPOTENCY_CONFLICT"),
  );
});
test("manager stock updates add availability once and serialize against checkout", async () => {
  const f = await fixture(0);
  const change = {
    itemId: f.item,
    quantity: 1,
    expectedAvailable: 0,
    reason: "Publish one online portion",
    key: randomUUID(),
  };
  await manage(f.manager, f.c, "stock", change);
  await manage(f.manager, f.c, "stock", change);
  assert.equal(
    (await one(
      db,
      sql`select sum(total-held-committed-waste)::int available from mint.batches where item_id=${f.item}`,
    ))!.available,
    1,
  );
  const result = await Promise.allSettled([
    manage(f.manager, f.c, "stock", {
      ...change,
      quantity: 0,
      expectedAvailable: 1,
      key: randomUUID(),
    }),
    hold(f.payer, cart(f, 1, 0)),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await one(
      db,
      sql`select sum(total-held-committed-waste)::int available from mint.batches where item_id=${f.item}`,
    ))!.available,
    0,
  );
});
test("A04: simultaneous students reserve exactly five scarce portions without oversell", async () => {
  const f = await fixture(5);
  const students = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      f.actor("student", "stock-race-" + index),
    ),
  );
  const results = await Promise.allSettled(
    students.map((student) => hold(student, cart(f, 1, 0))),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
  const b = await one(db, sql`select * from mint.batches where id=${f.batch}`);
  assert.equal(b.held, 5);
  assert.equal(b.committed, 0);
});
test("A05: multi-item stock failure rolls back every hold and credit reservation", async () => {
  const f = await fixture(0);
  const before = await one(
    db,
    sql`select available from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
  );
  await assert.rejects(
    hold(f.payer, {
      ...cart(f),
      lines: [
        { itemId: f.made, quantity: 1, price: 300 },
        { itemId: f.item, quantity: 1, price: 500 },
      ],
    }),
    safeError("STOCK_UNAVAILABLE"),
  );
  assert.equal(
    (await one(
      db,
      sql`select available from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
    ))!.available,
    before!.available,
  );
  assert.equal(
    (await one(db, sql`select held from mint.batches where item_id=${f.made}`))!
      .held,
    0,
  );
});
test("A06: cashier and online checkout share the final portion atomically", async () => {
  const f = await fixture(1);
  const result = await Promise.allSettled([
    hold(f.payer, cart(f, 1, 0)),
    cashierSale(
      f.manager,
      f.c,
      [{ itemId: f.item, quantity: 1 }],
      randomUUID(),
    ),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const b = (await one(
    db,
    sql`select * from mint.batches where id=${f.batch}`,
  ))!;
  assert.equal(Number(b.held) + Number(b.committed), 1);
});
test("A07: checkout rejects changed menu price without reserving stock", async () => {
  const f = await fixture();
  await manage(f.manager, f.c, "price", {
    itemId: f.item,
    price: 501,
    reason: "Test new menu price",
  });
  await assert.rejects(hold(f.payer, cart(f)), safeError("PRICE_CHANGED"));
  assert.equal(
    (await one(db, sql`select held from mint.batches where id=${f.batch}`))!
      .held,
    0,
  );
});
test("A08/A34/A42: overlapping expiry and restart release stock/credit exactly once", async () => {
  const f = await fixture();
  const o = await hold(f.payer, cart(f));
  await db.execute(
    sql`update mint.orders set hold_until=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await Promise.all(
    Array.from({ length: 5 }, () => atomic(f.c, (tx) => expireTx(tx, f.c))),
  );
  await tick(false);
  assert.equal(
    (await one(db, sql`select held from mint.batches where id=${f.batch}`))!
      .held,
    0,
  );
  assert.equal(
    (await one(
      db,
      sql`select available,reserved from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
    ))!.available,
    100000,
  );
  assert.equal(
    (await one(
      db,
      sql`select count(*)::int count from mint.credit_ledger where source=${"hold-release:" + o.id}`,
    ))!.count,
    1,
  );
});
test("A11: simultaneous credit spend cannot overdraw the account", async () => {
  const f = await fixture(20, 500);
  const results = await Promise.allSettled([
    hold(f.payer, cart(f)),
    hold(f.payer, cart(f)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const ac = (await one(
    db,
    sql`select * from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
  ))!;
  assert.equal(ac.available, 0);
  assert.equal(ac.reserved, 500);
});
test("location check-in rejects staff and a reference lookup cannot create arrival", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  const resolved = await resolvePass(
    f.staff,
    "",
    f.s,
    String(o.reference),
    f.payer.email,
  );
  assert.match(resolved.message, /reference lookup cannot confirm arrival/i);
  let u = (await portions(o.id))[0];
  await assert.rejects(
    handover(
      f.staff,
      f.s,
      [{ id: String(u.id), version: Number(u.version) }],
      randomUUID(),
    ),
    safeError("ARRIVAL_REQUIRED"),
  );
  await assert.rejects(
    checkIn(f.staff, String(o.id), sample()),
    safeError("FORBIDDEN"),
  );
  assert.equal((await portions(o.id))[0].arrived_at, null);
  const inconclusive = await checkIn(f.payer, String(o.id), {
    ...sample(),
    accuracy: 90,
  });
  assert.equal(inconclusive.accepted, false);
  assert.equal((await portions(o.id))[0].arrived_at, null);
  const r = await checkIn(f.payer, String(o.id), sample());
  assert.equal(r.accepted, true);
  u = (await portions(o.id))[0];
  assert.ok(u.arrived_at);
  assert.equal(
    (await one(
      db,
      sql`select committed from mint.batches where id=${f.batch}`,
    ))!.committed,
    1,
  );
});
test("a valid staff pass scan arrives only that collector across counters and retries do not extend deadlines", async () => {
  const f = await fixture();
  const held = await hold(f.payer, {
    canteenId: f.c,
    lines: [
      { itemId: f.item, quantity: 2, price: 500 },
      { itemId: f.made, quantity: 1, price: 300 },
    ],
    credit: 1300,
    key: randomUUID(),
  });
  const o = await creditOnly(f.payer, String(held.id));
  const shared = (await portions(o.id)).find((u) => u.mode === "ready")!;
  const invitation = await invite(
    f.payer,
    String(o.id),
    [String(shared.id)],
    f.friend.email,
  );
  assert.ok(invitation);
  await invitationAction(f.friend, String(invitation.id), "accept");
  const pass = (await passes(f.payer, String(o.id))).find(
    (p) => p.stationId === f.s,
  )!;
  const resolved = await resolvePass(f.staff, pass.token, f.s);
  assert.match(resolved.message, /Pickup QR accepted/);
  assert.ok(resolved.units.every((u) => u.arrived_at));
  const first = await portions(o.id);
  const own = first.filter((u) => u.collector_id === f.payer.id);
  assert.equal(own.length, 2);
  assert.ok(own.every((u) => u.arrived_at));
  assert.ok(
    own.every((u) => String(u.arrived_at) === String(own[0].arrived_at)),
  );
  assert.equal(
    first.find((u) => u.collector_id === f.friend.id)!.arrived_at,
    null,
  );
  assert.ok(own.find((u) => u.mode === "ready")!.collection_deadline);
  assert.equal(own.find((u) => u.mode === "made")!.collection_deadline, null);
  await resolvePass(f.staff, pass.token, f.s);
  const retry = await portions(o.id);
  for (const before of own) {
    const after = retry.find((u) => u.id === before.id)!;
    assert.deepEqual(after.arrived_at, before.arrived_at);
    assert.deepEqual(after.collection_deadline, before.collection_deadline);
  }
  assert.equal(
    (await one(
      db,
      sql`select count(*)::int count from mint.audit_events where entity=${o.id} and action='staff_scan_arrival'`,
    ))!.count,
    1,
  );
  await handover(
    f.staff,
    f.s,
    resolved.units.map((u) => ({
      id: String(u.id),
      version: Number(u.version),
    })),
    randomUUID(),
  );
  await preparation(
    f.manager,
    String(own.find((u) => u.mode === "made")!.id),
    "start",
  );
  assert.equal(
    (await portions(o.id)).find((u) => u.mode === "made")!.state,
    "preparing",
  );
});
test("unauthorized, wrong-counter, expired and revoked scans do not record arrival", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  const pass = (await passes(f.payer, String(o.id)))[0];
  await assert.rejects(
    resolvePass(f.payer, pass.token, f.s),
    safeError("FORBIDDEN"),
  );
  await assert.rejects(
    resolvePass(f.manager, pass.token, f.d),
    safeError("WRONG_STATION"),
  );
  await assert.rejects(
    resolvePass(f.staff, "invalid-pass", f.s),
    safeError("PASS_REVOKED"),
  );
  await db.execute(
    sql`update mint.passes set expires_at=clock_timestamp() where order_id=${o.id}`,
  );
  await assert.rejects(
    resolvePass(f.staff, pass.token, f.s),
    safeError("PASS_REVOKED"),
  );
  assert.equal((await portions(o.id))[0].arrived_at, null);
  const fresh = (await passes(f.payer, String(o.id)))[0];
  await db.execute(
    sql`update mint.orders set deadline=clock_timestamp() where id=${o.id}`,
  );
  await assert.rejects(
    resolvePass(f.staff, fresh.token, f.s),
    safeError("PASS_REVOKED"),
  );
  assert.equal((await portions(o.id))[0].arrived_at, null);
});
test("A13/A14: server clock and accuracy-overlap determine location eligibility", () => {
  const c = { lat: 11, lng: 77, radius: 65, max_accuracy: 25 };
  assert.equal(
    locationDecision(
      c,
      { ...sample(), timestamp: Date.now() + 3600000 },
      Date.now(),
    ),
    "LOCATION_INCONCLUSIVE",
  );
  assert.equal(
    locationDecision(
      c,
      { ...sample(), latitude: 11 + 60 / 111195, accuracy: 10 },
      Date.now(),
    ),
    "LOCATION_INCONCLUSIVE",
  );
  assert.equal(
    locationDecision(c, { ...sample(), latitude: 12 }, Date.now()),
    "LOCATION_OUTSIDE",
  );
});
test("A15/A37: arrival at final deadline expires rather than accepting check-in", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  await db.execute(
    sql`update mint.orders set deadline=clock_timestamp() where id=${o.id}`,
  );
  const result = await checkIn(f.payer, String(o.id), sample());
  assert.equal(result.accepted, false);
  assert.equal(result.code, "ARRIVAL_EXPIRED");
  const u = (await portions(o.id))[0];
  assert.equal(u.state, "expired");
  assert.equal(u.arrived_at, null);
});
test("two of four portions transfer; old pass excludes transferred portions; only the scanned collector arrives", async () => {
  const f = await fixture();
  const o = await confirmed(f, 4);
  const units = await portions(o.id);
  const old = (await passes(f.payer, String(o.id)))[0];
  const invitation = await invite(
    f.payer,
    String(o.id),
    units.slice(0, 2).map((u) => String(u.id)),
    f.friend.email,
  );
  await invitationAction(f.friend, String(invitation!.id), "accept");
  const remaining = await resolvePass(f.staff, old.token, f.s);
  assert.equal(remaining.units.length, 2);
  assert.equal(
    (await portions(o.id)).filter((u) => u.collector_id === f.friend.id).length,
    2,
  );
  await db.execute(
    sql`update mint.orders set deadline=clock_timestamp() where id=${o.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  const after = await portions(o.id);
  assert.equal(after.filter((u) => u.state === "expired").length, 2);
  assert.equal(
    after.filter((u) => u.arrived_at !== null && u.state === "pending").length,
    2,
  );
  const payerPass = (await passes(f.payer, String(o.id)))[0];
  assert.equal(
    (await resolvePass(f.staff, payerPass.token, f.s)).units.length,
    2,
  );
});
test("A17: declining invitation leaves original assignment intact", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  const u = (await portions(o.id))[0];
  const i = await invite(f.payer, String(o.id), [String(u.id)], f.friend.email);
  await invitationAction(f.friend, String(i!.id), "decline");
  assert.equal((await portions(o.id))[0].collector_id, f.payer.id);
});
test("A20: assignment acceptance and old-version handover cannot both commit", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  await checkIn(f.payer, String(o.id), sample());
  const u = (await portions(o.id))[0];
  const i = await invite(f.payer, String(o.id), [String(u.id)], f.friend.email);
  const outcomes = await Promise.allSettled([
    invitationAction(f.friend, String(i!.id), "accept"),
    handover(
      f.staff,
      f.s,
      [{ id: String(u.id), version: Number(u.version) }],
      randomUUID(),
    ),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(
    ["pending", "collected"].includes(String((await portions(o.id))[0].state)),
  );
});
test("A21/A44: station and canteen permissions apply on the server", async () => {
  const f = await fixture();
  const other = await fixture();
  const o = await confirmed(f);
  const p = (await passes(f.payer, String(o.id)))[0];
  await assert.rejects(
    resolvePass(f.manager, p.token, f.d),
    safeError("WRONG_STATION"),
  );
  await assert.rejects(
    cashierSale(f.payer, f.c, [{ itemId: f.item, quantity: 1 }], randomUUID()),
    safeError("FORBIDDEN"),
  );
  await assert.rejects(
    manage(other.manager, f.c, "pause", {
      paused: true,
      reason: "Unauthorized",
    }),
    safeError("FORBIDDEN"),
  );
});
test("A22/A24: concurrent redemption commits once; identical retry returns outcome", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  await checkIn(f.payer, String(o.id), sample());
  const u = (await portions(o.id))[0];
  const p = [{ id: String(u.id), version: Number(u.version) }];
  const requestKey = randomUUID();
  const result = await Promise.allSettled([
    handover(f.staff, f.s, p, requestKey),
    handover(f.manager, f.s, p, randomUUID()),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  if (result[0].status === "fulfilled") {
    const retry = await handover(f.staff, f.s, p, requestKey);
    assert.equal(retry.collected, 1);
  }
  assert.equal(
    (await one(
      db,
      sql`select committed from mint.batches where id=${f.batch}`,
    ))!.committed,
    1,
  );
  await assert.rejects(
    handover(f.staff, f.s, p, randomUUID()),
    safeError("ALREADY_COLLECTED"),
  );
});
test("A23/A27: ready portion collected while made-to-order job persists without extra stock decrement", async () => {
  const f = await fixture();
  const o = await hold(f.payer, {
    ...cart(f),
    lines: [
      { itemId: f.item, quantity: 1, price: 500 },
      { itemId: f.made, quantity: 1, price: 300 },
    ],
    credit: 800,
  });
  await creditOnly(f.payer, String(o.id));
  const us = await portions(o.id);
  const made = us.find((u) => u.mode === "made")!,
    ready = us.find((u) => u.mode === "ready")!;
  await assert.rejects(
    preparation(f.manager, String(made.id), "start"),
    safeError("ARRIVAL_REQUIRED"),
  );
  await checkIn(f.payer, String(o.id), sample());
  await preparation(f.manager, String(made.id), "start");
  await handover(
    f.staff,
    f.s,
    [{ id: String(ready.id), version: Number(ready.version) }],
    randomUUID(),
  );
  await db.execute(
    sql`update mint.orders set deadline=clock_timestamp()-interval '1 minute' where id=${o.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  assert.equal(
    (await portions(o.id)).find((u) => u.id === made.id)!.state,
    "preparing",
  );
  await preparation(f.manager, String(made.id), "ready");
  assert.ok(
    (await portions(o.id)).find((u) => u.id === made.id)!.collection_deadline,
  );
  assert.equal(
    (await one(
      db,
      sql`select committed from mint.batches where id=${f.batch}`,
    ))!.committed,
    1,
  );
});
test("A26/A32/A33: partial cancellation credits payer once and does not refund externally", async () => {
  const f = await fixture();
  const o = await confirmed(f, 2);
  await checkIn(f.payer, String(o.id), sample());
  const us = await portions(o.id);
  await handover(
    f.staff,
    f.s,
    [{ id: String(us[0].id), version: Number(us[0].version) }],
    randomUUID(),
  );
  await Promise.all([
    cancel(f.payer, String(o.id), [String(us[1].id)]),
    cancel(f.payer, String(o.id), [String(us[1].id)]),
  ]);
  assert.equal(
    (await one(
      db,
      sql`select count(*)::int count from mint.credit_ledger where source=${"cancel:" + us[1].id}`,
    ))!.count,
    1,
  );
  assert.equal(
    (await one(
      db,
      sql`select count(*)::int count from mint.resolutions where order_id=${o.id}`,
    ))!.count,
    0,
  );
  const u = await portions(o.id);
  assert.equal(u.filter((v) => v.state === "collected").length, 1);
  assert.equal(u.filter((v) => v.state === "cancelled").length, 1);
});
test("A28/A31: pause blocks new checkout, commitments stay collectible; new batches add stock", async () => {
  const f = await fixture(1);
  const o = await confirmed(f);
  await manage(f.manager, f.c, "pause", { paused: true, reason: "Pause demo" });
  await assert.rejects(hold(f.payer, cart(f)), safeError("ORDERING_PAUSED"));
  await checkIn(f.payer, String(o.id), sample());
  const u = (await portions(o.id))[0];
  await handover(
    f.staff,
    f.s,
    [{ id: String(u.id), version: Number(u.version) }],
    randomUUID(),
  );
  await manage(f.manager, f.c, "batch", {
    itemId: f.item,
    quantity: 4,
    reusable: true,
    reason: "New batch",
  });
  assert.equal(
    (await one(
      db,
      sql`select sum(total-held-committed-waste)::int qty from mint.batches where item_id=${f.item}`,
    ))!.qty,
    4,
  );
});
test("A29: guessed order ID and delegates cannot retrieve payer finances", async () => {
  const f = await fixture();
  const o = await confirmed(f, 2);
  await assert.rejects(
    orderView(f.friend, String(o.id)),
    safeError("FORBIDDEN"),
  );
  const u = (await portions(o.id))[0];
  const i = await invite(f.payer, String(o.id), [String(u.id)], f.friend.email);
  await invitationAction(f.friend, String(i!.id), "accept");
  const view = await orderView(f.friend, String(o.id));
  assert.equal(view.order.total, undefined);
  assert.equal(view.order.provider_order, undefined);
  const delegateDashboard = await dashboard(f.friend);
  const buyerDashboard = await dashboard(f.payer);
  assert.equal(
    (delegateDashboard.orders[0].fulfillment as unknown[]).length,
    1,
  );
  assert.equal((buyerDashboard.orders[0].fulfillment as unknown[]).length, 2);
  assert.deepEqual(
    Object.keys(
      (delegateDashboard.orders[0].fulfillment as Record<string, unknown>[])[0],
    ).sort(),
    ["arrived", "state"],
  );
});
test("A09/A10: duplicate captured events and late payment re-reservation are idempotent", async () => {
  const f = await fixture(1);
  const o = await hold(f.payer, cart(f, 1, 0));
  const orderId = "order_fixture" + randomUUID().replaceAll("-", "");
  await db.execute(
    sql`update mint.orders set provider_order=${orderId},hold_until=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  const p = {
    id: "pay_fixture" + randomUUID().replaceAll("-", ""),
    order_id: orderId,
    amount: 500,
    currency: "INR",
    status: "captured",
    captured: true,
  };
  await Promise.all([applyCaptured(p), applyCaptured(p)]);
  assert.equal(
    (await one(db, sql`select state from mint.orders where id=${o.id}`))!.state,
    "confirmed",
  );
  assert.equal(
    (await one(
      db,
      sql`select committed,held from mint.batches where id=${f.batch}`,
    ))!.committed,
    1,
  );
  assert.equal(
    (await one(
      db,
      sql`select count(*)::int qty from mint.payments where order_id=${o.id}`,
    ))!.qty,
    1,
  );
});
test("A10/A45: unavailable late payment persists a restart-safe external resolution", async () => {
  const f = await fixture(1);
  const o = await hold(f.payer, cart(f, 1, 0));
  const provider = "order_fixture" + randomUUID().replaceAll("-", "");
  await db.execute(
    sql`update mint.orders set provider_order=${provider},hold_until=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  await cashierSale(
    f.manager,
    f.c,
    [{ itemId: f.item, quantity: 1 }],
    randomUUID(),
  );
  const p = {
    id: "pay_fixture" + randomUUID().replaceAll("-", ""),
    order_id: provider,
    amount: 500,
    currency: "INR",
    status: "captured",
    captured: true,
  };
  await applyCaptured(p);
  await applyCaptured(p);
  const resolutions = await rows(
    db,
    sql`select * from mint.resolutions where order_id=${o.id}`,
  );
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].state, "pending");
  assert.equal(
    (await one(db, sql`select state from mint.orders where id=${o.id}`))!.state,
    "exception",
  );
});
test("payment mismatches, authorized status and forged webhook are rejected", async () => {
  const f = await fixture();
  const o = await hold(f.payer, cart(f, 1, 0));
  const provider = "order_fixture" + randomUUID().replaceAll("-", "");
  await db.execute(
    sql`update mint.orders set provider_order=${provider} where id=${o.id}`,
  );
  const p = {
    id: "pay_fixture" + randomUUID().replaceAll("-", ""),
    order_id: provider,
    amount: 501,
    currency: "INR",
    status: "captured",
    captured: true,
  };
  await assert.rejects(applyCaptured(p), safeError("PAYMENT_EXCEPTION"));
  await assert.rejects(
    applyCaptured({ ...p, status: "authorized", captured: false }),
    safeError("PAYMENT_PENDING"),
  );
  await assert.rejects(
    webhook("{}", "wrong", "fixture-event"),
    safeError("BAD_SIGNATURE"),
  );
  const expected = createHmac("sha256", "demo").update("message").digest("hex");
  assert.ok(signature("message", expected, "demo"));
  assert.equal(signature("different", expected, "demo"), false);
});
test("A38: authenticated/anonymous roles have no direct business access; RLS is enabled", async () => {
  const denied = await one(
    db,
    sql`select not has_schema_privilege('authenticated','mint','USAGE') and not has_schema_privilege('anon','mint','USAGE') as safe`,
  );
  assert.equal(denied!.safe, true);
  const rls = await one(
    db,
    sql`select bool_and(relrowsecurity) enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='mint' and c.relkind='r'`,
  );
  assert.equal(rls!.enabled, true);
  const response = await fetch(
    process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/orders?select=id",
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        "Accept-Profile": "mint",
      },
    },
  );
  assert.ok([400, 401, 403, 404, 406].includes(response.status));
});
test("A39: direct Supabase signup with unapproved domain is rejected by hook", async () => {
  const response = await fetch(
    process.env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/signup",
    {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "rejected-" + randomUUID() + "@example.com",
        password: randomUUID() + "Aa9!",
      }),
    },
  );
  assert.ok([400, 403, 422].includes(response.status));
  const result = await response.json();
  assert.match(
    String(result.msg || result.message || result.error_description),
    /university|approved|hook/i,
  );
});
test("A43/A45: overlapping resolution claims are disjoint and restart can reclaim an expired lease", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  const id = randomUUID();
  await db.execute(
    sql`insert into mint.resolutions(id,order_id,payment_id,amount,reason) values(${id},${o.id},${"pay_fixture" + id.replaceAll("-", "")},500,'Fixture external resolution')`,
  );
  const [a, b] = await Promise.all([claimResolutions(), claimResolutions()]);
  assert.equal(
    a.filter((r) => r.id === id).length + b.filter((r) => r.id === id).length,
    1,
  );
  assert.equal(a.filter((r) => b.some((s) => s.id === r.id)).length, 0);
  await db.execute(
    sql`update mint.resolutions set claimed_until=clock_timestamp()-interval '1 second' where id=${id}`,
  );
  assert.ok((await claimResolutions()).some((r) => r.id === id));
});
test("manager reviewed prepared cancellation records waste and credit only once", async () => {
  const f = await fixture();
  const o = await hold(f.payer, {
    ...cart(f),
    lines: [{ itemId: f.made, quantity: 1, price: 300 }],
    credit: 300,
  });
  await creditOnly(f.payer, String(o.id));
  await checkIn(f.payer, String(o.id), sample());
  const u = (await portions(o.id))[0];
  await preparation(f.manager, String(u.id), "start");
  const input = {
    unitId: u.id,
    reason: "Manager approves demo credit for kitchen failure",
    key: randomUUID(),
  };
  await manage(f.manager, f.c, "prepared-resolution", input);
  await manage(f.manager, f.c, "prepared-resolution", input);
  const b = (await one(
    db,
    sql`select * from mint.batches where id=${u.batch_id}`,
  ))!;
  assert.equal(b.waste, 1);
  assert.equal(b.committed, 0);
  assert.equal(
    (await one(
      db,
      sql`select count(*)::int count from mint.credit_ledger where source=${"cancel:" + u.id}`,
    ))!.count,
    1,
  );
});
test("manager unavailable food is withdrawn rather than reintroduced as sellable stock", async () => {
  const f = await fixture(1);
  const o = await confirmed(f);
  const u = (await portions(o.id))[0];
  const input = {
    unitId: u.id,
    reason: "Physically unavailable portion; do not resell",
    key: randomUUID(),
  };
  await manage(f.manager, f.c, "unavailable", input);
  await manage(f.manager, f.c, "unavailable", input);
  const b = (await one(
    db,
    sql`select * from mint.batches where id=${f.batch}`,
  ))!;
  assert.equal(b.waste, 1);
  assert.equal(b.committed, 0);
  assert.equal(b.held, 0);
  assert.equal(Number(b.total) - Number(b.waste) - Number(b.committed), 0);
});
after(async () => {
  for (const c of fixtures) {
    await atomic(c, async (tx) => {
      await tx.execute(
        sql`delete from mint.audit_events where entity=${c} or entity in(select id::text from mint.orders where canteen_id=${c}) or entity in(select u.id::text from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${c}) or actor_id in(select user_id from mint.roles where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.credit_reservations where order_id in(select id from mint.orders where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.credit_lots where account_id in(select id from mint.credit_accounts where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.credit_ledger where account_id in(select id from mint.credit_accounts where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.resolutions where order_id in(select id from mint.orders where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.payments where order_id in(select id from mint.orders where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.passes where order_id in(select id from mint.orders where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.invitations where order_id in(select id from mint.orders where canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.units where order_id in(select id from mint.orders where canteen_id=${c})`,
      );
      await tx.execute(sql`delete from mint.orders where canteen_id=${c}`);
      await tx.execute(
        sql`delete from mint.stock_events where batch_id in(select b.id from mint.batches b join mint.items i on i.id=b.item_id where i.canteen_id=${c})`,
      );
      await tx.execute(
        sql`delete from mint.batches where item_id in(select id from mint.items where canteen_id=${c})`,
      );
      await tx.execute(sql`delete from mint.items where canteen_id=${c}`);
      await tx.execute(sql`delete from mint.roles where canteen_id=${c}`);
      await tx.execute(
        sql`delete from mint.credit_accounts where canteen_id=${c}`,
      );
      await tx.execute(sql`delete from mint.stations where canteen_id=${c}`);
      await tx.execute(sql`delete from mint.canteens where id=${c}`);
    });
  }
  for (const id of profiles) {
    await db.execute(sql`delete from mint.audit_events where actor_id=${id}`);
    await db.execute(sql`delete from mint.profiles where id=${id}`);
  }
  await connection.end();
});

test("manager sales summary uses campus days, separates credit, excludes cancelled favourites and stays scoped", async () => {
  const { managerSummary } = await import("../src/modules/manager-summary");
  const f = await fixture();
  const old = await confirmed(f);
  await db.execute(
    sql`update mint.units set state='collected',collected_at=current_timestamp where order_id=${old.id}`,
  );
  const today = await confirmed(f, 3);
  const yesterday = await confirmed(f);
  const todayUnits = await portions(today.id);
  await cancel(f.payer, String(today.id), [String(todayUnits[0].id)]);
  await db.execute(
    sql`update mint.orders set confirmed_at=(date_trunc('day',current_timestamp at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')-interval '12 hours' where id=${yesterday.id}`,
  );
  await db.execute(
    sql`update mint.orders set confirmed_at=current_timestamp-interval '8 days' where id=${old.id}`,
  );
  await db.execute(
    sql`update mint.units set state='collected',collected_at=current_timestamp where order_id=${old.id}`,
  );
  await db.execute(
    sql`update mint.units set arrived_at=current_timestamp where id=${todayUnits[1].id}`,
  );
  await db.execute(
    sql`insert into mint.payments(id,order_id,amount,status,created_at) values(${randomUUID()},${yesterday.id},400,'captured',current_timestamp-interval '12 hours')`,
  );
  // Keep the payment event in the previous campus day even near midnight.
  await db.execute(
    sql`update mint.payments set created_at=(select confirmed_at from mint.orders where id=${yesterday.id}) where order_id=${yesterday.id}`,
  );
  const day = await managerSummary(f.manager, f.c, "today");
  const week = await managerSummary(f.manager, f.c, "week");
  assert.equal(day.paid_orders, 1);
  assert.equal(Number(day.paid_value), 1500);
  assert.equal(Number(day.credit_used), 1500);
  assert.equal(Number(day.credit_issued), 500);
  assert.equal(Number(day.credit_balance), 98000);
  assert.equal(Number(day.payments_captured), 0);
  assert.equal(day.collected_portions, 1);
  assert.equal(day.pending_portions, 3);
  assert.equal(day.arrived_portions, 1);
  assert.equal(week.paid_orders, 2);
  assert.equal(Number(week.paid_value), 2000);
  assert.equal(Number(week.payments_captured), 400);
  assert.deepEqual(week.popular_items, [
    { name: "Fixture rice", portions: 3, value: 1500 },
  ]);
  assert.ok(
    new Date(String(day.start_at)).toISOString().endsWith("T18:30:00.000Z"),
  );
  await assert.rejects(
    managerSummary(f.staff, f.c, "today"),
    safeError("FORBIDDEN"),
  );
  await assert.rejects(
    managerSummary(f.payer, f.c, "today"),
    safeError("FORBIDDEN"),
  );
  await assert.rejects(
    managerSummary(f.manager, randomUUID(), "week"),
    safeError("FORBIDDEN"),
  );
});

test("fast order reads still expire overdue portions once and hide payer-only receipt data", async () => {
  const f = await fixture();
  const order = await confirmed(f, 2);
  const initial = await orderView(f.payer, String(order.id));
  assert.equal(initial.order.total, 1000);
  assert.equal((initial.units as unknown[]).length, 2);
  await assert.rejects(
    orderView(f.friend, String(order.id)),
    safeError("FORBIDDEN"),
  );
  await db.execute(
    sql`update mint.orders set deadline=current_timestamp-interval '1 second' where id=${order.id}`,
  );
  const expired = await orderView(f.payer, String(order.id));
  assert.ok(
    (expired.units as { state: string }[]).every((u) => u.state === "expired"),
  );
  await orderView(f.payer, String(order.id));
  const credits = await one(
    db,
    sql`select count(*)::int n,sum(amount)::int value from mint.credit_ledger where order_id=${order.id} and source like 'cancel:%'`,
  );
  assert.equal(credits.n, 2);
  assert.equal(credits.value, 900);
  const pending = await hold(f.payer, cart(f));
  await db.execute(
    sql`update mint.orders set hold_until=current_timestamp-interval '1 second' where id=${pending.id}`,
  );
  assert.equal(
    (await orderView(f.payer, String(pending.id))).order.state,
    "expired",
  );
});

test("archived menu items reject new purchases and stock edits without breaking paid pickup", async () => {
  const f = await fixture();
  const order = await confirmed(f);
  await atomic(f.c, async (tx) => {
    await tx.execute(
      sql`update mint.items set archived=true where id=${f.item}`,
    );
  });
  await assert.rejects(hold(f.payer, cart(f)), safeError("STOCK_UNAVAILABLE"));
  await assert.rejects(
    manage(f.manager, f.c, "stock", {
      itemId: f.item,
      quantity: 50,
      expectedAvailable: 19,
      key: randomUUID(),
      reason: "Archived stock probe",
    }),
    safeError("NOT_FOUND"),
  );
  const pass = (await passes(f.payer, String(order.id)))[0];
  const scan = await resolvePass(f.staff, pass.token, f.s);
  assert.equal(scan.units.length, 1);
  assert.equal(scan.units[0].name, "Fixture rice");
  await handover(
    f.staff,
    f.s,
    [{ id: String(scan.units[0].id), version: Number(scan.units[0].version) }],
    randomUUID(),
  );
  assert.equal((await portions(order.id))[0].state, "collected");
  assert.equal((await orderView(f.payer, String(order.id))).order.total, 500);
});

test("campus-wide quotas serialize different-canteen checkout and preserve retries", async () => {
  const first = await fixture(30),
    second = await fixture(30),
    third = await fixture(30);
  for (const f of [second, third])
    await atomic(f.c, (tx) =>
      move(
        tx,
        null,
        first.payer.id,
        f.c,
        100000,
        0,
        "cross-canteen-fixture:" + f.c,
        "Test fixture credit",
        null,
      ),
    );
  const carts = [first, second, third].map((f) => cart(f));
  const results = await Promise.allSettled(
    carts.map((c) => hold(first.payer, c)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  const failed = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.ok(safeError("ACTIVE_ORDER_LIMIT")(failed.reason));
  const winning = results.findIndex((r) => r.status === "fulfilled");
  const again = await hold(first.payer, carts[winning]);
  assert.equal(
    again.id,
    (results[winning] as PromiseFulfilledResult<Row>).value.id,
  );
  const held = await one(
    db,
    sql`select sum(b.held)::int held from mint.batches b where b.item_id in(${first.item},${second.item},${third.item})`,
  );
  assert.equal(held.held, 2);
  await db.execute(
    sql`update mint.orders set hold_until=clock_timestamp()-interval '1 second' where payer_id=${first.payer.id} and state='pending'`,
  );
  const retry = await hold(first.payer, { ...carts[0], key: randomUUID() });
  assert.equal(retry.state, "pending");
});

test("meal variants and recent collections share quotas while bread and scarce-item caps remain bounded", async () => {
  const f = await fixture(30);
  await db.execute(
    sql`update mint.items set order_group='meal',order_cap=6 where id in(${f.item},${f.made})`,
  );
  const order = await confirmed(f, 2);
  await assert.rejects(
    hold(f.payer, {
      ...cart(f),
      lines: [{ itemId: f.made, price: 300, quantity: 1 }],
      credit: 300,
    }),
    safeError("MEAL_QUANTITY_LIMIT"),
  );
  const pass = (await passes(f.payer, String(order.id)))[0];
  const scan = await resolvePass(f.staff, pass.token, f.s);
  await handover(
    f.staff,
    f.s,
    scan.units.map((u) => ({ id: String(u.id), version: Number(u.version) })),
    randomUUID(),
  );
  await assert.rejects(
    hold(f.payer, {
      ...cart(f),
      lines: [{ itemId: f.made, price: 300, quantity: 1 }],
      credit: 300,
    }),
    safeError("MEAL_QUANTITY_LIMIT"),
  );
  await db.execute(
    sql`update mint.units set collected_at=clock_timestamp()-interval '31 minutes' where order_id=${order.id}`,
  );
  const another = await hold(f.payer, {
    ...cart(f),
    lines: [{ itemId: f.made, price: 300, quantity: 1 }],
    credit: 300,
  });
  assert.ok(another.id);
  await db.execute(
    sql`update mint.items set order_group='bread',order_cap=0 where id=${f.item}`,
  );
  const bread = await hold(f.payer, cart(f, 6));
  assert.ok(bread.id);
  const scarce = await fixture(10);
  await assert.rejects(
    hold(scarce.payer, cart(scarce, 2)),
    safeError("ITEM_QUANTITY_LIMIT"),
  );
  assert.equal(
    (await one(db, sql`select held from mint.batches where id=${scarce.batch}`))
      .held,
    0,
  );
});

test("reliability uses collected days, attributes no-shows to the recipient and permits scoped manager review", async () => {
  const f = await fixture(100);
  f.payer.email = `qa-${f.payer.id}@cb.students.amrita.edu`;
  await db.execute(
    sql`update mint.profiles set email=${f.payer.email} where id=${f.payer.id}`,
  );
  for (let day = 1; day <= 5; day++) {
    const o = await confirmed(f);
    await db.execute(
      sql`update mint.units set state='collected',collected_at=clock_timestamp()-${day}*interval '1 day' where order_id=${o.id}`,
    );
  }
  const { orderLimits } = await import("../src/modules/order-limits");
  assert.equal((await orderLimits(db, f.payer)).tier, "reliable");
  const today = await confirmed(f);
  await db.execute(
    sql`update mint.units set state='collected',collected_at=clock_timestamp() where order_id=${today.id}`,
  );
  assert.equal((await orderLimits(db, f.payer)).completedDays, 6);
  for (let index = 0; index < 3; index++) {
    const o = await confirmed(f);
    await db.execute(
      sql`update mint.orders set deadline=clock_timestamp()-interval '1 second' where id=${o.id}`,
    );
    await atomic(f.c, (tx) => expireTx(tx, f.c));
  }
  assert.equal((await orderLimits(db, f.payer)).tier, "restricted");
  assert.equal((await orderLimits(db, f.payer)).completedDays, 5);
  await assert.rejects(
    manage(f.staff, f.c, "limits-review", {
      email: f.payer.email,
      reason: "Student support review",
      key: randomUUID(),
    }),
    safeError("FORBIDDEN"),
  );
  await manage(f.manager, f.c, "limits-review", {
    email: f.payer.email,
    reason: "Reviewed pickup incident",
    key: randomUUID(),
  });
  assert.equal((await orderLimits(db, f.payer)).tier, "reliable");
  // An accepted recipient's no-show does not reduce the payer's reliability.
  const o = await confirmed(f);
  const u = (await portions(o.id))[0];
  const assignment = await invite(
    f.payer,
    String(o.id),
    [String(u.id)],
    f.friend.email,
  );
  await invitationAction(f.friend, String(assignment.id), "accept");
  await db.execute(
    sql`update mint.orders set deadline=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  assert.equal((await orderLimits(db, f.payer)).tier, "reliable");
});

test("unstarted checkout cycles pause briefly, manager review clears them, and uncertain payments are excluded", async () => {
  const f = await fixture(30);
  const { orderLimits } = await import("../src/modules/order-limits");
  for (let index = 0; index < 3; index++) {
    const o = await hold(f.payer, cart(f, 1, 0));
    await db.execute(
      sql`update mint.orders set hold_until=clock_timestamp()-interval '1 second' where id=${o.id}`,
    );
    await atomic(f.c, (tx) => expireTx(tx, f.c));
  }
  assert.ok((await orderLimits(db, f.payer)).cooldownUntil);
  await assert.rejects(hold(f.payer, cart(f)), safeError("ORDER_COOLDOWN"));
  await manage(f.manager, f.c, "limits-review", {
    email: f.payer.email,
    reason: "Reviewed interrupted checkout",
    key: randomUUID(),
  });
  assert.equal((await orderLimits(db, f.payer)).cooldownUntil, null);
  for (let index = 0; index < 3; index++) {
    const o = await hold(f.payer, cart(f, 1, 0));
    await db.execute(
      sql`update mint.orders set hold_until=clock_timestamp()-interval '1 second',provider_order=${"fixture-provider-" + o.id} where id=${o.id}`,
    );
    await atomic(f.c, (tx) => expireTx(tx, f.c));
  }
  assert.equal((await orderLimits(db, f.payer)).cooldownUntil, null);
  assert.ok((await hold(f.payer, cart(f))).id);
});

test("total, outstanding and drink caps reject before reserving additional stock", async () => {
  const f = await fixture(30);
  await assert.rejects(
    hold(f.payer, cart(f, 7)),
    safeError("ORDER_QUANTITY_LIMIT"),
  );
  await hold(f.payer, cart(f, 6));
  await assert.rejects(
    hold(f.payer, {
      ...cart(f, 5),
      lines: [{ itemId: f.made, price: 300, quantity: 5 }],
      credit: 0,
    }),
    safeError("OUTSTANDING_LIMIT"),
  );
  assert.equal(
    (await one(db, sql`select held from mint.batches where item_id=${f.made}`))
      .held,
    0,
  );
  await db.execute(
    sql`update mint.items set order_group='drink' where id in(${f.item},${f.made})`,
  );
  await hold(f.friend, cart(f, 4, 0));
  await assert.rejects(
    hold(f.friend, {
      ...cart(f, 1, 0),
      lines: [{ itemId: f.made, price: 300, quantity: 1 }],
    }),
    safeError("DRINK_QUANTITY_LIMIT"),
  );
  assert.equal(
    (await one(db, sql`select held from mint.batches where item_id=${f.made}`))
      .held,
    0,
  );
});

test("late captured payment cannot bypass campus-wide capacity and creates one financial resolution", async () => {
  const f = await fixture(30),
    other = await fixture(30);
  const old = await hold(f.payer, cart(f, 1, 0));
  const provider = "order_fixture" + randomUUID().replaceAll("-", "");
  await db.execute(
    sql`update mint.orders set provider_order=${provider},hold_until=clock_timestamp()-interval '1 second' where id=${old.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  await hold(f.payer, cart(f, 1, 0));
  await hold(f.payer, cart(other, 1, 0));
  const payment = {
    id: "pay_fixture" + randomUUID().replaceAll("-", ""),
    order_id: provider,
    amount: 500,
    currency: "INR",
    status: "captured",
    captured: true,
  };
  await Promise.all([applyCaptured(payment), applyCaptured(payment)]);
  assert.equal(
    (await one(db, sql`select state from mint.orders where id=${old.id}`))
      .state,
    "exception",
  );
  assert.equal(
    (
      await one(
        db,
        sql`select count(*)::int count from mint.resolutions where order_id=${old.id}`,
      )
    ).count,
    1,
  );
  assert.equal(
    (
      await one(
        db,
        sql`select held,committed from mint.batches where id=${f.batch}`,
      )
    ).held,
    1,
  );
  assert.equal(
    (
      await one(
        db,
        sql`select held,committed from mint.batches where id=${f.batch}`,
      )
    ).committed,
    0,
  );
});

test("missed arrivals return 90% once, preserve collected portions and report the fine", async () => {
  const f = await fixture();
  const o = await confirmed(f, 2);
  const [collected, missed] = await portions(o.id);
  await db.execute(
    sql`update mint.units set state='collected',arrived_at=clock_timestamp(),collected_at=clock_timestamp() where id=${collected.id}`,
  );
  await db.execute(
    sql`update mint.orders set deadline=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await Promise.all(
    Array.from({ length: 3 }, () => atomic(f.c, (tx) => expireTx(tx, f.c))),
  );
  const u = (await portions(o.id)).find((u) => u.id === missed.id)!;
  assert.equal(u.credit_returned, 450);
  assert.equal(u.missed_pickup_fine, 50);
  const ac = await one(
    db,
    sql`select available from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
  );
  assert.equal(ac.available, 99450);
  const detail = await orderView(f.payer, String(o.id));
  assert.equal(
    detail.units.find((u) => u.id === missed.id)!.missed_pickup_fine,
    50,
  );
  const { managerSummary } = await import("../src/modules/manager-summary");
  assert.equal(
    Number((await managerSummary(f.manager, f.c, "today")).missed_pickup_fines),
    50,
  );
  const lot = await one(
    db,
    sql`select available,expires_at>clock_timestamp()+interval '29 days' valid from mint.credit_lots where source=${"cancel:" + missed.id}`,
  );
  assert.equal(lot.available, 450);
  assert.equal(lot.valid, true);
});

test("credit spends earliest expiry first and worker/read retries expire it exactly once", async () => {
  const f = await fixture(20, 0);
  await atomic(f.c, async (tx) => {
    await move(
      tx,
      null,
      f.payer.id,
      f.c,
      1000,
      0,
      "old:" + f.c,
      "First grant",
      null,
    );
    await move(
      tx,
      null,
      f.payer.id,
      f.c,
      700,
      0,
      "new:" + f.c,
      "Second grant",
      null,
    );
    await tx.execute(
      sql`update mint.credit_lots set expires_at=clock_timestamp()+interval '1 hour' where source=${"old:" + f.c}`,
    );
  });
  await confirmed(f);
  const old = await one(
    db,
    sql`select * from mint.credit_lots where source=${"old:" + f.c}`,
  );
  assert.equal(old.available, 500);
  assert.equal(old.reserved, 0);
  await db.execute(
    sql`update mint.credit_lots set expires_at=clock_timestamp() where id=${old.id}`,
  );
  await assert.rejects(
    hold(f.payer, cart(f, 2)),
    safeError("CREDIT_UNAVAILABLE"),
  );
  const views = await Promise.all([
    dashboard(f.payer),
    dashboard(f.payer),
    atomic(f.c, (tx) => expireTx(tx, f.c)),
  ]);
  assert.equal(views[0].credits[0].available, 700);
  assert.deepEqual(
    (views[0].credits[0].lots as { available: number }[]).map(
      (l) => l.available,
    ),
    [700],
  );
  const ledger = await one(
    db,
    sql`select count(*)::int n,sum(amount)::int amount from mint.credit_ledger where source like ${"credit-expiry:" + old.id + ":%"}`,
  );
  assert.equal(ledger.n, 1);
  assert.equal(ledger.amount, -500);
  const friend = await dashboard(f.friend);
  assert.equal(friend.credits.length, 0);
});

test("a released checkout hold retains expiry and cannot renew an expired grant", async () => {
  const f = await fixture(20, 3000);
  const o = await hold(f.payer, cart(f));
  await db.execute(
    sql`update mint.credit_lots set expires_at=clock_timestamp() where source=${"fixture-credit:" + f.c}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  const held = await one(
    db,
    sql`select available,reserved from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
  );
  assert.equal(held.available, 0);
  assert.equal(held.reserved, 500);
  await db.execute(
    sql`update mint.orders set hold_until=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  const ac = await one(
    db,
    sql`select available,reserved from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
  );
  assert.equal(ac.available, 0);
  assert.equal(ac.reserved, 0);
  const lot = await one(
    db,
    sql`select * from mint.credit_lots where source=${"fixture-credit:" + f.c}`,
  );
  assert.equal(lot.expired, 3000);
  const expiry = await one(
    db,
    sql`select sum(amount)::int amount from mint.credit_ledger where source like ${"credit-expiry:" + lot.id + ":%"}`,
  );
  assert.equal(expiry.amount, -3000);
});

test("credit reserved before expiry can finish checkout, and ordinary cancellation returns full value", async () => {
  const f = await fixture(20, 500);
  const o = await hold(f.payer, cart(f));
  await db.execute(
    sql`update mint.credit_lots set expires_at=clock_timestamp() where source=${"fixture-credit:" + f.c}`,
  );
  await creditOnly(f.payer, String(o.id));
  const u = (await portions(o.id))[0];
  await cancel(f.payer, String(o.id), [String(u.id)]);
  const cancelled = (await portions(o.id))[0];
  assert.equal(cancelled.credit_returned, 500);
  assert.equal(cancelled.missed_pickup_fine, 0);
  const ac = (await dashboard(f.payer)).credits[0];
  assert.equal(ac.available, 500);
  assert.equal((ac.lots as unknown[]).length, 1);
});

test("orders placed under the original policy retain full credit on missed arrival", async () => {
  const f = await fixture();
  const o = await confirmed(f);
  await db.execute(
    sql`update mint.orders set policy='demo-credit-v1-25+5',deadline=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await atomic(f.c, (tx) => expireTx(tx, f.c));
  const u = (await portions(o.id))[0];
  assert.equal(u.credit_returned, 500);
  assert.equal(u.missed_pickup_fine, 0);
});

test("rolling-release ledger entries allocate reservations and issue credit exactly once", async () => {
  const f = await fixture(20, 1000);
  const o = await hold(f.payer, cart(f, 1, 0));
  await atomic(f.c, async (tx) => {
    const ac = await account(tx, f.payer.id, f.c);
    await tx.execute(
      sql`update mint.orders set credit=500,external=0 where id=${o.id}`,
    );
    await tx.execute(
      sql`update mint.units set credit=500,external=0 where order_id=${o.id}`,
    );
    await tx.execute(
      sql`insert into mint.credit_ledger(account_id,amount,reserved_delta,source,reason,order_id) values(${ac.id},-500,500,${"old-reserve:" + o.id},'Previous backend reservation',${o.id})`,
    );
    await tx.execute(
      sql`update mint.credit_accounts set available=available-500,reserved=reserved+500 where id=${ac.id}`,
    );
  });
  await creditOnly(f.payer, String(o.id));
  const ac = await one(
    db,
    sql`select * from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
  );
  await atomic(f.c, async (tx) => {
    await tx.execute(
      sql`insert into mint.credit_ledger(account_id,amount,source,reason) values(${ac.id},300,${"old-grant:" + f.c},'Previous backend credit')`,
    );
    await tx.execute(
      sql`update mint.credit_accounts set available=available+300 where id=${ac.id}`,
    );
  });
  await dashboard(f.payer);
  await dashboard(f.payer);
  const lots = await one(
    db,
    sql`select sum(available)::int available,sum(reserved)::int reserved from mint.credit_lots where account_id=${ac.id}`,
  );
  assert.equal(lots.available, 800);
  assert.equal(lots.reserved, 0);
  const replay = await one(
    db,
    sql`select count(*)::int n from mint.credit_lots where source=${"old-grant:" + f.c}`,
  );
  assert.equal(replay.n, 1);
  const unit = (await portions(o.id))[0];
  await atomic(f.c, async (tx) => {
    await tx.execute(
      sql`insert into mint.credit_ledger(account_id,amount,source,reason,order_id) values(${ac.id},500,${"cancel:" + unit.id},'Previous backend cancellation',${o.id})`,
    );
    await tx.execute(
      sql`update mint.credit_accounts set available=available+500 where id=${ac.id}`,
    );
    await tx.execute(
      sql`update mint.units set state='cancelled' where id=${unit.id}`,
    );
  });
  await dashboard(f.payer);
  assert.equal((await portions(o.id))[0].credit_returned, 500);
});

test("late captured payment cannot spend expired credit and retains one external refund resolution", async () => {
  const f = await fixture(20, 500);
  const o = await hold(f.payer, cart(f, 1, 200));
  const providerOrder = "order_fixture" + randomUUID().replaceAll("-", "");
  await db.execute(
    sql`update mint.orders set provider_order=${providerOrder},hold_until=clock_timestamp()-interval '1 second' where id=${o.id}`,
  );
  await db.execute(
    sql`update mint.credit_lots set expires_at=clock_timestamp() where source=${"fixture-credit:" + f.c}`,
  );
  const payment = {
    id: "pay_fixture" + randomUUID().replaceAll("-", ""),
    order_id: providerOrder,
    amount: 300,
    currency: "INR",
    status: "captured",
    captured: true,
  };
  const result = await applyCaptured(payment);
  await applyCaptured(payment);
  assert.equal(result.state, "exception");
  const refunds = await one(
    db,
    sql`select count(*)::int n,sum(amount)::int amount from mint.resolutions where order_id=${o.id}`,
  );
  assert.equal(refunds.n, 1);
  assert.equal(refunds.amount, 300);
  const ac = await one(
    db,
    sql`select available,reserved from mint.credit_accounts where user_id=${f.payer.id} and canteen_id=${f.c}`,
  );
  assert.equal(ac.available, 0);
  assert.equal(ac.reserved, 0);
  assert.equal((await portions(o.id))[0].missed_pickup_fine, 0);
});

test("new checkout requires disclosed credit policy while legacy checkout retries retain their original terms", async () => {
  const f = await fixture();
  const request = cart(f);
  await assert.rejects(
    hold(f.payer, { ...request, policy: undefined }),
    safeError("POLICY_CHANGED"),
  );
  assert.equal(
    (
      await one(
        db,
        sql`select count(*)::int n from mint.orders where canteen_id=${f.c}`,
      )
    ).n,
    0,
  );
  const o = await hold(f.payer, request);
  const legacy = { ...request, policy: undefined };
  const { hash } = await import("../src/modules/core");
  await db.execute(
    sql`update mint.orders set policy='demo-credit-v1-25+5',request_hash=${hash(JSON.stringify({ ...legacy, key: undefined }))} where id=${o.id}`,
  );
  const retry = await hold(f.payer, legacy);
  assert.equal(retry.id, o.id);
  assert.equal(retry.policy, "demo-credit-v1-25+5");
});
