import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  atomic,
  one,
  rows,
  scope,
  orderScope,
  type Actor,
  type Row,
} from "./core";
import { orderLimits } from "./order-limits";
import { expireTx } from "./orders";
export async function catalogue() {
  const canteensRead = rows(
    db,
    sql`select * from mint.canteens where name in ('Main','IT','MBA') order by name`,
  );
  const dueRead = rows(
    db,
    sql`select distinct o.canteen_id from mint.orders o where o.canteen_id in(select id from mint.canteens where name in ('Main','IT','MBA')) and ((o.state='pending' and o.hold_until<=clock_timestamp()) or (o.state='confirmed' and o.deadline<=clock_timestamp() and exists(select 1 from mint.units u where u.order_id=o.id and u.arrived_at is null and u.state='pending')))`,
  );
  const stationsRead = rows(
    db,
    sql`select * from mint.stations where canteen_id in(select id from mint.canteens where name in ('Main','IT','MBA')) order by name`,
  );
  const [canteens, due, stations] = await Promise.all([
    canteensRead,
    dueRead,
    stationsRead,
  ]);
  for (const c of due)
    await atomic(String(c.canteen_id), (tx) =>
      expireTx(tx, String(c.canteen_id)),
    );
  return {
    canteens,
    stations,
    items: await rows(
      db,
      sql`select i.*,s.name station_name,s.paused station_paused,coalesce(sum(b.total-b.held-b.committed-b.waste),0)::int available from mint.items i join mint.stations s on s.id=i.station_id left join mint.batches b on b.item_id=i.id where not i.archived and i.canteen_id in(select id from mint.canteens where name in ('Main','IT','MBA')) group by i.id,s.id order by i.name`,
    ),
    serverTime: new Date().toISOString(),
  };
}
export async function orderView(a: Actor, id: string) {
  const o = await orderScope(a, id);
  // Live orders need no write lock; overdue reads still run the same expiry transaction.
  if (o.read_expiry_due)
    await atomic(String(o.canteen_id), (tx) =>
      expireTx(tx, String(o.canteen_id)),
    );
  const payer = o.payer_id === a.id;
  const result = await one<Row & { order: Row; units: Row[] }>(
    db,
    sql`select
    jsonb_build_object('id',o.id,'reference',o.reference,'state',o.state,
      'total',o.total,'credit',o.credit,'external',o.external,'provider_order',o.provider_order,
      'hold_until',o.hold_until,'confirmed_at',o.confirmed_at,'target_at',o.target_at,
      'deadline',o.deadline,'policy',o.policy,'canteen_id',o.canteen_id,'payer',${payer}::boolean) as "order",
    coalesce((select jsonb_agg(portion order by portion->>'station_name',portion->>'name',portion->>'id') from (
      select jsonb_build_object('id',u.id,'name',u.name,'station_id',u.station_id,'station_name',s.name,
        'state',u.state,'mode',u.mode,'version',u.version,'arrived_at',u.arrived_at,
        'collection_deadline',u.collection_deadline,'collected_at',u.collected_at,
        'collector_id',u.collector_id,'collector_name',p.name,'token',u.token,
        'price',case when ${payer} then u.price else null end,'payer',${payer}::boolean) portion
      from mint.units u join mint.stations s on s.id=u.station_id join mint.profiles p on p.id=u.collector_id
      where u.order_id=o.id and (${payer} or u.collector_id=${a.id})
    ) portions),'[]'::jsonb) units,
    case when ${payer} then coalesce((select jsonb_agg(jsonb_build_object('id',id,'state',state)) from mint.invitations where order_id=o.id),'[]'::jsonb) else '[]'::jsonb end invitations,
    case when ${payer} then coalesce((select jsonb_agg(jsonb_build_object('amount',amount,'reason',reason,'state',state,'provider_refund',provider_refund)) from mint.resolutions where order_id=o.id),'[]'::jsonb) else '[]'::jsonb end resolutions
    from mint.orders o where o.id=${id}`,
  );
  const order = result.order as import("./core").Row;
  if (!payer) {
    delete order.total;
    delete order.credit;
    delete order.external;
    delete order.provider_order;
  }
  return { ...result, order, serverTime: new Date().toISOString() };
}
export async function dashboard(a: Actor) {
  const profileRead = one(
    db,
    sql`select name,phone,completed_at from mint.profiles where id=${a.id}`,
  );
  const membershipsRead = rows(
    db,
    sql`select r.*,c.name canteen_name,s.name station_name from mint.roles r join mint.canteens c on c.id=r.canteen_id left join mint.stations s on s.id=r.station_id where user_id=${a.id}`,
  );
  const [profile, memberships] = await Promise.all([
    profileRead,
    membershipsRead,
  ]);
  if (a.kind === "staff")
    return {
      actor: a,
      profile,
      roles: memberships,
      orders: [],
      credits: [],
      ledger: [],
      invitations: [],
      serverTime: new Date().toISOString(),
    };
  const [orders, credits, ledger, invitations, limits] = await Promise.all([
    rows(
      db,
      sql`select distinct o.id,o.reference,o.state,o.created_at,o.deadline,o.canteen_id,c.name canteen_name,(o.payer_id=${a.id}) payer,(select jsonb_agg(jsonb_build_object('state',fu.state,'arrived',fu.arrived_at is not null)) from mint.units fu where fu.order_id=o.id and (o.payer_id=${a.id} or fu.collector_id=${a.id})) fulfillment from mint.orders o join mint.canteens c on c.id=o.canteen_id left join mint.units u on u.order_id=o.id where o.payer_id=${a.id} or u.collector_id=${a.id} order by o.created_at desc limit 50`,
    ),
    rows(
      db,
      sql`select a.*,c.name canteen_name from mint.credit_accounts a join mint.canteens c on c.id=a.canteen_id where a.user_id=${a.id}`,
    ),
    rows(
      db,
      sql`select l.amount,l.reserved_delta,l.reason,l.order_id,l.created_at,c.name canteen_name from mint.credit_ledger l join mint.credit_accounts a on a.id=l.account_id join mint.canteens c on c.id=a.canteen_id where a.user_id=${a.id} order by l.created_at desc limit 100`,
    ),
    rows(
      db,
      sql`select i.id,i.state,o.reference,o.deadline,p.name sender_name,(select jsonb_agg(jsonb_build_object('name',u.name,'station',s.name)) from mint.units u join mint.stations s on s.id=u.station_id where u.order_id=i.order_id and u.id::text in(select jsonb_object_keys(i.versions))) portions from mint.invitations i join mint.orders o on o.id=i.order_id join mint.profiles p on p.id=i.sender_id where i.recipient_id=${a.id} and i.state='pending'`,
    ),
    orderLimits(db, a),
  ]);
  return {
    actor: a,
    limits,
    profile,
    roles: memberships,
    orders,
    credits,
    ledger,
    invitations,
    serverTime: new Date().toISOString(),
  };
}
export async function managerView(a: Actor, canteen: string) {
  await scope(db, a, canteen, ["manager"]);
  return {
    exceptions: await rows(
      db,
      sql`select u.id,u.name,u.token,u.state,u.arrived_at,u.collection_deadline,o.reference from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${canteen} and o.state='confirmed' and u.collection_deadline<=clock_timestamp() and u.state in ('pending','preparing','ready')`,
    ),
    resolutions: await rows(
      db,
      sql`select r.id,r.amount,r.reason,r.state,r.attempts,r.last_error,o.reference from mint.resolutions r join mint.orders o on o.id=r.order_id where o.canteen_id=${canteen} order by r.created_at desc`,
    ),
    pendingPayments: await rows(
      db,
      sql`select id,reference,state,created_at from mint.orders where canteen_id=${canteen} and (state='exception' or reconcile_at is not null or exists(select 1 from mint.audit_events a where a.entity=mint.orders.id::text and a.action='payment_mismatch'))`,
    ),
    batches: await rows(
      db,
      sql`select b.*,i.name from mint.batches b join mint.items i on i.id=b.item_id where i.canteen_id=${canteen} order by b.created_at desc`,
    ),
    worker: await rows(
      db,
      sql`select *,last_at<clock_timestamp()-interval '90 seconds' stale from mint.worker_health`,
    ),
    report: await rows(
      db,
      sql`select (select coalesce(sum(o.total),0) from mint.orders o where o.canteen_id=${canteen} and o.state='confirmed')::bigint gross_sales,(select coalesce(sum(amount),0) from mint.payments p join mint.orders o on o.id=p.order_id where o.canteen_id=${canteen})::bigint external_captured,(select coalesce(sum(available+reserved),0) from mint.credit_accounts where canteen_id=${canteen})::bigint credit_liability,(select coalesce(sum(l.amount),0) from mint.credit_ledger l join mint.credit_accounts a on a.id=l.account_id where a.canteen_id=${canteen} and l.source like 'cancel:%')::bigint credit_issued,(select coalesce(sum(credit),0) from mint.orders where canteen_id=${canteen} and state='confirmed')::bigint credit_spent,(select coalesce(sum(amount),0) from mint.resolutions r join mint.orders o on o.id=r.order_id where o.canteen_id=${canteen})::bigint refunds_requested,(select coalesce(sum(amount),0) from mint.resolutions r join mint.orders o on o.id=r.order_id where o.canteen_id=${canteen} and r.state='completed')::bigint refunds_completed,(select count(*) from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${canteen} and u.state='collected')::int collected_portions`,
    ),
    audit: await rows(
      db,
      sql`select action,entity,data,created_at from mint.audit_events where entity=${canteen} or entity in(select id::text from mint.orders where canteen_id=${canteen}) order by created_at desc limit 40`,
    ),
  };
}
