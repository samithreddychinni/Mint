export const CREDIT_POLICY = "credit-30d-missed-10-v2-25+5";
export function missedPickupCredit(price: number) {
  const fine = Math.round(price / 10);
  return { credit: price - fine, fine };
}
