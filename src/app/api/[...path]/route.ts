import { NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { handle, body } from "@/lib/http";
import { actor, authClient } from "@/lib/auth";
import { insist } from "@/lib/errors";
import { one, rate, hash, student } from "@/modules/core";
import { managerSummary } from "@/modules/manager-summary";
import { updateProfile } from "@/modules/profiles";
import {
  catalogue,
  dashboard,
  orderView,
  managerView,
} from "@/modules/catalogue";
import { hold, creditOnly, cancel } from "@/modules/orders";
import { createPayment, verifyPayment, webhook } from "@/modules/payments";
import {
  checkIn,
  passes,
  invite,
  invitationAction,
  returnRights,
} from "@/modules/pickup";
import {
  resolvePass,
  handover,
  preparation,
  worklist,
  cashierSale,
  manage,
} from "@/modules/operations";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
// Temporary demo allowance; the normal OTP limits resume automatically at this time.
const demoOtpLimitsUntil = Date.parse("2026-10-11T13:00:00.000Z");
const uuid = z.uuid();
const key = z.string().min(8).max(100);
const ids = z
  .array(uuid)
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length);
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const managerSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("limits-review"),
    email,
    reason: z.string().trim().min(3).max(300),
  }),
  z.object({
    action: z.literal("item-settings"),
    itemId: uuid,
    name: z.string().trim().min(1).max(100),
    price: z.number().int().min(1).max(1000000),
    note: z.string().trim().max(300),
    paused: z.boolean(),
    defaultQuantity: z.number().int().min(0).max(10000),
    orderCap: z.number().int().min(0).max(6).optional(),
    expectedOrderCap: z.number().int().min(0).max(6).optional(),
    expectedSettings: z.string().max(1000),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("stock"),
    itemId: uuid,
    quantity: z.number().int().min(0).max(10000),
    expectedAvailable: z.number().int().nonnegative(),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("prepared-resolution"),
    unitId: uuid,
    reason: z.string().min(10).max(300),
  }),
  z.object({
    action: z.literal("item"),
    itemId: uuid,
    stationId: uuid,
    name: z.string().min(1).max(100),
    price: z.number().int().min(1).max(1000000),
    mode: z.enum(["ready", "made"]),
    note: z.string().max(300),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("pause"),
    paused: z.boolean(),
    itemId: uuid.optional(),
    stationId: uuid.optional(),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("batch"),
    itemId: uuid,
    quantity: z.number().int().min(1).max(10000),
    reusable: z.boolean(),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("waste"),
    batchId: uuid,
    quantity: z.number().int().min(1).max(10000),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("price"),
    itemId: uuid,
    price: z.number().int().min(1).max(1000000),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("geofence"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radius: z.number().int().min(10).max(500),
    maxAccuracy: z.number().int().min(1).max(100),
    demo: z.boolean(),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("extend"),
    minutes: z.number().int().min(1).max(120),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("collection-review"),
    unitId: uuid,
    minutes: z.number().int().min(1).max(120),
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("unavailable"),
    unitId: uuid,
    reason: z.string().min(3).max(300),
  }),
  z
    .object({
      action: z.literal("scope"),
      email,
      role: z.enum(["serving", "cashier", "manager", "none"]),
      stationId: uuid.optional(),
      reason: z.string().min(3).max(300),
    })
    .refine((v) => v.role !== "serving" || v.stationId),
]);
async function dispatch(request: NextRequest, segments: string[]) {
  const path = segments.join("/");
  if (request.method === "GET") {
    if (path === "health") {
      await db.execute(sql`select 1`);
      return {
        status: "ok",
        service: "mint-api",
        version: process.env.RENDER_GIT_COMMIT || "local",
      };
    }
    if (path === "catalogue") return catalogue();
    const a = await actor();
    if (path === "me") return dashboard(a);
    if (segments[0] === "orders" && segments.length === 2)
      return orderView(a, uuid.parse(segments[1]));
    if (path === "staff/worklist")
      return worklist(
        a,
        uuid.parse(request.nextUrl.searchParams.get("station")),
      );
    if (
      segments[0] === "manager" &&
      segments.length === 3 &&
      segments[2] === "summary"
    )
      return managerSummary(
        a,
        uuid.parse(segments[1]),
        z
          .enum(["today", "week"])
          .parse(request.nextUrl.searchParams.get("period") || "today"),
      );
    if (segments[0] === "manager" && segments.length === 2)
      return managerView(a, uuid.parse(segments[1]));
  } else {
    if (path === "payments/webhook") {
      const raw = await request.text();
      insist(
        raw.length < 262144,
        "PAYLOAD_TOO_LARGE",
        "Webhook too large.",
        413,
      );
      return webhook(
        raw,
        request.headers.get("x-razorpay-signature") || "",
        request.headers.get("x-razorpay-event-id") || hash(raw),
      );
    }
    const b = await body(request);
    if (path.startsWith("auth/")) {
      const client = await authClient();
      if (path === "auth/logout") {
        await client.auth.signOut();
        return { ok: true };
      }
      const auth = z
        .object({
          email,
          token: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
          password: z.string().min(8).max(100).optional(),
        })
        .parse(b);
      if (path === "auth/request") {
        insist(
          auth.email.endsWith("@cb.students.amrita.edu"),
          "EMAIL_DOMAIN",
          "Use your @cb.students.amrita.edu address.",
          400,
        );
        const demoOtpLimits = Date.now() < demoOtpLimitsUntil;
        const perMinuteLimit = demoOtpLimits ? 10 : 1;
        const hourlyLimit = demoOtpLimits ? 60 : 5;
        await rate(
          "otp-request:" + hash(auth.email),
          perMinuteLimit,
          60,
          (wait) =>
            `Please wait ${wait} seconds before requesting another sign-in code.`,
        );
        await rate(
          "otp-hour:" + hash(auth.email),
          hourlyLimit,
          3600,
          (wait) =>
            `You have reached the limit of ${hourlyLimit} sign-in codes per hour. Try again in about ${Math.ceil(wait / 60)} minutes.`,
        );
        const { error } = await client.auth.signInWithOtp({
          email: auth.email,
          options: { shouldCreateUser: true },
        });
        insist(
          !error,
          "AUTH_DELIVERY",
          "Unable to send a code. Wait and retry.",
          503,
        );
        return {
          message:
            "Check your inbox for a six-digit code. It expires in five minutes.",
        };
      }
      if (path === "auth/verify") {
        await rate("otp-verify:" + hash(auth.email), 5, 300);
        insist(auth.token, "OTP_REQUIRED", "Enter your six-digit code.", 400);
        const { error } = await client.auth.verifyOtp({
          email: auth.email,
          token: auth.token,
          type: "email",
        });
        insist(
          !error,
          "INVALID_OTP",
          "Code is invalid or expired. Request a new code.",
          400,
        );
        return { ok: true };
      }
      if (path === "auth/password") {
        await rate("password:" + hash(auth.email), 5, 300);
        const allowed = await one(
          db,
          sql`select 1 from mint.allowed_identities where email=${auth.email}`,
        );
        insist(
          allowed && auth.password,
          "FORBIDDEN",
          "Use an account assigned by the canteen administrator.",
          403,
        );
        const { error } = await client.auth.signInWithPassword({
          email: auth.email,
          password: auth.password!,
        });
        insist(
          !error ||
            (error.status !== undefined &&
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 429),
          "AUTH_UNAVAILABLE",
          "The sign-in service is unavailable. Try again later.",
          503,
        );
        insist(!error, "INVALID_LOGIN", "Email or password is incorrect.", 401);
        return { ok: true };
      }
    }
    const a = await actor();
    if (path === "profile") return updateProfile(a, b);
    if (path === "checkouts") {
      student(a);
      await rate("checkout:" + a.id, 30, 60);
      const c = z
        .object({
          canteenId: uuid,
          policy: z.string().max(100).optional(),
          lines: z
            .array(
              z.object({
                itemId: uuid,
                quantity: z.number().int().min(1).max(20),
                price: z.number().int().positive(),
              }),
            )
            .min(1)
            .max(20),
          credit: z.number().int().nonnegative(),
          key,
        })
        .parse(b);
      const o = await hold(a, c);
      if (o.external === 0) return creditOnly(a, String(o.id));
      return createPayment(a, String(o.id));
    }
    if (segments[0] === "orders") {
      const id = uuid.parse(segments[1]);
      const action = segments[2];
      if (action === "payment") {
        await rate("payment:" + a.id, 20, 60);
        const p = z
          .object({
            paymentId: z.string(),
            providerOrder: z.string(),
            signature: z.string(),
          })
          .parse(b);
        return verifyPayment(a, id, p.paymentId, p.providerOrder, p.signature);
      }
      if (action === "payment-setup") return createPayment(a, id);
      if (action === "check-in") {
        const s = z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            accuracy: z.number().positive().max(100000),
            timestamp: z.number().int().positive(),
          })
          .parse(b);
        await rate("check-in:" + a.id, 20, 60);
        return checkIn(a, id, s);
      }
      if (action === "passes") {
        await rate("passes:" + a.id, 30, 60);
        return passes(a, id);
      }
      if (action === "invite") {
        await rate("invite:" + a.id, 10, 60);
        const i = z.object({ ids, email }).parse(b);
        return invite(a, id, i.ids, i.email);
      }
      if (action === "cancel")
        return cancel(a, id, z.object({ ids }).parse(b).ids);
      if (action === "return")
        return returnRights(a, id, z.object({ ids }).parse(b).ids);
    }
    if (segments[0] === "invitations") {
      const i = z
        .object({ action: z.enum(["accept", "decline", "withdraw"]) })
        .parse(b);
      return invitationAction(a, uuid.parse(segments[1]), i.action);
    }
    if (path === "staff/resolve") {
      await rate("resolve:" + a.id, 30, 60);
      const p = z
        .object({
          stationId: uuid,
          token: z.string().max(500).default(""),
          reference: z.string().max(20).optional(),
          collector: email.optional(),
        })
        .parse(b);
      return resolvePass(a, p.token, p.stationId, p.reference, p.collector);
    }
    if (path === "staff/handover") {
      const h = z
        .object({
          stationId: uuid,
          portions: z
            .array(z.object({ id: uuid, version: z.number().int().positive() }))
            .min(1)
            .max(100)
            .refine((v) => new Set(v.map((p) => p.id)).size === v.length),
          key,
        })
        .parse(b);
      return handover(a, h.stationId, h.portions, h.key);
    }
    if (path === "staff/preparation") {
      const p = z
        .object({ id: uuid, action: z.enum(["start", "ready"]) })
        .parse(b);
      return preparation(a, p.id, p.action);
    }
    if (path === "cashier/sales") {
      const c = z
        .object({
          canteenId: uuid,
          lines: z
            .array(
              z.object({
                itemId: uuid,
                quantity: z.number().int().min(1).max(100),
              }),
            )
            .min(1)
            .max(20)
            .refine((v) => new Set(v.map((l) => l.itemId)).size === v.length),
          key,
        })
        .parse(b);
      return cashierSale(a, c.canteenId, c.lines, c.key);
    }
    if (segments[0] === "manager") {
      const input = managerSchema.and(z.object({ key })).parse(b);
      return manage(a, uuid.parse(segments[1]), input.action, input);
    }
  }
  insist(false, "NOT_FOUND", "Endpoint not found.", 404);
}
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return handle(request, async () =>
    dispatch(request, (await context.params).path),
  );
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const segments = (await context.params).path;
  return handle(
    request,
    () => dispatch(request, segments),
    segments.join("/") === "payments/webhook",
  );
}
