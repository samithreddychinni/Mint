export type FulfillmentState = {
  state: string;
  arrived?: boolean;
  arrived_at?: string | null;
};
export function fulfillmentSummary(
  paymentState: string,
  units: FulfillmentState[] = [],
) {
  if (paymentState !== "confirmed")
    return paymentState === "pending"
      ? "Payment pending"
      : paymentState === "exception"
        ? "Payment review"
        : paymentState === "expired"
          ? "Expired"
          : "Not confirmed";
  if (!units.length) return "Confirmed";
  if (units.every((unit) => unit.state === "collected")) return "Completed";
  if (units.every((unit) => unit.state === "cancelled")) return "Canceled";
  if (units.every((unit) => ["collected", "cancelled"].includes(unit.state)))
    return "Closed · partial cancellation";
  if (units.some((unit) => unit.state === "collected"))
    return "Partially collected";
  if (units.some((unit) => unit.state === "preparing")) return "Preparing";
  if (units.some((unit) => unit.state === "ready")) return "Ready for pickup";
  return units.some((unit) => unit.arrived || unit.arrived_at)
    ? "Checked in"
    : "Awaiting arrival";
}
export function isClosed(units: FulfillmentState[] = []) {
  return (
    units.length > 0 &&
    units.every((unit) => ["collected", "cancelled"].includes(unit.state))
  );
}
