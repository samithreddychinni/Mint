import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { AppError, insist } from "./errors";
export function signature(value: string, sig: string, key: string) {
  const actual = createHmac("sha256", key).update(value).digest("hex");
  return (
    /^[a-f0-9]{64}$/i.test(sig) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(sig, "hex"))
  );
}
export type ProviderPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
};
export async function provider<T>(
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const e = env();
  const response = await fetch("https://api.razorpay.com/v1/" + path, {
    method,
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(e.RAZORPAY_KEY_ID + ":" + e.RAZORPAY_KEY_SECRET).toString(
          "base64",
        ),
      "Content-Type": "application/json",
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Payment provider could not complete this request. Your order remains visible for reconciliation.",
      502,
    );
  return (await response.json()) as T;
}
export async function captured(id: string) {
  insist(
    /^pay_[a-zA-Z0-9]+$/.test(id),
    "INVALID_PAYMENT",
    "Invalid payment reference.",
    400,
  );
  return provider<ProviderPayment>("payments/" + id);
}
