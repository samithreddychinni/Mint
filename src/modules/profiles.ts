import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { one, type Actor } from "./core";
import { insist } from "../lib/errors";

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[^\p{Cc}]+$/u),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((value) => value.replace(/[\s()\-]/g, ""))
    .refine(
      (value) => /^(?:\+91)?[6-9]\d{9}$/.test(value),
      "Enter a valid Indian mobile number.",
    )
    .transform((value) => (value.startsWith("+91") ? value : "+91" + value)),
});

export async function updateProfile(a: Actor, input: unknown) {
  const profile = profileSchema.parse(input);
  const result = await one(
    db,
    sql`update mint.profiles set name=${profile.name},phone=${profile.phone},completed_at=coalesce(completed_at,clock_timestamp()) where id=${a.id} returning name,phone,completed_at`,
  );
  insist(
    result,
    "NOT_FOUND",
    "Your account could not be found. Sign in again.",
    404,
  );
  return result;
}
