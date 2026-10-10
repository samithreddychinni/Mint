# Campus delivery proposal

Status: proposal for review. No delivery code, surcharge, public board, contact sharing, or delivery reward is enabled by this document.

## Recommendation

Add an optional student-to-student delivery mode. A verified student already at the selected canteen can collect one existing paid order and carry it to an agreed campus meeting point. Staff still scan pickup passes and hand over food. They do not manage deliveries or record walk-in sales.

Keep normal pickup as the default. Put a clear **Pickup / Bring it to me** choice above the student menu. Use a **Campus deliveries** tab for students who want to help. Show open requests with the canteen, destination, items, quantity, deadline, and reward. Never show a directory of people currently at the canteen.

## Decisions the user has made

- Delivery adds 10% of the food subtotal. The full delivery charge becomes the delivering student's same-canteen credit after the buyer confirms receipt.
- Credit is usable only at the canteen that supplied the order. It is not a cash withdrawal or bank payment.
- Destinations: Night canteen, Arjuna statue, Swimming pool, General store, AB1 parking, Butterfly park.
- The buyer's and delivery student's contact information becomes visible to each other only after a request is accepted.
- A verified friend can collect assigned portions without being the payer. Delivery must use the same pickup-rights mechanism.

The destination called Night canteen is a delivery meeting point. It does not add a fourth ordering canteen; ordering remains Main, IT, or MBA.

## Buyer flow

1. Choose **Bring it to me**, a canteen, and items. Delivery menu cards show the price including the surcharge, with a visible “includes 10% delivery” explanation. Switching modes preserves the items and recalculates prices.
2. Choose one of the six destinations. Enter a short exact meeting point, such as “AB1 parking, near the security cabin.” Enter or review the saved name and mobile number. Explain that the assigned delivery student will receive these details after acceptance.
3. Review the food subtotal, 10% delivery charge, same-canteen credit used, and total. Show the delivery charge separately even though menu prices include it. Never charge it twice.
4. Pay once through the existing checkout. Publish the request only after the server verifies payment. It must not appear on the board while payment is pending.
5. Follow the statuses **Finding a student → Accepted → Collecting food → On the way → Awaiting receipt confirmation → Delivered**. “On the way” requires every non-cancelled portion to be handed over by staff.
6. After receiving the food, press **Received my order**. The server credits the reward exactly once. The delivering student cannot confirm receipt for the buyer.

The buyer's location at an academic block is expected. The buyer does not need canteen check-in in delivery mode. The assigned delivery student must satisfy pickup arrival rules.

## Delivery student flow

1. Open **Campus deliveries**. Filter by canteen and destination. Cards show a fixed reward, item count, readiness, and remaining pickup time. Do not reveal the buyer's number, email, precise meeting point, or live location on the public board.
2. Before accepting, confirm current presence at that canteen through a fresh accepted phone location or a recent authenticated staff pass scan. Suggested presence validity: five minutes. This value is a recommendation, not an approved policy yet.
3. Press **Accept and collect**. The server atomically assigns the outstanding portions. If someone else accepted first, refresh the card and show a clear message. Prevent self-acceptance.
4. Acceptance reveals the buyer's name, mobile number, and exact meeting point, and creates passes for the existing portions and serving counters. It does not create another paid order, decrement stock again, or create another preparation task.
5. Present each counter's pass. Staff see the assigned delivery student's name. Ready items can be handed over immediately. Made-to-order items retain their existing preparation tokens.
6. Deliver at the agreed meeting point. Use the contact buttons if coordination is needed. A driver “I've delivered” action can notify the buyer, but it cannot release the reward.
7. When the buyer confirms receipt, show the reward in the same-canteen credit ledger, with a link to the order.

## Pricing and money

Use integer paise throughout. Recommended calculation: surcharge = round(food subtotal × 10 / 100), once per order; total = food subtotal + surcharge. Example: ₹120 food + ₹12 delivery = ₹132 paid; ₹12 is reserved for the delivering student's eventual reward. Per-item display rounding must not change the authoritative checkout total.

Keep food value and delivery value separate in the database and ledger. Cancellation of food must not accidentally credit the delivery charge twice. The surcharge is funded by the buyer, not by creating unfunded wallet credit.

Recommended edge rules to review before implementation:

