import { sql } from "drizzle-orm";
import { db } from "../db";
import { atomic, rows, scope, orderScope, type Actor } from "./core";
import { expireTx } from "./orders";
export async function catalogue() {
  const canteens = await rows(
    db,
    sql`select * from mint.canteens where name in ('Main','IT','MBA') order by name`,
  );
  const due = await rows(
    db,
    sql`select distinct o.canteen_id from mint.orders o where o.canteen_id in(select id from mint.canteens where name in ('Main','IT','MBA')) and ((o.state='pending' and o.hold_until<=clock_timestamp()) or (o.state='confirmed' and o.deadline<=clock_timestamp() and exists(select 1 from mint.units u where u.order_id=o.id and u.arrived_at is null and u.state='pending')))`,
  );
  for (const c of due)
    await atomic(String(c.canteen_id), (tx) =>
      expireTx(tx, String(c.canteen_id)),
    );
  return {
    canteens,
    stations: await rows(
      db,
      sql`select * from mint.stations where canteen_id in(select id from mint.canteens where name in ('Main','IT','MBA')) order by name`,
    ),
    items: await rows(
      db,
      sql`select i.*,s.name station_name,s.paused station_paused,coalesce(sum(b.total-b.held-b.committed-b.waste),0)::int available from mint.items i join mint.stations s on s.id=i.station_id left join mint.batches b on b.item_id=i.id where i.canteen_id in(select id from mint.canteens where name in ('Main','IT','MBA')) group by i.id,s.id order by i.name`,
    ),
    serverTime: new Date().toISOString(),
  };
}
export async function orderView(a: Actor, id: string) {
  const o = await orderScope(a, id);
  await atomic(String(o.canteen_id), (tx) =>
    expireTx(tx, String(o.canteen_id)),
  );
  const payer = o.payer_id === a.id;
  const orders = await rows(
    db,
    sql`select id,reference,state,total,credit,external,provider_order,hold_until,confirmed_at,target_at,deadline,policy,canteen_id from mint.orders where id=${id}`,
  );
  const units = await rows(
    db,
    sql`select u.id,u.name,u.station_id,s.name station_name,u.state,u.mode,u.version,u.arrived_at,u.collection_deadline,u.collected_at,u.collector_id,p.name collector_name,u.token,case when ${payer} then u.price else null end price,${payer}::boolean payer from mint.units u join mint.stations s on s.id=u.station_id join mint.profiles p on p.id=u.collector_id where u.order_id=${id} and (${payer} or u.collector_id=${a.id}) order by s.name,u.name,u.id`,
  );
  const order = orders[0];
  if (!payer) {
    delete order.total;
    delete order.credit;
    delete order.external;
    delete order.provider_order;
  }
  return {
    order: { ...order, payer } as import("./core").Row,
    units,
    invitations: payer
      ? await rows(
          db,
          sql`select id,state from mint.invitations where order_id=${id}`,
        )
      : [],
    resolutions: payer
      ? await rows(
          db,
          sql`select amount,reason,state,provider_refund from mint.resolutions where order_id=${id}`,
        )
      : [],
    serverTime: new Date().toISOString(),
  };
}
export async function dashboard(a: Actor) {
  const memberships = await rows(
    db,
    sql`select r.*,c.name canteen_name,s.name station_name from mint.roles r join mint.canteens c on c.id=r.canteen_id left join mint.stations s on s.id=r.station_id where user_id=${a.id}`,
  );
  if (a.kind === "staff")
    return {
      actor: a,
      roles: memberships,
      orders: [],
      credits: [],
      ledger: [],
      invitations: [],
      serverTime: new Date().toISOString(),
    };
  return {
    actor: a,
    roles: memberships,
    orders: await rows(
      db,
      sql`select distinct o.id,o.reference,o.state,o.created_at,o.deadline,o.canteen_id,c.name canteen_name,(o.payer_id=${a.id}) payer,(select jsonb_agg(jsonb_build_object('state',fu.state,'arrived',fu.arrived_at is not null)) from mint.units fu where fu.order_id=o.id and (o.payer_id=${a.id} or fu.collector_id=${a.id})) fulfillment from mint.orders o join mint.canteens c on c.id=o.canteen_id left join mint.units u on u.order_id=o.id where o.payer_id=${a.id} or u.collector_id=${a.id} order by o.created_at desc limit 50`,
    ),
    credits: await rows(
      db,
      sql`select a.*,c.name canteen_name from mint.credit_accounts a join mint.canteens c on c.id=a.canteen_id where a.user_id=${a.id}`,
    ),
    ledger: await rows(
      db,
      sql`select l.amount,l.reserved_delta,l.reason,l.order_id,l.created_at,c.name canteen_name from mint.credit_ledger l join mint.credit_accounts a on a.id=l.account_id join mint.canteens c on c.id=a.canteen_id where a.user_id=${a.id} order by l.created_at desc limit 100`,
    ),
    invitations: await rows(
      db,
      sql`select i.id,i.state,o.reference,o.deadline,p.name sender_name,(select jsonb_agg(jsonb_build_object('name',u.name,'station',s.name)) from mint.units u join mint.stations s on s.id=u.station_id where u.order_id=i.order_id and u.id::text in(select jsonb_object_keys(i.versions))) portions from mint.invitations i join mint.orders o on o.id=i.order_id join mint.profiles p on p.id=i.sender_id where i.recipient_id=${a.id} and i.state='pending'`,
    ),
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
