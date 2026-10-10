import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";

const menu = z
  .array(
    z.object({
      canteen: z.enum(["Main", "IT", "MBA"]),
      category: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(120),
      price: z.number().int().positive(),
      station: z.enum(["Main course", "Drinks", "Tiffin"]),
      mode: z.enum(["ready", "made"]),
      quantity: z.number().int().min(0).max(10000),
      estimatedPrice: z.boolean(),
    }),
  )
  .min(1)
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../data/campus-menu.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const keys = menu.map((item) => `${item.canteen}:${item.name.toLowerCase()}`);
if (new Set(keys).size !== keys.length)
  throw new Error("Duplicate menu item names within a canteen.");
for (const name of ["Main", "IT", "MBA"]) {
  if (!menu.some((item) => item.canteen === name))
    throw new Error(`Missing ${name} menu.`);
}
const id = (key: string) => {
  const hex = createHash("sha256")
    .update("mint-campus-menu-v1:" + key)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const summary = () =>
  ["Main", "IT", "MBA"].map((canteen) => ({
    canteen,
    items: menu.filter((item) => item.canteen === canteen).length,
    openingPortions: menu
      .filter((item) => item.canteen === canteen)
      .reduce((sum, item) => sum + item.quantity, 0),
  }));
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ mode: "preview", summary: summary() }));
} else {
  const c = postgres(
    process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!,
    {
      ssl: {
        ca: readFileSync(process.env.DATABASE_SSL_CA_FILE!, "utf8"),
        rejectUnauthorized: true,
      },
      prepare: false,
      max: 1,
    },
  );
  try {
    await c.begin(async (tx) => {
      const canteens =
        await tx`select id,name from mint.canteens where name in ('Main','IT','MBA') order by id`;
      if (canteens.length !== 3)
        throw new Error("Expected exactly Main, IT and MBA canteens.");
      // Use the same locks as checkout, expiry and manager stock writes.
      for (const canteen of canteens)
        await tx`select pg_advisory_xact_lock(hashtextextended(${canteen.id},0))`;
      const stations =
        await tx`select id,canteen_id,name from mint.stations where canteen_id in(select id from mint.canteens where name in('Main','IT','MBA'))`;
      const records = menu.map((item) => {
        const canteen = canteens.find((row) => row.name === item.canteen)!;
        const station = stations.find(
          (row) => row.canteen_id === canteen.id && row.name === item.station,
        );
        if (!station)
          throw new Error(
            `Missing assigned counter: ${item.canteen}/${item.station}`,
          );
        const itemId = id(`${item.canteen}:${item.name.toLowerCase()}`);
        return {
          ...item,
          id: itemId,
          canteen_id: canteen.id,
          station_id: station.id,
          batch_id: id(itemId + ":opening-stock"),
          note: item.mode === "made" ? "Prepared fresh after arrival." : "",
        };
      });
      const payload = tx.json(records);
      await tx`update mint.items set archived=true,paused=true where canteen_id in(select id from mint.canteens where name in('Main','IT','MBA')) and id not in(select id from jsonb_to_recordset(${payload}::jsonb) as r(id uuid))`;
      await tx`insert into mint.items(id,canteen_id,station_id,name,price,mode,note,category,default_quantity,paused,archived)
        select id,canteen_id,station_id,name,price,mode,note,category,quantity,false,false
        from jsonb_to_recordset(${payload}::jsonb) as r(id uuid,canteen_id uuid,station_id uuid,name text,price integer,mode text,note text,category text,quantity integer)
        on conflict(id) do update set name=excluded.name,price=excluded.price,category=excluded.category,default_quantity=excluded.default_quantity,paused=false,archived=false`;
      // Stable batch IDs make retries safe: they never top up consumed stock.
      await tx`with inserted as (
        insert into mint.batches(id,item_id,total)
        select batch_id,id,quantity from jsonb_to_recordset(${payload}::jsonb) as r(batch_id uuid,id uuid,quantity integer)
        on conflict(id) do nothing returning id,total
      ) insert into mint.stock_events(batch_id,quantity,kind,source)
        select id,total,'batch_add','campus-menu-opening:'||id from inserted`;
      await tx`insert into mint.audit_events(action,entity,source,data)
        values('replace_campus_menu','Main,IT,MBA',${"campus-menu:" + createHash("sha256").update(JSON.stringify(menu)).digest("hex")},${tx.json({ summary: summary(), retainedPaidPortions: true })})
        on conflict(source) do nothing`;
      const count =
        await tx`select count(*)::int count from mint.items where not archived and canteen_id in(select id from mint.canteens where name in('Main','IT','MBA'))`;
      if (count[0].count !== menu.length)
        throw new Error("Menu count verification failed; rolling back.");
    });
    console.log(
      JSON.stringify({
        mode: "applied",
        summary: summary(),
        oldItems: "archived; historical portions and reservations retained",
      }),
    );
  } finally {
    await c.end();
  }
}