- If no student accepts before the original pickup deadline, eligible food portions expire under the current rules and the full delivery charge returns as the buyer's same-canteen credit.
- Before acceptance, the buyer may withdraw delivery, receive the delivery charge as same-canteen credit, and collect the existing food themselves before its original deadline.
- If every portion is cancelled before collection, cancel delivery and return the full delivery charge as same-canteen credit.
- If only some portions are delivered, the reward should be 10% of the food value actually delivered. Return the unused part of the delivery charge to the buyer's same-canteen credit. This is a proposed exception to the normal full-reward rule and needs review.
- Do not automatically release a reward after a timer if the buyer has not confirmed receipt. Provide a manager dispute review with an audit record. Do not leave a disputed reward silently unresolved.
- Do not extend arrival deadlines just because a delivery request was accepted. Show the remaining time before acceptance.
- A student who cannot complete an accepted delivery needs a release or dispute path. Allow reassignment only before food collection, revoke old passes, and preserve preparation state. After food collection, route the problem to a manager rather than issuing another pickup pass for already handed-over food.

## Screens and visual direction

Keep the current Amrita burgundy `#A4123F`, warm background `#FAF8F7`, and paper cards `#FFFDFB`. Use the existing fixed app frame and bottom navigation. Only inner lists may scroll; actions remain reachable. Do not add a product landing page.

Open-request card: destination heading; canteen and pickup deadline underneath; compact item summary; reward badge on the right; one **Accept and collect** action. Filter chips use the six approved destination names. Accepted-request screen: large status, meeting point, **Call buyer**, counter passes, and item preparation/collection states. Buyer screen: assigned student's name, **Call student**, order progress, then **Received my order** when collection is complete.

Use clear words: **delivery student**, **buyer**, **pickup QR**, **delivery reward**. Avoid “escrow”, “collector ID”, raw pass text, provider IDs, and internal ledger fields in the student flow.

## Contact details and notifications

Ask for name and mobile number after university-email verification. Keep email OTP as the identity check. A manually entered phone number is not verified by an SMS OTP; do not label it verified. Let the user edit it later.

Store contact details privately. Return only the signed-in user's own profile until acceptance. After acceptance, return contacts only to the buyer and assigned delivery student. Staff need the assigned pickup name, not the buyer's phone. Do not put contact details in QR payloads, public lists, notification previews, analytics, or audit data.

In-app updates can use the existing polling. Suggested events: request accepted, item ready, all food collected, driver reports delivery, buyer confirms receipt, reward credited, or cancellation. Background push requires explicit browser permission, subscriptions, a server sender, retry handling, and device tests. It is a separate implementation step; an in-app updates panel is not background push.

## Implementation order after review

1. Settle the edge rules above, especially partial reward, disputes, release/reassignment, and presence lifetime.
2. Add private delivery records and presence records with RLS, scoped runtime grants, foreign-key indexes, unique order linkage, and money/state constraints. Snapshot destination and fee at checkout. Keep existing orders and preparation tasks.
3. Extend checkout totals, payment verification, late-payment recovery, cancellation, expiry worker, and credit reconciliation together. Check every source of money and its idempotency key.
4. Add authenticated board, accept, contact, release, and receipt-confirmation endpoints. Take the existing canteen lock before rights changes and ledger writes. Authorize each operation on the server.
5. Add the buyer mode selector, destination form, board filters, and accepted-request screens. Integrate the existing pickup passes and profile form.
6. Add in-app delivery updates; add push only with a complete sender/subscription flow.
7. Run the tests below, then deploy the additive migration, backend, and frontend. Keep delivery disabled until the full checkout-to-reward path passes on the public deployment.

## Required tests

- Pickup prices remain unchanged; delivery is exactly 10%, shown before payment, and charged once.
- Unconfirmed, failed, or expired payments never publish an open delivery request. Late capture follows the existing reconciliation rules.
- Two simultaneous accepts produce one assignee. The loser receives no contact details or valid pass. Self-acceptance and staff acceptance fail.
- A stale/outside/inaccurate GPS fix cannot prove current canteen presence. A valid serving scan can prove it. People outside the canteen cannot accept by editing client state.
- Acceptance changes only existing pickup rights. Old buyer passes fail for transferred portions; the delivery student's passes succeed at the appropriate counters. Other orders, recipients, and canteens remain isolated.
- Multiple counters and prepared items retain tokens, reservations, and deadlines. Staff can serve another student while an item is pending.
- Buyer confirmation credits the assigned student once. Repeated requests, concurrent confirmation, and network retries do not duplicate rewards.
- Food expiry, withdrawal, partial cancellation, and all-item cancellation balance both food credit and delivery credit. No bank refund is implied for these credits.
- Before acceptance, no public or unrelated API reveals names, numbers, exact meeting points, or presence records. After acceptance, only the two participants receive contacts.
- A changed assignment revokes old passes. Already-collected portions cannot be collected again.
- On OnePlus Nord 2 Chrome, verify real GPS, QR scanning, installed-app layout, permission denial, contact links, and fixed-frame controls. Browser mocks do not replace these checks.
