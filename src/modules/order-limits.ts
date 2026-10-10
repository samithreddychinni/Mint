import { sql } from "drizzle-orm";
import type { Executor } from "../db";
import { one, type Actor } from "./core";
import { LIMIT_TIERS, pickupTier, type OrderLimits } from "../lib/order-limits";

export async function orderLimits(
  tx: Executor,
  actor: Actor,
): Promise<OrderLimits> {
  const stats = await one(
    tx,
    sql`with reviewed as (
    select coalesce(max(created_at),'-infinity'::timestamptz) at from mint.audit_events where entity=${actor.id} and action='review_order_limits'
  ), usage as (
    select u.*,o.hold_until,
      (o.state='pending' and o.hold_until>statement_timestamp() or o.state='confirmed' and u.state in('pending','preparing','ready') and not(u.state='pending' and u.arrived_at is null and o.deadline is not null and o.deadline<=statement_timestamp())) active
    from mint.orders o join mint.units u on u.order_id=o.id
    where o.payer_id=${actor.id} and (o.state='pending' and o.hold_until>statement_timestamp() or o.state='confirmed' and (u.state in('pending','preparing','ready') or u.collected_at>statement_timestamp()-interval '30 minutes'))
  ), successes as (
    select o.id,max(u.collected_at) finished from mint.orders o join mint.units u on u.order_id=o.id
    where o.id in(select id from mint.orders where payer_id=${actor.id} union select order_id from mint.units where collector_id=${actor.id}) and (o.payer_id=${actor.id} or u.collector_id=${actor.id}) and o.state='confirmed' and o.confirmed_at>statement_timestamp()-interval '90 days'
    group by o.id having bool_and(u.state='collected')
  ), missed as (
    select u.order_id,max(e.created_at) missed_at from mint.units u join mint.orders o on o.id=u.order_id
    join mint.audit_events e on e.source='cancel-audit:'||u.id
    where u.collector_id=${actor.id} and u.state='expired' and u.arrived_at is null and o.state='confirmed'
      and e.actor_id is null and e.data->>'reason'='Final arrival deadline missed'
      and e.created_at<=o.deadline+interval '90 seconds' and e.created_at>(select at from reviewed)
      and e.created_at>statement_timestamp()-interval '90 days'
    group by u.order_id
  ), successful_days as (
    select (finished at time zone 'Asia/Kolkata')::date pickup_day,max(finished) finished from successes
    where not exists(select 1 from missed where (missed_at at time zone 'Asia/Kolkata')::date=(successes.finished at time zone 'Asia/Kolkata')::date)
    group by (finished at time zone 'Asia/Kolkata')::date
  ), cycles as (
    select o.id,case when o.state='expired' then o.hold_until else max(e.created_at) end ended
    from mint.orders o join mint.units u on u.order_id=o.id
    left join mint.audit_events e on e.source='cancel-audit:'||u.id and e.actor_id=${actor.id}
    where o.payer_id=${actor.id} and o.created_at>statement_timestamp()-interval '30 minutes' and o.created_at>(select at from reviewed)
      and (o.state='expired' and o.provider_order is null and o.reconcile_at is null or o.state='confirmed')
    group by o.id having o.state='expired' or (bool_and(u.state='cancelled') and count(e.id)=count(u.id))
  ), recent_missed as (select * from missed where missed_at>statement_timestamp()-interval '7 days')
  select
    (select count(distinct order_id)::int from usage where active) active_orders,
    (select count(*)::int from usage where active) outstanding,
    (select count(*)::int from usage where (active or collected_at>statement_timestamp()-interval '30 minutes') and order_group='meal') meals,
    (select count(*)::int from usage where (active or collected_at>statement_timestamp()-interval '30 minutes') and order_group='drink') drinks,
    coalesce((select jsonb_object_agg(item_id,qty) from (select item_id,count(*)::int qty from usage where active or collected_at>statement_timestamp()-interval '30 minutes' group by item_id) q),'{}'::jsonb) by_item,
    (select count(*)::int from successful_days) completed_days,
    (select count(distinct pickup_day)::int from (select (finished at time zone 'Asia/Kolkata')::date as pickup_day from successes union select (missed_at at time zone 'Asia/Kolkata')::date from missed) d) eligible_days,
    (select count(*)::int from recent_missed) no_shows,
    (select count(*)::int from successful_days where finished>coalesce((select max(missed_at) from recent_missed),statement_timestamp())) recovery_days,
    case when (select count(*) from cycles)>=3 and (select max(ended) from cycles)+interval '5 minutes'>statement_timestamp() then (select max(ended) from cycles)+interval '5 minutes' else null end cooldown_until`,
  );
  const genuine = !actor.email.endsWith(".invalid");
  const tier = genuine
    ? pickupTier(
        Number(stats.completed_days),
        Number(stats.eligible_days),
        Number(stats.no_shows),
        Number(stats.recovery_days),
      )
    : "standard";
  return {
    tier,
    limits: LIMIT_TIERS[tier],
    completedDays: genuine ? Number(stats.completed_days) : 0,
    usage: {
      activeOrders: Number(stats.active_orders),
      outstanding: Number(stats.outstanding),
      meals: Number(stats.meals),
      drinks: Number(stats.drinks),
      byItem: stats.by_item as Record<string, number>,
    },
    cooldownUntil: stats.cooldown_until
      ? new Date(String(stats.cooldown_until)).toISOString()
      : null,
  };
}
