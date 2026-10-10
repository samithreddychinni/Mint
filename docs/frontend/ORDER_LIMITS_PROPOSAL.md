# Student order limits proposal

Status: proposed policy for discussion. No live limits or trust scores have changed. This proposal applies to existing pickup ordering. Campus delivery remains deferred.

## Current gap

Checkout permits 20 portions per item, 20 distinct items and 100 total portions. It accepts up to 30 checkout requests per minute per student. There is no active-order quota. Separate requests, different biryani variants, or different canteens can bypass the intent of an individual-order quantity limit.

## Recommended starting limits

| Student level  | Active orders, campus-wide | Total portions per order | Main-meal portions across active orders and the last 30 minutes |
| -------------- | -------------------------- | ------------------------ | --------------------------------------------------------------- |
| New / standard | 2                          | 6                        | 2                                                               |
| Reliable       | 2                          | 8                        | 3                                                               |
| Established    | 3                          | 10                       | 4                                                               |

These values need product review before implementation. They are not campus policy or measured capacity requirements.

Use a default same-item cap of two per order, rising to three for reliable students and four for established students. Product exceptions are necessary: single-piece chapathi/parotta can allow six pieces within the total order cap, while low-stock specials should remain capped at one. Keep exceptions manager-configurable within hard safety bounds. Never let a trust tier remove all limits.

Main meals need a stable server-side product group. All biryani variants share a quota; rice meals and comparable full meals should also consume this allowance. Bread pieces, curry sides, eggs and drinks need their own appropriate groups. Do not infer enforcement from editable display names or category text. Exact product grouping and serving-unit treatment must be reviewed, especially full/half/quarter chicken and packaged multipacks.

The rolling quota counts outstanding reserved meal portions regardless of their age, plus portions collected during the preceding 30 minutes. A portion counts once, not once in each set. Collected portions remain in the rolling count so collecting quickly and immediately reordering does not reset the allowance. Genuine cancellations release their quota; repeated reserve/cancel behaviour is handled separately.

## What counts as active

- An unexpired unpaid checkout hold counts immediately, before payment starts. The current hold expires after three minutes.
- A confirmed order counts while at least one portion remains pending, preparing or ready, including portions assigned to friends.
- All-terminal orders do not count. Terminal portions are collected, cancelled or expired. Financial reconciliation alone must not keep a food slot occupied when no food is reserved.
- Expired holds must not occupy a slot just because the worker has not cleaned them yet. Use server time and actual reservation state.
- Quotas apply to the payer across Main, IT and MBA. Sharing pickup rights does not move the purchase quota or permit another reservation.
- Do not cancel or invalidate an existing paid order when a student's tier drops. Apply stricter rules to subsequent checkout only.

Add an aggregate outstanding-portion cap too: proposed 10 / 14 / 18 across active orders for standard / reliable / established students. Two orders must not double every per-order allowance without a campus-wide bound.

## Reliability rather than a public trust ranking

Start every verified student at standard limits. No purchase history is neutral, not suspicious.

Proposed promotion: reliable after five completed orders across at least five distinct days; established after 20 completed orders across at least 15 distinct days. Use recent history, such as a rolling 90-day window, and require a high successful pickup rate once enough eligible orders exist. Count no more than one positive outcome per student per day. Exact success-rate thresholds and demotion windows remain to be chosen; the day and order counts above are recommendations.

Only authenticated counter handover is successful collection evidence. Phone check-in and payment alone are not success. More items, more spending and more separate orders on one day do not produce more reputation. Exclude fixtures, demo identities and test-only outcomes.

A verified no-show can lower future allowances. Three attributable no-shows in seven days could temporarily reduce the student to one active order and one main meal, with recovery after successful pickups. This is a proposed threshold; do not deploy it without defining eligibility, notice and recovery.

Do not penalize payment-provider failures, service outages, manager stock cancellations, kitchen delays or an early legitimate cancellation. If an accepted friend misses collection, attribute the collection failure to that friend rather than automatically blaming the payer. The payer still carries the outstanding purchase quota. Partial and mixed-recipient outcomes require portion-level attribution without counting each portion as a separate reputation event.

Show private, understandable benefits: “You can have 2 active orders” and “Reliable pickups unlock larger orders.” Explain a restriction and provide a manager review path. Avoid a public numerical score, leaderboards and labels such as “untrustworthy.” Phone numbers entered in a profile are not verified identities.

## Additional abuse controls

- Cap repeated abandoned checkout holds and rapid create/cancel cycles with a short, explained cooldown. Count new holds separately from HTTP requests; retries for an existing checkout must not look like new abuse.
- Limit popular items by product group across orders. A cap on only Chicken Biriyani K.L does not stop purchases of every other biryani.
- Keep scarcity rules even for established students. For example, when a product has ten or fewer portions left, limit new reservations to one portion per student within the rolling window. Do not shrink an already accepted paid reservation.
- Give managers a bounded temporary override for a legitimate group order, with reason, expiry and an audit trail. A permanent unlimited exemption defeats the safeguard. Decide whether group-order support is necessary before implementing it.
- University email verification limits account creation but cannot prevent several students from coordinating purchases. Do not promise complete prevention. Do not block people merely because they share campus Wi-Fi, a hostel or a device.
- Trust must never bypass stock availability, payment verification, QR authorization or same-canteen credit accounting.

## Implementation and UI requirements

1. Agree on tier thresholds, product groups, per-product exceptions, scarcity, cooldown and group-order policy.
2. Return the signed-in student's current limits and usage from the existing account API. Keep policy values in one server-owned configuration. The UI may guide ordering; the server must enforce it.
3. Take a student-level transaction lock before the normal canteen lock, using the same lock order for every checkout. Check campus-wide active orders and quotas before reserving stock. The existing canteen-only lock does not protect simultaneous purchases by one student at two canteens.
4. Preserve checkout idempotency. A retry of an already-created order returns that order without consuming a new slot or failing because the student has since reached the limit. A changed cart must use a new request key.
5. Reserve inventory and consume capacity in the same transaction. Recheck current prices, quantities, active holds and product groups. Do not start payment for a cart that failed its quota check.
6. Record/recompute reliability from unique server-side outcomes. Avoid creating a new write transaction on every catalogue poll. Keep corrections auditable and scores private. Audit every outcome source so cancellation reasons cannot be forged by a student.
7. Show remaining capacity beside the cart, disable only the relevant Add control at its limit, and explain why. At an active-order cap, link to current orders or let the student resume their existing unpaid checkout. Do not block browsing or hide paid pickup passes.
8. Keep the fixed app frame, category filters and accessible action states. A generic “invalid cart” error is insufficient; return the limit, current usage and next available action.

## Required verification

- Simultaneous checkouts in the same and different canteens cannot exceed a student quota or oversell stock.
- Pending unpaid holds count; timed-out holds release capacity; failed or duplicate callbacks do not allocate it again.
- Splitting one purchase into orders, switching biryani variants, collecting and immediately reordering, and sharing portions do not bypass quotas.
- A checkout retry consumes one order slot and one reservation. A quota failure creates no provider payment.
- Completed, cancelled and expired portions update capacity once. Partial collection and transferred portions remain correctly attributed.
- Staff-caused cancellation, failed payment and kitchen delay do not produce a no-show penalty.
- Promotions cannot be farmed with tiny repeated orders, repeated friend pairs, test accounts or client-edited values.
- Tier changes leave existing paid orders intact. Manager overrides are scoped, bounded, time-limited and audited.
- Bread-piece exceptions, scarce items and full/half/quarter servings follow the agreed rules.
- Students can see why ordering is limited and can still open orders, check in and collect their already-paid food.
