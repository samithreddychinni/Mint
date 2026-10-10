import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "../db";
import {
  atomic,
  one,
  rows,
  student,
  orderScope,
  now,
  hash,
  secret,
  audit,
  type Actor,
  type Row,
} from "./core";
import { expireTx } from "./orders";
import { insist } from "../lib/errors";
export type Location = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};
export function locationDecision(c: Row, s: Location, server: number) {
  if (
    s.timestamp > server + 5000 ||
    server - s.timestamp > 60000 ||
    s.accuracy > Number(c.max_accuracy)
  )
    return "LOCATION_INCONCLUSIVE";
  const r = Math.PI / 180;
  const dlat = (s.latitude - Number(c.lat)) * r,
    dlng = (s.longitude - Number(c.lng)) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(Number(c.lat) * r) *
      Math.cos(s.latitude * r) *
      Math.sin(dlng / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  if (distance + s.accuracy <= Number(c.radius)) return "accepted";
  if (distance - s.accuracy > Number(c.radius)) return "LOCATION_OUTSIDE";
  return "LOCATION_INCONCLUSIVE";
}
export async function recordArrival(tx: Tx, order: string, collector: string) {
  return rows(
    tx,
    sql`update mint.units u set arrived_at=statement_timestamp(),collection_deadline=case when u.mode='ready' or u.state='ready' then statement_timestamp()+c.collection_minutes*interval '1 minute' else u.collection_deadline end from mint.orders o join mint.canteens c on c.id=o.canteen_id where u.order_id=o.id and o.id=${order} and o.state='confirmed' and o.deadline>statement_timestamp() and u.collector_id=${collector} and u.arrived_at is null and u.state in ('pending','preparing','ready') returning u.*`,
  );
}
export async function checkIn(a: Actor, id: string, s: Location) {
  student(a);
  const o = await orderScope(a, id);
  return atomic(String(o.canteen_id), async (tx) => {
    await expireTx(tx, String(o.canteen_id));
    const current = (await one(
      tx,
      sql`select * from mint.orders where id=${id} for update`,
    ))!;
    insist(
      current.state === "confirmed",
      "NOT_CONFIRMED",
      "Payment must be confirmed before check-in.",
    );
    const server = Date.parse(await now(tx));
    if (server >= Date.parse(String(current.deadline)))
      return {
        accepted: false,
        code: "ARRIVAL_EXPIRED",
        message:
          "The final arrival deadline passed. Eligible portions expired.",
      };
    const c = (await one(
      tx,
      sql`select * from mint.canteens where id=${o.canteen_id}`,
    ))!;
    const result = locationDecision(c, s, server);
    await audit(
      tx,
      a,
      "student_check_in",
      id,
      "arrival-attempt:" + randomUUID(),
      {
        result,
        sampleAgeSeconds: Math.round((server - s.timestamp) / 1000),
        accuracy: s.accuracy,
      },
    );
    if (result !== "accepted")
      return {
        accepted: false,
        code: result,
        message:
          result === "LOCATION_OUTSIDE"
            ? c.demo
              ? "This canteen uses a demo pickup location. Show your pass at the counter; a staff scan checks you in."
              : "You are outside the configured pickup area. Move closer and retry, or show your pass at the counter."
            : "Location quality is inconclusive. Retry outdoors with precise location enabled.",
      };
    const changed = await recordArrival(tx, id, a.id);
    const unarrived = await one(
      tx,
      sql`select 1 from mint.units where order_id=${id} and collector_id=${a.id} and arrived_at is null and state in ('pending','preparing','ready') limit 1`,
    );
    if (unarrived)
      return {
        accepted: false,
        code: "ARRIVAL_EXPIRED",
        message:
          "The final arrival deadline passed. Refresh the order before collection.",
      };
    return {
      accepted: true,
      count: changed.length,
      message: "Check-in accepted for your assigned portions.",
    };
  });
}
export async function passes(a: Actor, id: string) {
  student(a);
  const o = await orderScope(a, id);
  return atomic(String(o.canteen_id), async (tx) => {
    await expireTx(tx, String(o.canteen_id));
    const units = await rows(
      tx,
      sql`select u.*,s.name station_name from mint.units u join mint.stations s on s.id=u.station_id where u.order_id=${id} and u.collector_id=${a.id} and u.state in ('pending','preparing','ready') and exists(select 1 from mint.orders o where o.id=u.order_id and o.state='confirmed')`,
    );
    const result = [];
    for (const station of new Set(units.map((u) => String(u.station_id)))) {
      const relevant = units.filter((u) => u.station_id === station);
      const token = secret();
      await tx.execute(
        sql`insert into mint.passes(hash,order_id,collector_id,station_id,versions,expires_at) values(${hash(token)},${id},${a.id},${station},${JSON.stringify(Object.fromEntries(relevant.map((u) => [u.id, u.version])))}::jsonb,clock_timestamp()+interval '1 day')`,
      );
      result.push({
        token,
        stationId: station,
        stationName: relevant[0].station_name,
        arrived: relevant.every((u) => u.arrived_at !== null),
      });
    }
    return result;
  });
}
export async function invite(
  a: Actor,
  id: string,
  unitIds: string[],
  email: string,
) {
  student(a);
  const o = await orderScope(a, id);
  insist(
    o.payer_id === a.id,
    "FORBIDDEN",
    "Delegates cannot further delegate.",
    403,
  );
  return atomic(String(o.canteen_id), async (tx) => {
    await expireTx(tx, String(o.canteen_id));
    insist(
      Date.parse(await now(tx)) < Date.parse(String(o.deadline)) &&
        o.state === "confirmed",
      "ARRIVAL_EXPIRED",
      "The original arrival deadline passed.",
    );
    const friend = await one(
      tx,
      sql`select * from mint.profiles where email=${email.toLowerCase()} and kind='student'`,
    );
    insist(
      friend && friend.id !== a.id,
      "RECIPIENT_UNAVAILABLE",
      "This exact address is not available for a pickup invitation.",
    );
    const units = await rows(
      tx,
      sql`select * from mint.units where order_id=${id} and id in (${sql.join(
        unitIds.map((uid) => sql`${uid}`),
        sql`,`,
      )}) for update`,
    );
    insist(
      units.length === unitIds.length &&
        units.every((u) =>
          ["pending", "preparing", "ready"].includes(String(u.state)),
        ),
      "INVALID_ASSIGNMENT",
      "Choose outstanding portions.",
    );
    const existing = await rows(
      tx,
      sql`select * from mint.invitations where order_id=${id} and state='pending' for update`,
    );
    insist(
      !existing.some((i) =>
        Object.keys(i.versions as Row).some((uid) => unitIds.includes(uid)),
      ),
      "INVITATION_CONFLICT",
      "Withdraw the conflicting pending invitation first.",
    );
    const invitation = await one(
      tx,
      sql`insert into mint.invitations(order_id,sender_id,recipient_id,versions) values(${id},${a.id},${friend!.id},${JSON.stringify(Object.fromEntries(units.map((u) => [u.id, u.version])))}::jsonb) returning id`,
    );
    await audit(tx, a, "pickup_invited", id, "invite:" + invitation!.id, {
      quantity: units.length,
    });
    return invitation;
  });
}
export async function invitationAction(
  a: Actor,
  id: string,
  action: "accept" | "decline" | "withdraw",
) {
  student(a);
  const i = await one(
    db,
    sql`select i.*,o.canteen_id from mint.invitations i join mint.orders o on o.id=i.order_id where i.id=${id}`,
  );
  insist(i, "NOT_FOUND", "Invitation not found.", 404);
  insist(
    action === "withdraw" ? i.sender_id === a.id : i.recipient_id === a.id,
    "FORBIDDEN",
    "This invitation is not yours.",
    403,
  );
  return atomic(String(i.canteen_id), async (tx) => {
    await expireTx(tx, String(i.canteen_id));
    const current = (await one(
      tx,
      sql`select i.*,o.deadline from mint.invitations i join mint.orders o on o.id=i.order_id where i.id=${id} for update of i`,
    ))!;
    if (
      current.state ===
        { accept: "accepted", decline: "declined", withdraw: "withdrawn" }[
          action
        ] ||
      (current.state === "accepted" && action === "accept")
    )
      return;
    insist(
      current.state === "pending",
      "INVITATION_CLOSED",
      "This invitation is already closed.",
    );
    if (action === "accept") {
      insist(
        Date.parse(await now(tx)) < Date.parse(String(current.deadline)),
        "ARRIVAL_EXPIRED",
        "The original arrival deadline passed.",
      );
      for (const [uid, version] of Object.entries(current.versions as Row)) {
        const u = await one(
          tx,
          sql`select * from mint.units where id=${uid} and order_id=${current.order_id} for update`,
        );
        insist(
          u &&
            u.version === version &&
            ["pending", "preparing", "ready"].includes(String(u.state)),
          "ASSIGNMENT_CHANGED",
          "A portion changed before acceptance.",
        );
        await tx.execute(
          sql`update mint.units set collector_id=${a.id},version=version+1 where id=${uid}`,
        );
      }
    }
    await tx.execute(
      sql`update mint.invitations set state=${action === "accept" ? "accepted" : action === "decline" ? "declined" : "withdrawn"} where id=${id}`,
    );
    await audit(tx, a, "invitation_" + action, id, "invitation-action:" + id);
  });
}
export async function returnRights(a: Actor, id: string, ids: string[]) {
  student(a);
  const o = await orderScope(a, id);
  insist(
    o.payer_id !== a.id,
    "FORBIDDEN",
    "The payer already owns these rights.",
  );
  return atomic(String(o.canteen_id), async (tx) => {
    await expireTx(tx, String(o.canteen_id));
    for (const uid of ids) {
      const u = await one(
        tx,
        sql`select * from mint.units where id=${uid} and order_id=${id} and collector_id=${a.id} for update`,
      );
      insist(
        u && ["pending", "preparing", "ready"].includes(String(u.state)),
        "ASSIGNMENT_CHANGED",
        "Portion is no longer assigned or outstanding.",
      );
      await tx.execute(
        sql`update mint.units set collector_id=${o.payer_id},version=version+1 where id=${uid}`,
      );
    }
    await audit(tx, a, "return_pickup_rights", id, "return:" + randomUUID(), {
      quantity: ids.length,
    });
  });
}
