import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import {
  atomic,
  one,
  rows,
  scope,
  hash,
  now,
  audit,
  type Actor,
  type Row,
} from "./core";
import { expireTx, cancelUnit } from "./orders";
import { recordArrival } from "./pickup";
import { insist } from "../lib/errors";
export async function resolvePass(
  a: Actor,
  token: string,
  station: string,
  reference?: string,
  collector?: string,
) {
  const stationRow = await one(
    db,
    sql`select * from mint.stations where id=${station}`,
  );
  insist(stationRow, "WRONG_STATION", "Station not found.");
  await scope(
    db,
    a,
    String(stationRow.canteen_id),
    ["serving", "manager"],
    station,
  );
  return atomic(String(stationRow.canteen_id), async (tx) => {
    await scope(
      tx,
      a,
      String(stationRow.canteen_id),
      ["serving", "manager"],
      station,
    );
    await expireTx(tx, String(stationRow.canteen_id));
    let units: Row[] = [];
    if (reference) {
      insist(
        collector,
        "COLLECTOR_REQUIRED",
        "Enter the expected collector email.",
        400,
      );
      units = await rows(
        tx,
        sql`select u.*,p.name collector_name,p.email collector_email,o.reference from mint.units u join mint.orders o on o.id=u.order_id join mint.profiles p on p.id=u.collector_id where o.reference=${reference} and p.email=${collector.toLowerCase()} and o.canteen_id=${stationRow.canteen_id} and u.station_id=${station} and o.state='confirmed' and u.state in ('pending','preparing','ready')`,
      );
      await audit(
        tx,
        a,
        "manual_pass_lookup",
        reference,
        "manual:" + randomUUID(),
      );
    } else {
      const pass = await one(
        tx,
        sql`select * from mint.passes where hash=${hash(token)}`,
      );
      insist(pass, "PASS_REVOKED", "Collection pass is not valid.");
      insist(
        pass.station_id === station,
        "WRONG_STATION",
        "Use the station shown on this pass.",
      );
      insist(
        Date.parse(String(pass.expires_at)) > Date.parse(await now(tx)),
        "PASS_REVOKED",
        "This pass expired. Ask the collector to refresh it.",
      );
      units = await rows(
        tx,
        sql`select u.*,p.name collector_name,p.email collector_email,o.reference from mint.units u join mint.orders o on o.id=u.order_id join mint.profiles p on p.id=u.collector_id where u.order_id=${pass.order_id} and u.station_id=${station} and u.collector_id=${pass.collector_id} and o.state='confirmed' and u.state in ('pending','preparing','ready')`,
      );
      const versions = pass.versions as Row;
      units = units.filter((u) => versions[String(u.id)] === u.version);
      insist(
        units.length > 0,
        "PASS_REVOKED",
        "No outstanding portions remain on this assignment.",
      );
      const arrived = await recordArrival(
        tx,
        String(pass.order_id),
        String(pass.collector_id),
      );
      units = units.map((unit) => ({
        ...unit,
        ...arrived.find((u) => u.id === unit.id),
      }));
      insist(
        units.every((u) => u.arrived_at),
        "ARRIVAL_EXPIRED",
        "The final arrival deadline passed. Refresh the order before collection.",
      );
      if (arrived.length)
        await audit(
          tx,
          a,
          "staff_scan_arrival",
          String(pass.order_id),
          "scan-arrival:" + randomUUID(),
          {
            collector: pass.collector_id,
            station,
            portions: arrived.map((u) => u.id),
          },
        );
    }
    insist(
      units.length > 0,
      "PASS_REVOKED",
      "No outstanding portions remain on this assignment.",
    );
    return {
      units,
      message: units.some((u) => !u.arrived_at)
        ? "A reference lookup cannot confirm arrival. Scan the collector's pickup pass or ask them to check in with location."
        : "Pickup QR accepted. Give the selected ready items to the person named on this pass. They may be collecting for a friend.",
    };
  });
}
export type PortionRequest = { id: string; version: number };
export async function handover(
  a: Actor,
  station: string,
  portions: PortionRequest[],
  key: string,
) {
  const s = await one(db, sql`select * from mint.stations where id=${station}`);
  insist(s, "WRONG_STATION", "Station not found.");
  await scope(db, a, String(s.canteen_id), ["serving", "manager"], station);
  const source = "handover:" + a.id + ":" + key;
  const requestHash = hash(JSON.stringify({ station, portions }));
  return atomic(String(s.canteen_id), async (tx) => {
    await scope(tx, a, String(s.canteen_id), ["serving", "manager"], station);
    await expireTx(tx, String(s.canteen_id));
    const previous = await one(
      tx,
      sql`select * from mint.audit_events where source=${source}`,
    );
    if (previous) {
      insist(
        (previous.data as Row).requestHash === requestHash,
        "IDEMPOTENCY_CONFLICT",
        "Retry with the same portion selection.",
      );
      return previous.data as Row;
    }
    const requested = sql.join(
      portions.map((p) => sql`${p.id}`),
      sql`,`,
    );
    const found = await rows(
      tx,
      sql`select u.*,o.state order_state,clock_timestamp()::text evaluated_at from mint.units u join mint.orders o on o.id=u.order_id where u.id in (${requested}) order by u.id for update of u`,
    );
    insist(
      found.length === portions.length,
      "WRONG_STATION",
      "A portion is no longer available.",
    );
    for (const u of found) {
      const p = portions.find((p) => p.id === u.id)!;
      insist(
        u.station_id === station,
        "WRONG_STATION",
        "This portion belongs to another station.",
      );
      insist(
        u.order_state === "confirmed",
        "NOT_CONFIRMED",
        "This order is not confirmed.",
      );
      insist(
        u.state !== "collected",
        "ALREADY_COLLECTED",
        "This portion was already collected.",
      );
      insist(
        u.version === p.version,
        "PASS_REVOKED",
        "Assignment changed. Resolve the current pass.",
      );
      insist(
        u.arrived_at,
        "ARRIVAL_REQUIRED",
        "Scan the collector's pickup pass or ask them to check in with location before collection.",
      );
      insist(
        u.state === "ready" || (u.mode === "ready" && u.state === "pending"),
        "NOT_READY",
        "This portion is not ready for handover.",
      );
      insist(
        !u.collection_deadline ||
          Date.parse(String(u.collection_deadline)) >
            Date.parse(String(u.evaluated_at)),
        "COLLECTION_OVERDUE",
        "Collection deadline passed. Manager review is required.",
      );
    }
    const collected = await rows(
      tx,
      sql`update mint.units set state='collected',collected_at=clock_timestamp() where id in (${requested}) and (collection_deadline is null or collection_deadline>clock_timestamp()) returning id`,
    );
    insist(
      collected.length === portions.length,
      "COLLECTION_OVERDUE",
      "Collection deadline passed. Manager review is required.",
    );
    const result = {
      requestHash,
      collected: portions.length,
      portions: portions.map((p) => p.id),
    };
    await audit(tx, a, "handover", station, source, result);
    return result;
  });
}
export async function preparation(
  a: Actor,
  id: string,
  action: "start" | "ready",
) {
  const u = await one(
    db,
    sql`select u.*,o.canteen_id from mint.units u join mint.orders o on o.id=u.order_id where u.id=${id}`,
  );
  insist(u, "NOT_FOUND", "Preparation portion not found.", 404);
  await scope(
    db,
    a,
    String(u.canteen_id),
    ["serving", "manager"],
    String(u.station_id),
  );
  return atomic(String(u.canteen_id), async (tx) => {
    await scope(
      tx,
      a,
      String(u.canteen_id),
      ["serving", "manager"],
      String(u.station_id),
    );
    await expireTx(tx, String(u.canteen_id));
    const current = (await one(
      tx,
      sql`select u.*,o.state order_state from mint.units u join mint.orders o on o.id=u.order_id where u.id=${id} for update of u`,
    ))!;
    insist(
      current.order_state === "confirmed" && current.arrived_at,
      "ARRIVAL_REQUIRED",
      "Arrival by location check-in or pickup-pass scan is required before preparation.",
    );
    insist(
      current.mode === "made",
      "INVALID_PREPARATION",
      "Ready stock does not need a preparation job.",
    );
    if (current.state === (action === "start" ? "preparing" : "ready")) return;
    insist(
      current.state === (action === "start" ? "pending" : "preparing"),
      "INVALID_STATE",
      "Preparation state changed. Refresh the worklist.",
    );
    if (action === "start")
      await tx.execute(
        sql`update mint.units set state='preparing' where id=${id}`,
      );
    else
      await tx.execute(
        sql`update mint.units set state='ready',ready_at=clock_timestamp(),collection_deadline=clock_timestamp()+(select collection_minutes from mint.canteens where id=${u.canteen_id})*interval '1 minute' where id=${id}`,
      );
    await audit(
      tx,
      a,
      "preparation_" + action,
      id,
      "preparation:" + action + ":" + id,
    );
  });
}
export async function worklist(a: Actor, station: string) {
  const s = await one(db, sql`select * from mint.stations where id=${station}`);
  insist(s, "WRONG_STATION", "Station not found.");
  await scope(db, a, String(s.canteen_id), ["serving", "manager"], station);
  await atomic(String(s.canteen_id), (tx) =>
    expireTx(tx, String(s.canteen_id)),
  );
  return rows(
    db,
    sql`select u.id,u.name,u.mode,u.state,u.version,u.token,u.arrived_at,u.collection_deadline,u.collected_at,u.ready_at,o.reference,p.name collector_name,case when u.collection_deadline<=clock_timestamp() then true else false end overdue from mint.units u join mint.orders o on o.id=u.order_id join mint.profiles p on p.id=u.collector_id where u.station_id=${station} and o.state='confirmed' and u.arrived_at is not null and (u.state in ('pending','preparing','ready') or (u.state='collected' and u.collected_at>clock_timestamp()-interval '1 hour')) order by u.arrived_at,u.token`,
  );
}
export async function cashierSale(
  a: Actor,
  canteen: string,
  lines: { itemId: string; quantity: number }[],
  key: string,
) {
  await scope(db, a, canteen, ["cashier", "manager"]);
  const source = "cashier:" + a.id + ":" + key;
  const requestHash = hash(JSON.stringify(lines));
  return atomic(canteen, async (tx) => {
    await scope(tx, a, canteen, ["cashier", "manager"]);
    await expireTx(tx, canteen);
    const prior = await one(
      tx,
      sql`select data from mint.audit_events where source=${source}`,
    );
    if (prior) {
      insist(
        (prior.data as Row).requestHash === requestHash,
        "IDEMPOTENCY_CONFLICT",
        "Cashier request changed.",
      );
      return prior.data;
    }
    let total = 0;
    for (const l of [...lines].sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    )) {
      const item = await one(
        tx,
        sql`select * from mint.items where id=${l.itemId} and canteen_id=${canteen}`,
      );
      insist(item, "NOT_FOUND", "Item not found.");
      let remaining = l.quantity;
      const bs = await rows(
        tx,
        sql`select *,total-held-committed-waste available from mint.batches where item_id=${l.itemId} order by created_at,id for update`,
      );
      for (const b of bs) {
        const q = Math.min(remaining, Number(b.available));
        if (q) {
          await tx.execute(
            sql`update mint.batches set committed=committed+${q} where id=${b.id}`,
          );
          await tx.execute(
            sql`insert into mint.stock_events(batch_id,quantity,kind,source,actor_id) values(${b.id},${q},'walkin',${source + ":" + l.itemId + ":" + b.id},${a.id})`,
          );
          remaining -= q;
        }
      }
      insist(
        remaining === 0,
        "STOCK_UNAVAILABLE",
        "Not enough stock for this sale.",
      );
      total += Number(item!.price) * l.quantity;
    }
    const result = {
      total,
      requestHash,
      lines,
      paymentMethod: "cashier-recorded",
    };
    await audit(tx, a, "cashier_sale", canteen, source, result);
    return result;
  });
}
export async function manage(
  a: Actor,
  canteen: string,
  action: string,
  input: Row,
) {
  await scope(db, a, canteen, ["manager"]);
  return atomic(canteen, async (tx) => {
    await scope(tx, a, canteen, ["manager"]);
    const source = "manager:" + a.id + ":" + (input.key || randomUUID());
    const requestHash = hash(JSON.stringify({ ...input, key: undefined }));
    const previous = await one(
      tx,
      sql`select data from mint.audit_events where source=${source}`,
    );
    if (previous) {
      insist(
        (previous.data as Row).requestHash === requestHash,
        "IDEMPOTENCY_CONFLICT",
        "Manager request changed.",
      );
      return previous.data;
    }
    if (action === "stock") {
      insist(
        Number.isInteger(input.quantity) &&
          Number(input.quantity) >= 0 &&
          Number(input.quantity) <= 10000 &&
          Number.isInteger(input.expectedAvailable) &&
          Number(input.expectedAvailable) >= 0,
        "INVALID_STOCK",
        "Enter a whole available quantity between 0 and 10,000.",
        400,
      );
      const item = await one(
        tx,
        sql`select id from mint.items where id=${input.itemId} and canteen_id=${canteen}`,
      );
      insist(item, "NOT_FOUND", "Item not found in this canteen.", 404);
      await expireTx(tx, canteen);
      const batches = await rows(
        tx,
        sql`select *,total-held-committed-waste available from mint.batches where item_id=${input.itemId} order by created_at,id for update`,
      );
      const available = batches.reduce(
        (sum, b) => sum + Number(b.available),
        0,
      );
      insist(
        available === input.expectedAvailable,
        "STOCK_CHANGED",
        "Stock changed while you were editing. Review the latest availability and save again.",
      );
      if (Number(input.quantity) > available) {
        const added = Number(input.quantity) - available;
        const batch = await one(
          tx,
          sql`insert into mint.batches(item_id,total,reusable) values(${input.itemId},${added},true) returning id`,
        );
        await tx.execute(
          sql`insert into mint.stock_events(batch_id,quantity,kind,source,actor_id) values(${batch!.id},${added},'stock_add',${source + ":add"},${a.id})`,
        );
      } else {
        let remaining = available - Number(input.quantity);
        for (const batch of batches) {
          const removed = Math.min(remaining, Number(batch.available));
          if (!removed) continue;
          await tx.execute(
            sql`update mint.batches set waste=waste+${removed} where id=${batch.id}`,
          );
          await tx.execute(
            sql`insert into mint.stock_events(batch_id,quantity,kind,source,actor_id) values(${batch.id},${removed},'stock_withdraw',${source + ":" + batch.id},${a.id})`,
          );
          remaining -= removed;
        }
      }
    } else if (action === "item-settings") {
      const item = await one(
        tx,
        sql`select * from mint.items where id=${input.itemId} and canteen_id=${canteen} for update`,
      );
      insist(item, "NOT_FOUND", "Item not found in this canteen.", 404);
      insist(
        JSON.stringify([
          item.name,
          item.price,
          item.note,
          item.paused,
          item.default_quantity,
        ]) === input.expectedSettings,
        "ITEM_CHANGED",
        "The item changed while you were editing. Close the editor and reopen it to review the latest details.",
      );
      await tx.execute(
        sql`update mint.items set name=${input.name},price=${input.price},note=${input.note},paused=${input.paused},default_quantity=${input.defaultQuantity} where id=${input.itemId} and canteen_id=${canteen}`,
      );
    } else if (action === "pause") {
      if (input.itemId)
        await tx.execute(
          sql`update mint.items set paused=${input.paused} where id=${input.itemId} and canteen_id=${canteen}`,
        );
      else if (input.stationId)
        await tx.execute(
          sql`update mint.stations set paused=${input.paused} where id=${input.stationId} and canteen_id=${canteen}`,
        );
      else
        await tx.execute(
          sql`update mint.canteens set paused=${input.paused} where id=${canteen}`,
        );
    } else if (action === "batch") {
      const item = await one(
        tx,
        sql`select * from mint.items where id=${input.itemId} and canteen_id=${canteen}`,
      );
      insist(item, "NOT_FOUND", "Item not found.");
      const batch = await one(
        tx,
        sql`insert into mint.batches(item_id,total,reusable) values(${input.itemId},${input.quantity},${input.reusable ?? true}) returning id`,
      );
      await tx.execute(
        sql`insert into mint.stock_events(batch_id,quantity,kind,source,actor_id) values(${batch!.id},${input.quantity},'batch_add',${"batch:" + batch!.id},${a.id})`,
      );
    } else if (action === "waste") {
      const b = await one(
        tx,
        sql`select b.* from mint.batches b join mint.items i on i.id=b.item_id where b.id=${input.batchId} and i.canteen_id=${canteen} for update of b`,
      );
      insist(
        b &&
          Number(b.total) -
            Number(b.held) -
            Number(b.committed) -
            Number(b.waste) >=
            Number(input.quantity),
        "STOCK_UNAVAILABLE",
        "Only uncommitted stock can be withdrawn.",
      );
      await tx.execute(
        sql`update mint.batches set waste=waste+${input.quantity} where id=${input.batchId}`,
      );
    } else if (action === "item") {
      const station = await one(
        tx,
        sql`select id from mint.stations where id=${input.stationId} and canteen_id=${canteen}`,
      );
      insist(station, "WRONG_STATION", "Choose a station in this canteen.");
      const old = await one(
        tx,
        sql`select * from mint.items where id=${input.itemId}`,
      );
      insist(
        !old || old.canteen_id === canteen,
        "FORBIDDEN",
        "Item belongs to another canteen.",
        403,
      );
      insist(
        !old || old.mode === input.mode,
        "INVALID_PREPARATION",
        "Create a new item for a different readiness mode. Existing batches do not change.",
      );
      await tx.execute(
        sql`insert into mint.items(id,canteen_id,station_id,name,price,mode,note) values(${input.itemId},${canteen},${input.stationId},${input.name},${input.price},${input.mode},${input.note}) on conflict(id) do update set station_id=excluded.station_id,name=excluded.name,price=excluded.price,note=excluded.note`,
      );
    } else if (action === "price") {
      await tx.execute(
        sql`update mint.items set price=${input.price} where id=${input.itemId} and canteen_id=${canteen}`,
      );
    } else if (action === "geofence") {
      await tx.execute(
        sql`update mint.canteens set lat=${String(input.latitude)},lng=${String(input.longitude)},radius=${input.radius},max_accuracy=${input.maxAccuracy},demo=${input.demo} where id=${canteen}`,
      );
    } else if (action === "extend") {
      await tx.execute(
        sql`update mint.orders set deadline=deadline+${input.minutes}*interval '1 minute',target_at=target_at+${input.minutes}*interval '1 minute' where canteen_id=${canteen} and state='confirmed' and exists(select 1 from mint.units u where u.order_id=mint.orders.id and u.state in ('pending','preparing','ready'))`,
      );
    } else if (action === "collection-review") {
      const u = await one(
        tx,
        sql`select u.*,o.payer_id from mint.units u join mint.orders o on o.id=u.order_id where u.id=${input.unitId} and o.canteen_id=${canteen} and o.state='confirmed' for update of u`,
      );
      insist(
        u &&
          u.arrived_at &&
          ["pending", "preparing", "ready"].includes(String(u.state)),
        "INVALID_STATE",
        "Only arrived outstanding portions may be reviewed.",
      );
      await tx.execute(
        sql`update mint.units set collection_deadline=clock_timestamp()+${input.minutes}*interval '1 minute' where id=${input.unitId}`,
      );
    } else if (action === "unavailable" || action === "prepared-resolution") {
      const u = await one(
        tx,
        sql`select u.*,o.payer_id from mint.units u join mint.orders o on o.id=u.order_id where u.id=${input.unitId} and o.canteen_id=${canteen} and o.state='confirmed' for update of u`,
      );
      insist(
        u &&
          (action === "prepared-resolution"
            ? ["preparing", "ready"].includes(String(u.state))
            : u.state === "pending"),
        "CANNOT_CANCEL",
        "A manager must review prepared items before MINT can add credit.",
      );
      await cancelUnit(
        tx,
        u!,
        String(u!.payer_id),
        canteen,
        "cancelled",
        a,
        String(input.reason) +
          (action === "prepared-resolution"
            ? " — manager-approved demo credit, prepared food withdrawn"
            : ""),
        true,
      );
    } else if (action === "scope") {
      const user = await one(
        tx,
        sql`select id from mint.profiles where email=${input.email} and kind='staff'`,
      );
      insist(
        user,
        "NOT_FOUND",
        "Provision this staff identity with the administrator seed tooling first.",
      );
      if (input.stationId) {
        insist(
          await one(
            tx,
            sql`select id from mint.stations where id=${input.stationId} and canteen_id=${canteen}`,
          ),
          "WRONG_STATION",
          "Station belongs to another canteen.",
        );
      }
      await tx.execute(
        sql`delete from mint.roles where user_id=${user!.id} and canteen_id=${canteen}`,
      );
      if (input.role !== "none")
        await tx.execute(
          sql`insert into mint.roles(user_id,canteen_id,station_id,role) values(${user!.id},${canteen},${input.role === "serving" ? input.stationId : null},${input.role})`,
        );
    } else insist(false, "INVALID_ACTION", "Unknown manager action.", 400);
    await audit(tx, a, "manager_" + action, canteen, source, {
      ...input,
      requestHash,
    });
  });
}
