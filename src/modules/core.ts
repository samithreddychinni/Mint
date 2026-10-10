import { sql, type SQL } from "drizzle-orm";
import { db, type Executor, type Tx } from "../db";
import { insist } from "../lib/errors";
import { createHash, randomBytes } from "node:crypto";
export type Row = Record<string, unknown>;
export async function rows<T extends Row = Row>(
  tx: Executor,
  q: SQL,
): Promise<T[]> {
  return Array.from(await tx.execute(q)) as unknown as T[];
}
export async function one<T extends Row = Row>(tx: Executor, q: SQL) {
  return (await rows<T>(tx, q))[0];
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export type Actor = { id: string; email: string; kind: string };
export function student(a: Actor) {
  insist(
    a.kind === "student",
    "FORBIDDEN",
    "A verified student session is required.",
    403,
  );
}
export async function scope(
  tx: Executor,
  a: Actor,
  c: string,
  roles: string[],
  station?: string,
) {
  const r = await one(
    tx,
    sql`select 1 from mint.roles where user_id=${a.id} and canteen_id=${c} and role in (${sql.join(
      roles.map((x) => sql`${x}`),
      sql`,`,
    )}) and (${station || null}::uuid is null or station_id=${station || null}::uuid or (role='manager' and station_id is null))`,
  );
  insist(
    r,
    "FORBIDDEN",
    "Your account does not have this canteen or station scope.",
    403,
  );
}
export async function atomic<T>(
  canteen: string,
  fn: (tx: Tx) => Promise<T>,
  studentId?: string,
) {
  return db.transaction(async (tx) => {
    if (studentId)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"student-order:" + studentId},0))`,
      );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${canteen},0))`,
    );
    return fn(tx);
  });
}
export async function now(tx: Executor) {
  return (await one(tx, sql`select clock_timestamp()::text as time`))!
    .time as string;
}
export async function audit(
  tx: Executor,
  a: Actor | null,
  action: string,
  entity: string,
  source: string,
  data: Row = {},
) {
  await tx.execute(
    sql`insert into mint.audit_events(actor_id,action,entity,source,data) values(${a?.id || null},${action},${entity},${source},${JSON.stringify(data)}::jsonb) on conflict(source) do nothing`,
  );
}
export async function rate(key: string, limit: number, seconds: number) {
  const row = await one(
    db,
    sql`insert into mint.rate_limits(key,count,reset_at) values(${key},1,clock_timestamp()+${seconds}*interval '1 second') on conflict(key) do update set count=case when mint.rate_limits.reset_at<=clock_timestamp() then 1 else mint.rate_limits.count+1 end,reset_at=case when mint.rate_limits.reset_at<=clock_timestamp() then clock_timestamp()+${seconds}*interval '1 second' else mint.rate_limits.reset_at end returning count`,
  );
  insist(
    Number(row?.count) <= limit,
    "RATE_LIMITED",
    "Too many attempts. Wait before trying again.",
    429,
  );
}
export async function orderScope(a: Actor, id: string) {
  const order = await one(
    db,
    sql`select o.*,
    (o.payer_id=${a.id} or exists(select 1 from mint.units where order_id=o.id and collector_id=${a.id})) related,
    ((o.state='pending' and o.hold_until<=clock_timestamp()) or
      (o.state='confirmed' and o.deadline<=clock_timestamp() and exists(select 1 from mint.units where order_id=o.id and arrived_at is null and state='pending'))) read_expiry_due
    from mint.orders o where o.id=${id}`,
  );
  insist(order, "NOT_FOUND", "Order not found.", 404);
  insist(order.related, "FORBIDDEN", "This order is not assigned to you.", 403);
  delete order.related;
  return order;
}
