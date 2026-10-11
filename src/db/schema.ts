import {
  pgSchema,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const mint = pgSchema("mint");
const id = () => uuid("id").primaryKey().defaultRandom();
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
export const profiles = mint.table("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  phone: text("phone"),
  completedAt: time("completed_at"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const allowed = mint.table("allowed_identities", {
  email: text("email").primaryKey(),
  kind: text("kind").notNull(),
});
export const canteens = mint.table("canteens", {
  id: id(),
  name: text("name").notNull().unique(),
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  radius: integer("radius").notNull(),
  maxAccuracy: integer("max_accuracy").notNull(),
  paused: boolean("paused").notNull().default(false),
  demo: boolean("demo").notNull().default(true),
  collectionMinutes: integer("collection_minutes").notNull().default(20),
});
export const stations = mint.table(
  "stations",
  {
    id: id(),
    canteenId: uuid("canteen_id")
      .notNull()
      .references(() => canteens.id),
    name: text("name").notNull(),
    paused: boolean("paused").notNull().default(false),
  },
  (t) => [uniqueIndex("station_names").on(t.canteenId, t.name)],
);
export const roles = mint.table(
  "roles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    canteenId: uuid("canteen_id")
      .notNull()
      .references(() => canteens.id),
    stationId: uuid("station_id").references(() => stations.id),
    role: text("role").notNull(),
  },
  (t) => [index("roles_user").on(t.userId)],
);
export const items = mint.table(
  "items",
  {
    id: id(),
    canteenId: uuid("canteen_id")
      .notNull()
      .references(() => canteens.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    mode: text("mode").notNull(),
    note: text("note").notNull().default(""),
    category: text("category").notNull().default(""),
    orderGroup: text("order_group").notNull().default("other"),
    orderCap: integer("order_cap").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    defaultQuantity: integer("default_quantity").notNull().default(0),
    paused: boolean("paused").notNull().default(false),
  },
  (t) => [
    index("menu_canteen").on(t.canteenId),
    check(
      "item_order_group",
      sql`${t.orderGroup} in ('meal','bread','drink','other')`,
    ),
    check("item_order_cap", sql`${t.orderCap} between 0 and 6`),
    check("positive_price", sql`${t.price}>0`),
    check("item_mode", sql`${t.mode} in ('ready','made')`),
    check(
      "default_quantity_range",
      sql`${t.defaultQuantity} between 0 and 10000`,
    ),
  ],
);
export const batches = mint.table(
  "batches",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    total: integer("total").notNull(),
    held: integer("held").notNull().default(0),
    committed: integer("committed").notNull().default(0),
    waste: integer("waste").notNull().default(0),
    reusable: boolean("reusable").notNull().default(true),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("batch_item").on(t.itemId),
    check(
      "batch_capacity",
      sql`${t.total}>=0 and ${t.held}>=0 and ${t.committed}>=0 and ${t.waste}>=0 and ${t.held}+${t.committed}+${t.waste}<=${t.total}`,
    ),
  ],
);
export const accounts = mint.table(
  "credit_accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    canteenId: uuid("canteen_id")
      .notNull()
      .references(() => canteens.id),
    available: integer("available").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
  },
  (t) => [
    uniqueIndex("credit_owner").on(t.userId, t.canteenId),
    check("credit_nonnegative", sql`${t.available}>=0 and ${t.reserved}>=0`),
  ],
);
export const orders = mint.table(
  "orders",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    payerId: uuid("payer_id")
      .notNull()
      .references(() => profiles.id),
    canteenId: uuid("canteen_id")
      .notNull()
      .references(() => canteens.id),
    state: text("state").notNull().default("pending"),
    total: integer("total").notNull(),
    credit: integer("credit").notNull(),
    external: integer("external").notNull(),
    requestKey: text("request_key").notNull().unique(),
    requestHash: text("request_hash").notNull(),
    providerOrder: text("provider_order").unique(),
    paymentId: text("payment_id").unique(),
    holdUntil: time("hold_until").notNull(),
    confirmedAt: time("confirmed_at"),
    targetAt: time("target_at"),
    deadline: time("deadline"),
    policy: text("policy").notNull().default("demo-credit-v1-25+5"),
    createdAt: time("created_at").notNull().defaultNow(),
    reconcileAt: time("reconcile_at"),
    nextPaymentCheckAt: time("next_payment_check_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_payer").on(t.payerId),
    index("orders_expiry").on(t.state, t.holdUntil),
    check(
      "order_money",
      sql`${t.total}>0 and ${t.credit}>=0 and ${t.external}>=0 and ${t.credit}+${t.external}=${t.total}`,
    ),
  ],
);
export const units = mint.table(
  "units",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    name: text("name").notNull(),
    orderGroup: text("order_group").notNull().default("other"),
    price: integer("price").notNull(),
    credit: integer("credit").notNull(),
    external: integer("external").notNull(),
    mode: text("mode").notNull(),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => profiles.id),
    version: integer("version").notNull().default(1),
    state: text("state").notNull().default("pending"),
    arrivedAt: time("arrived_at"),
    readyAt: time("ready_at"),
    collectionDeadline: time("collection_deadline"),
    collectedAt: time("collected_at"),
    resolved: boolean("resolved").notNull().default(false),
    creditReturned: integer("credit_returned").notNull().default(0),
    missedPickupFine: integer("missed_pickup_fine").notNull().default(0),
    token: text("token").notNull().unique(),
  },
  (t) => [
    index("units_order").on(t.orderId),
    index("collector_units").on(t.collectorId, t.orderId),
    index("station_worklist").on(t.stationId, t.state),
    check(
      "unit_money",
      sql`${t.credit}>=0 and ${t.external}>=0 and ${t.credit}+${t.external}=${t.price}`,
    ),
    check(
      "unit_return",
      sql`${t.creditReturned}>=0 and ${t.missedPickupFine}>=0 and ${t.creditReturned}+${t.missedPickupFine}<=${t.price}`,
    ),
    check(
      "unit_state",
      sql`${t.state} in ('pending','preparing','ready','collected','cancelled','expired')`,
    ),
  ],
);
export const ledger = mint.table(
  "credit_ledger",
  {
    lotsProcessed: boolean("lots_processed").notNull().default(false),
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    amount: integer("amount").notNull(),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    source: text("source").notNull().unique(),
    reason: text("reason").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    actorId: uuid("actor_id").references(() => profiles.id),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("credit_ledger_unprocessed")
      .on(t.accountId, t.createdAt, t.id)
      .where(sql`not ${t.lotsProcessed}`),
  ],
);

