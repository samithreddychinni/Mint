import { createHmac, timingSafeEqual } from "node:crypto";
export function workerAuthorized(
  headers: Headers,
  secret: string | undefined,
  now = Date.now(),
) {
  const time = headers.get("x-mint-worker-time") || "";
  const signature = headers.get("x-mint-worker-signature") || "";
  if (!secret || !/^\d{10}$/.test(time) || !/^[a-f0-9]{64}$/.test(signature))
    return false;
  const age = now - Number(time) * 1000;
  if (age < -5000 || age > 60000) return false;
  const expected = createHmac("sha256", secret).update(time).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
