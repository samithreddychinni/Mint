import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { one, type Actor } from "../modules/core";
import { insist } from "./errors";
export async function authClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return jar.getAll();
        },
        setAll(values) {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure:
                new URL(process.env.APP_URL || "http://localhost:3000")
                  .protocol === "https:",
            }),
          );
        },
      },
    },
  );
}
export async function actor(): Promise<Actor> {
  const client = await authClient();
  const { data, error } = await client.auth.getUser();
  insist(
    !error && data.user?.email_confirmed_at,
    "UNAUTHENTICATED",
    "Sign in with a verified account.",
    401,
  );
  const user = data.user!;
  const email = user.email!.toLowerCase();
  const allow = await one(
    db,
    sql`select kind from mint.allowed_identities where email=${email}`,
  );
  const kind = allow
    ? String(allow.kind)
    : email.endsWith("@cb.students.amrita.edu")
      ? "student"
      : "ineligible";
  insist(
    kind !== "ineligible",
    "FORBIDDEN",
    "This identity is not eligible for MINT.",
    403,
  );
  await db.execute(
    sql`insert into mint.profiles(id,email,name,kind) values(${user.id},${email},${email.split("@")[0]},${kind}) on conflict(id) do update set email=excluded.email,kind=excluded.kind where mint.profiles.email is distinct from excluded.email or mint.profiles.kind is distinct from excluded.kind`,
  );
  return { id: user.id, email, kind };
}