export const creditLots = mint.table(
  "credit_lots",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    source: text("source").notNull().unique(),
    orderId: uuid("order_id").references(() => orders.id),
    available: integer("available").notNull(),
    reserved: integer("reserved").notNull().default(0),
    expired: integer("expired").notNull().default(0),
    expiresAt: time("expires_at").notNull(),
  },
  (t) => [
    index("credit_lots_account_expiry").on(t.accountId, t.expiresAt),
    index("credit_lots_due")
      .on(t.expiresAt)
      .where(sql`${t.available}>0`),
    check(
      "credit_lot_nonnegative",
      sql`${t.available}>=0 and ${t.reserved}>=0 and ${t.expired}>=0`,
    ),
  ],
);
export const creditReservations = mint.table(
  "credit_reservations",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => creditLots.id),
    amount: integer("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.lotId] }),
    check("credit_reservation_positive", sql`${t.amount}>0`),
  ],
);
export const stock = mint.table("stock_events", {
  id: id(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => batches.id),
  quantity: integer("quantity").notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull().unique(),
  actorId: uuid("actor_id").references(() => profiles.id),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const passes = mint.table("passes", {
  id: id(),
  hash: text("hash").notNull().unique(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  collectorId: uuid("collector_id")
    .notNull()
    .references(() => profiles.id),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  versions: jsonb("versions").notNull(),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const invitations = mint.table("invitations", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => profiles.id),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => profiles.id),
  versions: jsonb("versions").notNull(),
  state: text("state").notNull().default("pending"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const events = mint.table(
  "audit_events",
  {
    id: id(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    source: text("source").notNull().unique(),
    data: jsonb("data").notNull().default({}),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_action_time").on(t.entity, t.action, t.createdAt),
  ],
);
export const providerEvents = mint.table("provider_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  state: text("state").notNull().default("pending"),
  paymentId: text("payment_id"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const payments = mint.table("payments", {
  id: text("id").primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  amount: integer("amount").notNull(),
  status: text("status").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const resolutions = mint.table("resolutions", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  paymentId: text("payment_id").notNull().unique(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  state: text("state").notNull().default("pending"),
  providerRefund: text("provider_refund"),
  attempts: integer("attempts").notNull().default(0),
  retryAt: time("retry_at").notNull().defaultNow(),
  claimedUntil: time("claimed_until"),
  lastError: text("last_error"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const rateLimits = mint.table("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: time("reset_at").notNull(),
});
export const heartbeat = mint.table("worker_health", {
  name: text("name").primaryKey(),
  lastAt: time("last_at").notNull(),
  error: text("error"),
});
