# Student order limits

Status: implementation approved and completed on 11 October 2026. Release verification is recorded in `docs/DEPLOYMENT.md`. These rules apply to pickup ordering. Campus delivery remains future scope.

## Allowances

All limits apply to the payer across Main, IT and MBA, including portions assigned to friends. A portion is one menu selling unit, not its weight or the number of people it feeds.

| Private allowance      | Active orders | Portions per order | Outstanding portions | Main meals | Drinks | Default same item |
| ---------------------- | ------------: | -----------------: | -------------------: | ---------: | -----: | ----------------: |
| Standard               |             2 |                  6 |                   10 |          2 |      4 |                 2 |
| Reliable               |             2 |                  8 |                   14 |          3 |      6 |                 3 |
| Established            |             3 |                 10 |                   18 |          4 |      8 |                 4 |
| Temporarily restricted |             1 |                  4 |                    4 |          1 |      2 |                 1 |

Main-meal, drink and same-item limits count outstanding portions plus portions collected in the previous 30 minutes. Collecting and immediately ordering again does not reset these limits. A portion counts once. Cancelled and expired portions release capacity. Stock availability and preparation permissions always apply.

The main-meal group includes biryanis, rice meals, dosa/roast/tiffin meals, burgers and tandoori chicken. Boiled eggs, egg roast sides, curries, snacks and ice creams use `other`. Single-piece chapathi, parotta, batura, naan and roti use `bread`. Drinks use `drink`; curd and yogurt use `other`. Exact classifications are in `data/campus-menu.json`. Groups are stable metadata, independent of editable names and categories, and are copied to order portions at reservation.

Bread allows up to six pieces inside the total order limit. Tandoori chicken has a one-per-item exception; full, half and quarter still share the main-meal limit. Managers can set a per-item cap from zero (automatic) to six from the pencil editor. This never raises meal, drink, outstanding or order limits. Restricted students have a one-per-item ceiling. When ten or fewer physical portions remain, every tier has a one-per-item ceiling, including outstanding and recent pickups. Existing accepted reservations remain valid.

## Active orders and atomic enforcement

An unexpired unpaid checkout hold counts immediately. Holds expire after three minutes. Confirmed orders count while a portion is pending, preparing or ready. Pending, unarrived portions past their final deadline do not retain quota while awaiting worker cleanup. Arrived and preparation portions retain their capacity until a final state. All-terminal orders and financial reconciliation alone do not occupy a food slot.

The backend takes a student transaction lock before the canteen lock. It checks campus-wide usage, current stock, prices and limits in the transaction that reserves portions and credit. Concurrent checkout at different canteens cannot allocate another student slot. Failed checks roll back every reservation and do not create a provider payment. A retry with the original request key returns its original order before quota checks. A changed cart requires a new key. Tier changes do not cancel paid orders or invalidate pickup passes. Payment confirmation uses the same student-before-canteen lock. A late capture after hold expiry must recheck all quantity and rolling quotas before restoring stock commitments. A failed re-reservation uses the existing idempotent external-payment resolution/refund path; it does not create a third active order. This is distinct from cancellation of an already confirmed food portion, which still issues same-canteen credit.

## Private pickup reliability

New students start at standard limits. Reliable requires five successful pickup days in the preceding 90 days; established requires 20. Both require at least 90% successful qualifying days. Count one positive day per student in campus time (Asia/Kolkata). A day with an attributable no-show does not also count as a successful day, even if another order was collected. Spending more or splitting orders on the same day adds no benefit. There is no public numerical score or leaderboard.

Success requires all relevant portions to be collected. For a payer, all portions in the order must be collected. For an accepted recipient, all their assigned portions must be collected. Only authenticated serving handover sets collection; payment or location check-in alone does not qualify. Identities ending in `.invalid` remain standard and earn no reputation. Gateway test mode itself is not a separate production-history filter; current demo identities are excluded by their identity.

Three attributable missed orders in seven days apply the restricted allowance. Only server expiry with the exact final-arrival-deadline reason, no arrival, and processing within 90 seconds of the deadline qualifies. Multiple portions in one order count as one miss. Late worker processing, manager cancellations, preparation delays, early cancellations and payment failures do not count. An accepted friend's no-show belongs to the friend, while the payer retains purchase usage. Two successful days after the latest miss remove the temporary restriction; ageing beyond the seven-day window also removes it. Promotion then follows the normal 90-day rate.

An assigned manager can review a student's recent penalties from Stock using university email and a reason. The student must have payer or recipient history in that manager's canteen. Serving accounts cannot review limits. A recorded review clears earlier no-show and checkout-cycle penalties campus-wide. It preserves positive history and never removes hard quantity limits. Reviews are audited and idempotent.

## Checkout pause

Three new unstarted expired holds or fully student-cancelled orders within 30 minutes cause a pause until five minutes after the latest cycle ends. Idempotent retries are not new cycles. Expired holds with a provider order or reconciliation attempt are excluded because a payment-provider failure cannot be safely distinguished from abandonment. Paid pickups, browsing and check-in remain accessible during the pause.

## Interface

Menu, cart and Account show remaining order slots, total portions per order and main-meal capacity. Relevant Add controls stop at the limit; removal stays available. Messages explain scarcity, recent-pickup limits or checkout pauses. At an active-order limit, Open Orders provides the next action. Account explains larger allowances and manager review. The fixed app frame and inner-list scrolling remain unchanged.

The server owns the policy in `src/lib/order-limits.ts`; `src/modules/order-limits.ts` computes private history and usage. The browser only provides guidance and refreshes limits after a rejected checkout. Migration `0007_clumsy_killer_shrike` adds item group/cap metadata, portion group snapshots and an audit lookup index. It does not reset stock, prices, paid snapshots or balances.

## Verification and limits

Automated checks cover cross-canteen races, retries, timed-out holds, meal variants, recent pickups, bread and scarcity, late-capture re-reservation, promotion, recipient attribution, restricted allowances, scoped review, checkout pause and payment uncertainty. Existing stock, payment, cancellation and friend-collection workflows are regression checks. Browser checks cover disabled Add controls, removal, opening existing orders, manager edits and fixed frames.

These are application safeguards, not campus-wide purchase policy or a guarantee against coordinated purchases by several verified students. No IP or shared-device bans are used. Group-order overrides were not added. Tune the fixed policy after observing real use; do not add an unlimited exemption. Physical Android interaction and large-user load need separate verification. Delivery remains deferred.
