import { sql } from "drizzle-orm";
import { db } from "../db";
import { one, scope, type Actor, type Row } from "./core";

export async function managerSummary(
  a: Actor,
  canteen: string,
  period: "today" | "week",
): Promise<Row> {
  await scope(db, a, canteen, ["manager"]);
  // One statement keeps totals consistent without multiplying orders by their portions.
  const result = await one(
    db,
    sql`with bounds as (
    select (date_trunc('day', current_timestamp at time zone 'Asia/Kolkata') - ${period === "week" ? 6 : 0} * interval '1 day') at time zone 'Asia/Kolkata' start_at,
      current_timestamp end_at
  ), paid as (
    select o.* from mint.orders o, bounds b where o.canteen_id=${canteen} and o.state='confirmed' and o.confirmed_at>=b.start_at and o.confirmed_at<=b.end_at
  ), availability as (
    select i.id,i.name,i.paused,s.paused station_paused,
      coalesce(sum(b.total-b.held-b.committed-b.waste),0)::int available
    from mint.items i join mint.stations s on s.id=i.station_id left join mint.batches b on b.item_id=i.id
    where i.canteen_id=${canteen} and not i.archived group by i.id,s.id
  ), popular as (
    select u.name,count(*)::int portions,coalesce(sum(u.price),0)::bigint value
    from mint.units u join paid o on o.id=u.order_id where u.state not in ('cancelled','expired')
    group by u.name order by count(*) desc,u.name limit 5
  ) select
    (select start_at from bounds) start_at,(select end_at from bounds) server_time,
    (select count(*)::int from paid) paid_orders,
    (select coalesce(sum(total),0)::bigint from paid) paid_value,
    (select coalesce(sum(credit),0)::bigint from paid) credit_used,
    (select coalesce(sum(p.amount),0)::bigint from mint.payments p join mint.orders o on o.id=p.order_id, bounds b where o.canteen_id=${canteen} and p.status='captured' and p.created_at>=b.start_at and p.created_at<=b.end_at) payments_captured,
    (select coalesce(sum(l.amount),0)::bigint from mint.credit_ledger l join mint.credit_accounts ac on ac.id=l.account_id, bounds b where ac.canteen_id=${canteen} and l.source like 'cancel:%' and l.created_at>=b.start_at and l.created_at<=b.end_at) credit_issued,
    (select coalesce(sum(available+reserved),0)::bigint from mint.credit_accounts where canteen_id=${canteen}) credit_balance,
    (select count(*)::int from mint.units u join mint.orders o on o.id=u.order_id, bounds b where o.canteen_id=${canteen} and u.state='collected' and u.collected_at>=b.start_at and u.collected_at<=b.end_at) collected_portions,
    (select count(*)::int from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${canteen} and o.state='confirmed' and u.state in ('pending','preparing','ready')) pending_portions,
    (select count(*)::int from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${canteen} and o.state='confirmed' and u.state in ('pending','preparing','ready') and u.arrived_at is not null) arrived_portions,
    (select count(*)::int from mint.orders o where o.canteen_id=${canteen} and (o.state='exception' or o.reconcile_at is not null or exists(select 1 from mint.audit_events ae where ae.entity=o.id::text and ae.action='payment_mismatch'))) payment_reviews,
    (select count(*)::int from mint.resolutions r join mint.orders o on o.id=r.order_id where o.canteen_id=${canteen} and r.state<>'completed') pending_refunds,
    (select count(*)::int from mint.units u join mint.orders o on o.id=u.order_id where o.canteen_id=${canteen} and o.state='confirmed' and u.state in ('pending','preparing','ready') and u.collection_deadline<=current_timestamp) overdue_portions,
    coalesce((select jsonb_agg(to_jsonb(p)) from popular p),'[]'::jsonb) popular_items,
    coalesce((select jsonb_agg(to_jsonb(i) order by i.available,i.name) from availability i where not i.paused and not i.station_paused and i.available<=5),'[]'::jsonb) low_stock,
    (select count(*)::int from availability where paused or station_paused) paused_items,
    coalesce((select bool_and(last_at>=current_timestamp-interval '90 seconds' and error is null) from mint.worker_health),false) worker_healthy
  `,
  );
  return { ...result, canteen_id: canteen, period };
}
