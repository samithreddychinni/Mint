import { move } from "../src/modules/credits";
import { sql } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
const connection = postgres(
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
const db = drizzle(connection);
const uuid = (name: string) => {
  const h = createHash("sha256")
    .update("mint-demo-v1:" + name)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const credentialFile = ".local/demo-accounts.json";
const credentials: Record<
  string,
  { id: string; password: string; kind: string }
> = existsSync(credentialFile)
  ? JSON.parse(readFileSync(credentialFile, "utf8"))
  : {};
const create = async (email: string, kind: string, name: string) => {
  await db.execute(
    sql`insert into mint.allowed_identities(email,kind) values(${email},${kind}) on conflict do nothing`,
  );
  if (!credentials[email]) {
    const password = randomBytes(24).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error)
      throw new Error("Demo identity provisioning failed: " + error.code);
    credentials[email] = { id: data.user.id, password, kind };
    writeFileSync(credentialFile, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
  }
  const id = credentials[email].id;
  await db.execute(
    sql`insert into mint.profiles(id,email,name,kind) values(${id},${email},${name},${kind}) on conflict(id) do nothing`,
  );
  return id;
};
try {
  const browserPayer = await create(
    "browser-payer@demo.mint.invalid",
    "student",
    "Demo Browser Payer",
  );
  await create(
    "browser-friend@demo.mint.invalid",
    "student",
    "Demo Browser Friend",
  );
  const payer = await create(
    "payer@demo.mint.invalid",
    "student",
    "Demo Payer",
  );
  await create("friend@demo.mint.invalid", "student", "Demo Friend");
  await create("second@demo.mint.invalid", "student", "Demo Second Student");
  for (const [n, name] of ["Main", "IT", "MBA"].entries()) {
    const canteen = uuid(name);
    await db.execute(
      sql`insert into mint.canteens(id,name,lat,lng,radius,max_accuracy) values(${canteen},${name},${String(0.01 + n * 0.01)},'0.01',${[65, 55, 75][n]},25) on conflict(id) do nothing`,
    );
    for (const station of ["Main course", "Drinks", "Tiffin"])
      await db.execute(
        sql`insert into mint.stations(id,canteen_id,name) values(${uuid(name + station)},${canteen},${station}) on conflict(id) do nothing`,
      );
    for (const [item, station, price, mode, qty] of [
      ["Biryani", "Main course", 12000, "ready", 30],
      ["Fresh juice", "Drinks", 4000, "ready", 40],
      ["Dosa", "Tiffin", 6000, "made", 20],
      ["Last portion", "Main course", 9000, "ready", 1],
    ] as const) {
      const itemId = uuid(name + item);
      await db.execute(
        sql`insert into mint.items(id,canteen_id,station_id,name,price,mode,note) values(${itemId},${canteen},${uuid(name + station)},${item},${price},${mode},${mode === "made" ? "Preparation starts after accepted check-in." : "Demo batch — physically reserved until handover."}) on conflict(id) do nothing`,
      );
      await db.execute(
        sql`insert into mint.batches(id,item_id,total) values(${uuid(name + item + "batch")},${itemId},${qty}) on conflict(id) do nothing`,
      );
    }
    const manager = await create(
      `${name.toLowerCase()}.manager@staff.demo.invalid`,
      "staff",
      `${name} Manager`,
    );
    const cashier = await create(
      `${name.toLowerCase()}.cashier@staff.demo.invalid`,
      "staff",
      `${name} Cashier`,
    );
    for (const [user, role] of [
      [manager, "manager"],
      [cashier, "cashier"],
    ])
      await db.execute(
        sql`insert into mint.roles(id,user_id,canteen_id,role) values(${uuid(name + role)},${user},${canteen},${role}) on conflict(id) do nothing`,
      );
    for (const [i, station] of ["Main course", "Drinks", "Tiffin"].entries()) {
      const user = await create(
        `${name.toLowerCase()}.station${i + 1}@staff.demo.invalid`,
        "staff",
        `${name} ${station} Staff`,
      );
      await db.execute(
        sql`insert into mint.roles(id,user_id,canteen_id,station_id,role) values(${uuid(name + station + "staff")},${user},${canteen},${uuid(name + station)},'serving') on conflict(id) do nothing`,
      );
    }
    await db.transaction((tx) =>
      move(
        tx,
        null,
        payer,
        canteen,
        20000,
        0,
        "demo-seed-credit:" + canteen,
        "Labelled demonstration credit; not real money",
        null,
      ),
    );
  }
  await db.transaction((tx) =>
    move(
      tx,
      null,
      browserPayer,
      uuid("Main"),
      100000,
      0,
      "demo-browser-credit-v1",
      "Labelled automated browser demonstration credit; not real money",
      null,
    ),
  );
  console.log(
    "Seed verified: three demo canteens, scoped Auth identities, labelled credit. Passwords only in ignored .local/demo-accounts.json.",
  );
} finally {
  await connection.end();
}
