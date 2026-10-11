# MINT UI/UX audit

**Evaluation date:** 11 October 2026

**Workspace revision:** `3074f03` (`main`)

**Product specification reviewed:** `localnotes/Campus_Canteen_System_Specification.md`, version 1.1, dated 10 October 2026 (workspace-local and ignored by Git)

**Frontend implementation handoff reviewed:** `docs/frontend/HANDOFF.md`, dated 11 October 2026
**Audit type:** source-supported heuristic and workflow audit. No redesign was implemented.

## 1. Scope and limitations

MINT is a Next.js 16.4.0 / React / TypeScript PWA for Main, IT and MBA canteens. The documented student journey is browse → cart → pay → confirm arrival in the app → collect from one or more counters. A payer can transfer selected portions to a verified friend. Staff scan collection passes and record portions actually handed over. The current frontend scope contains student, serving and manager workspaces. The latest frontend handoff says walk-in sales use a separate system and this PWA has no cashier/billing workspace.

I read the root `AGENTS.md`, `package.json`, the route entry files, `docs/frontend/HANDOFF.md`, the visual target and menu/limits notes, `src/components/mint-app.tsx`, `src/components/manager-dashboard.tsx`, `src/app/globals.css`, route/API wrappers, and browser test sources. I inspected the local MINT icon asset. I did not read `.env.local`, payment credentials or personal test-account data. No README or separate readiness document exists in the workspace file list; the dated frontend handoff is the current implementation/readiness guide. The detailed product specification is in ignored `localnotes/` and is not part of the tracked Git revision.

**Runtime access limit:** The production MINT tab was open in the available browser, but the browser security policy explicitly denied access to `https://mint-campus-demo.vercel.app`. I did not retry through another browser surface or indirect browser-control path. No local web server was listening on ports 3000, 3001 or 4000 when checked. Therefore I could not interact with the running app, capture screenshots, inspect computed layout at runtime, sign in, or verify live order/payment/geolocation/scanner states. I did not run connected Playwright tests because they use configured real accounts and could affect live orders, stock or credits. Isolated mocked browser tests exist, but I did not run them for this audit; they are not runtime evidence.

No student, delegated collector, serving-staff or manager journey is marked “Reproduced.” Viewports 360, 390, 768 and 1440 CSS px are not visually inspected. The source contains responsive rules and tests referencing viewport sizes, but this report makes no claim that those layouts passed in a browser. Browser geolocation, real campus accuracy, camera permission, PWA suspension/resume, payment-provider redirects and physical counter operation remain untested. Contrast ratios below are calculated from the literal source color values, not sampled from rendered pixels.

The repository contains a policy conflict. The user’s explicit audit constraints and version 1.1 specification require app-only student arrival. The 11 October handoff and current frontend copy also say that an assigned serving-staff QR scan records arrival. I treat the explicit user constraint and version 1.1 self-service requirement as authoritative and list the conflict as UX-001. The version 1.1 specification also describes a cashier view; the newer 11 October frontend handoff says cashier/billing is outside this PWA. This report records cashier as **not implemented in this application**, not as an existing defect or a recommendation to add it.

### Evidence labels

- **Reproduced:** directly observed by browser interaction. None in this audit.
- **Code-supported:** source text or control flow supports the finding; UI behavior was not runtime-reproduced.
- **Hypothesis:** plausible concern that needs browser or user validation.
- **Design proposal:** a specific improvement opportunity, not an observed defect.

### What is already working in the design and should remain

- The MINT wordmark and icon use the existing burgundy/cream identity. Keep this identity and the warm neutral surfaces; the 512 px icon was inspected and is coherent with the app mark.
- The app separates student menu/orders/account, serving scan/preparation, manager dashboard and online availability. This matches the main role tasks without introducing a separate student-facing cashier flow.
- The menu already distinguishes “Ready now” from “Made to order,” shows station/category and price, and disables unavailable additions. Preserve these distinctions. Do not add unsupported dietary, allergy, wait-time or stock claims.
- Cart browsing and cross-canteen addition are distinct interactions in source: changing the selected canteen does not clear the cart; attempting to add from a different canteen triggers the cart replacement confirmation. Preserve that behavior.
- Checkout explicitly says stock is reserved at order placement, shows canteen credit and online-payment portions separately, and asks the student to accept updated prices. Pending-payment copy warns users not to pay again while a bank debit is being verified.
- Pickup details group portions by station, show collector/token/state/deadline, and expose a separate pass dialog. Staff select the actual portions given; “Next pickup” is available after handover. Keep the distinction between receipt and pickup pass.
- Manager availability copy says it controls portions for new online orders and that existing reservations remain protected. Preserve this distinction from physical kitchen inventory.
- Shared controls have visible keyboard focus styles and a 44 px minimum button/input/select target in CSS. Main text and muted text tokens are high enough contrast against the primary canvas: calculated `#292329`/`#FAF8F7` is 14.0:1 and `#756B70`/`#FAF8F7` is 4.85:1. These calculations do not establish whole-app WCAG conformance.

## 2. Highest-priority changes

| Priority | Finding | Severity | Effort | Why it is prioritized |
|---|---|---:|---|---|
| 1 | [UX-001](#ux-001-checkout-and-pickup-copy-allows-staff-scan-to-count-as-arrival) — Remove staff-scan arrival promises and enforce app-only arrival | 4 | Medium/large | Conflicts with an explicit policy. Can create a false belief that an order is protected from expiry. Backend behavior must be checked alongside copy. |
| 2 | [UX-002](#ux-002-receipt-does-not-name-the-financial-destination-for-each-resolution) — Show whether a resolution is MINT credit or a payment-method refund | 3 | Medium | Affects money understanding and prevents students from treating a pending refund as spendable credit, or vice versa. |
| 3 | [UX-003](#ux-003-manager-overdue-action-extends-a-deadline-on-one-tap-without-showing-the-current-deadline) — Add context and confirmation to manager deadline extensions | 2 | Small/medium | A single tap changes a student’s collection deadline; the row omits the current deadline. Frequency is unknown. |
| 4 | [UX-004](#ux-004-otp-resend-is-an-indirect-action-with-a-static-cooldown-message) — Make OTP resend and cooldown behavior explicit | 2 | Small | The visible action first returns to the email form and the cooldown has no live countdown. Recoverable, but likely confusing during sign-in. |
| 5 | [UX-005](#ux-005-sign-in-does-not-retain-the-requested-route) — Return students/staff to the requested route after authentication | 2 | Small | Deep links are replaced with the role landing page after sign-in. This can add navigation and lose order/invitation context. |
| 6 | [UX-006](#ux-006-critical-action-feedback-is-only-a-three-second-toast) — Keep important action outcomes visible in the relevant screen | 2 | Small/medium | All shared messages clear after three seconds. Routine notices fit this pattern; payment, arrival and handover errors need a persistent state to prevent unsafe retries. |
| 7 | [UX-007](#ux-007-paused-canteen-state-is-a-dot-without-visible-text) — Give paused canteens a visible text label | 1 | Small | The switch communicates paused state through a dot whose accessible name is not visible. Item cards later say “Ordering paused,” but the canteen-level state is not explicit at selection time. |

Severity describes user impact, recurrence and recoverability. Frequency has not been measured and is marked unknown in each finding. Implementation priority is a separate judgment based on policy risk, reach, dependencies and effort. The scale follows NN/G’s combination of frequency, impact and persistence, adapted to the scale requested for this report. [NN/G severity guidance](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/)

## 3. Coverage matrix

“Partially inspected” means source, specification and/or test source was read, but the live workflow was not interacted with. “Blocked” means an essential runtime state could not be safely reached in this audit. These labels describe this audit, not feature readiness.

| Route / surface | Role | Workflow and states covered by source review | Audit status |
|---|---|---|---|
| `/` | Signed-out student or staff | Student OTP and staff password entry; role landing redirect | Partially inspected; wrong/expired code and actual session recovery blocked |
| `/` onboarding state | First-time student | Profile name/mobile collection and save message | Partially inspected; submission not interacted with |
| `/menu` | Student | Main/IT/MBA selection, search, category/readiness filters, available/paused/sold-out item state, quantities, cart indicator | Partially inspected; live inventory freshness and visual layout blocked |
| `/cart` | Student/payer | Canteen, line totals, credit selection, 25 + 5 policy text, price-change acknowledgement, checkout action, pending/uncertain payment guidance | Partially inspected; no payment started; failed/abandoned/provider-return states blocked |
| `/orders` | Student/payer and delegated collector | Invitations, active/past filter, order rows, progress and arrival deadline labels | Partially inspected; account-specific states blocked |
| `/orders/[id]` pickup view | Payer and assigned collector | Arrival card, countdown, station groups, partial item state, passes, receipt | Partially inspected; actual arrival and physical collection blocked |
| `/orders/[id]` share view | Payer | Portion selection, invitation, cancellation, pending invitation actions | Partially inspected; send/accept/reject/revoke/reassign transitions blocked |
| `/orders/[id]` receipt view | Payer | Item amounts, total, payment split, credit/fine, payment resolution | Partially inspected; actual resolution examples and original-method refund state blocked |
| `/credit` | Student/payer | Credit account, expiry lots and ledger are represented in source | Partially inspected; actual balance/spend/expiry state blocked |
| `/account` | Student/staff | Profile, allowances, help, role membership and account actions | Partially inspected; profile edit and logout not interacted with |
| `/staff` scan view | Serving staff | Station selector, camera control, pasted-token fallback, scan result, portion checkboxes, handover and next-pickup action | Partially inspected; all real camera, station, network, duplicate-scan and handover outcomes blocked |
| `/staff` pending/preparation view | Serving staff | Pending queue, start preparation, mark ready, overdue collection indicator | Partially inspected; live queue and suspended-session behavior blocked |
| `/dashboard` | Manager | Today/last-seven-days, online sales, credit/refunds, pickup activity, attention rows, overdue action, worker state | Partially inspected; current live metrics and extensions blocked |
| `/manager` | Manager | Online availability, stock search/category, item settings, student restriction review | Partially inspected; live stock and concurrent edit conflict blocked |
| Cashier/billing workspace | Cashier | Separate walk-in system described in older product specification | **Not implemented in this PWA** per 11 October frontend handoff; not audited as a screen |
| Campus-wide administration | Campus administrator | Roles, policy, canteen setup described in specification | **Not implemented as a frontend workspace** in discovered routes |
| PWA install/offline | Student/staff browser | Install prompt, static shell/offline fallback, app-level online guard are present | Partially inspected from source/test definitions; no browser/device execution |
| Common error/loading/empty/status states | All roles | Shared toast, loading state, empty state, offline disabled actions, error role attributes | Partially inspected; announcement timing, keyboard focus and visual distinction blocked |

### Viewport and accessibility coverage

The CSS has mobile rules at 760 px, a narrow rule below 360 px, a desktop navigation rule from 1100 px, and short-height rules at 650/500 px. Tests mention phone/desktop and multiple fixed-frame widths, but no test was run here. Consequently, 360, 390, 768 and 1440 px results are **not observed**. No screen-reader, keyboard-only, 200% text resize, 400% zoom/reflow, forced-colors, Android/iOS, landscape, safe-area or software-keyboard test was performed. WCAG 2.2 AA is the evaluation reference; this report does not declare conformance.

## 4. Detailed findings

### Journey A — Authentication

#### UX-004: OTP resend is an indirect action with a static cooldown message

1. **Title:** OTP resend is an indirect action with a static cooldown message.
2. **Location:** `/`, signed-out student, after requesting a code; the `MintApp` sign-in form. Viewport not observed.
3. **Evidence:** **Code-supported.** No runtime reproduction. The OTP state displays “Change email or resend code” and “Wait 60 seconds before requesting another code.” Clicking the former runs `setSent(false)`, returning to the email-entry state; it does not directly request or resend a code. The cooldown copy is static and the action is not visibly countdown-gated in the frontend. See `src/components/mint-app.tsx` around lines 1273–1302. Server/provider enforcement was not inspected in this UI audit, so no claim is made that repeated requests succeed.
4. **User consequence:** A student who needs a new code must infer that they should submit the email form again. The static 60-second instruction does not tell them how much longer to wait or whether the action is available. A mistap can also erase the visible OTP-entry context. Frequency is unknown; recovery is possible by re-entering the same email.
5. **Severity:** **2 — Minor.** Sign-in remains recoverable, but friction occurs at a mandatory entry point. Recurrence/frequency is unknown.
6. **Exact recommendation:** Keep one email field and one OTP field. Split the combined control into “Change email” (returns to the email field) and a dedicated resend control. On entering OTP state, show a 60-second countdown based on server/provider response if available. Keep resend disabled until eligible, then invoke resend directly and announce the result. Do not add a second OTP system or change provider policy.
7. **Replacement wording:** OTP state: “Enter the 6-digit code sent to {email}.” Secondary action: “Change email.” Cooldown: “Resend code in 0:42.” Enabled action: “Resend code.” Result: “A new code was sent. Use the newest code; earlier codes no longer work.” Use the last sentence only if that matches the configured provider behavior.
8. **Interaction behavior:** Change email restores email entry and retains the value for editing. Resend keeps the user on OTP entry, clears the previous code only after a successful request, and resets the timer from server acknowledgement. On provider rate limit/network failure, keep the entered code unless the backend invalidates it; show an inline retry state and preserve the email. Verification errors remain associated with the OTP field. Paste and `autocomplete="one-time-code"` remain supported.
9. **Implementation scope:** `src/components/mint-app.tsx` sign-in state/form around lines 1209–1318; `src/app/globals.css` `.otp-input`; auth API responses in `src/app/api/[...path]/route.ts` and backend auth module are tentative dependencies to inspect before implementation.
10. **Acceptance check:** From a signed-out student session, request a code and verify that resend shows a decreasing cooldown and cannot be triggered early; when eligible, one tap requests another code without returning to email entry. Change email works independently. Wrong, expired and superseded codes show a specific recoverable message. OTP paste and numeric mobile keypad work. No password or OTP is written to app logs or local storage.
11. **Effort and dependencies:** **Small** if the server returns cooldown eligibility; **medium** if the response contract must be extended. Depends on confirmed Supabase Auth resend behavior and server cooldown.
12. **Confidence and validation:** Medium confidence from direct source trace. Test with first-time and less technically confident students after browser access is restored; actual provider expiry, resend and supersession remain unverified.

#### UX-005: Sign-in does not retain the requested route

1. **Title:** Sign-in does not retain the requested route.
2. **Location:** Any protected student/staff route opened while signed out or after session expiry; signed-out sign-in screen and role landing. Viewport not observed.
3. **Evidence:** **Code-supported.** No runtime reproduction. Successful staff password and student OTP handlers both call `router.replace("/")`; the root route then redirects to the role landing page (`/menu`, `/dashboard`, `/staff`, or `/account`). The original `pathname` is not carried through sign-in. See `src/components/mint-app.tsx` around lines 279–282, 401–410 and 1215–1224.
4. **User consequence:** A student opening an order or invite link may land on the menu after signing in and need to find the original task again. A staff member returning to a station-specific workspace may similarly lose context. Frequency is unknown; the path is recoverable through navigation if the user remembers it.
5. **Severity:** **2 — Minor.** This adds navigation to a recoverable flow, but could be more disruptive for time-sensitive arrival or collection. Frequency is unknown.
6. **Exact recommendation:** Save the requested internal route before authentication and return to it after the session is established. Accept only same-origin application paths from the known route allowlist; use the role landing route when the destination is invalid or the role is unauthorized. Preserve the route through OTP resend and reload.
7. **Replacement wording:** Keep the current “Sign in” labels. On successful authentication, show a short status such as “Signed in. Returning to your order…” only if navigation is visibly delayed; no extra confirmation screen is needed.
8. **Interaction behavior:** `/orders/{id}` entered signed out returns to the same order after OTP. A staff-only route requested by a student falls back to the student menu with an access message. A malformed/external redirect is rejected. Browser Back after sign-in returns to a safe in-app screen, not the signed-out challenge.
9. **Implementation scope:** `src/components/mint-app.tsx` route selection, auth completion around lines 401–410 and 1215–1224; `src/app/[...screen]/page.tsx` route allowlist. Session/auth code may affect this flow and should be checked before implementation.
10. **Acceptance check:** Open an order URL in a clean student session, sign in, and confirm the same order opens. Repeat with manager and serving URLs under their authorized roles. Confirm an unauthorized role is redirected safely and external `returnTo` URLs cannot escape the app.
11. **Effort and dependencies:** **Small.** Needs a sanitized internal return path and one auth-route test per role.
12. **Confidence and validation:** High confidence in the redirect sequence from source. User testing is needed to judge how often students arrive through deep links or session expiry.

### Journey B/C — Canteen, menu, cart, checkout and payment

No confirmed defect was found in the menu/cart source flow for free canteen browsing: `switchCanteen` changes the selected menu without touching the cart; `changeQuantity` prompts only when adding another canteen’s item. This matches the requested behavior and should remain. Runtime confirmation was blocked. The checkout source shows a cart summary, stock-reservation timing, credit/online split, 25 + 5 copy, explicit price acceptance and guidance not to pay again while payment is uncertain. These are positive design decisions, not evidence that provider-return or payment recovery works.

#### UX-002: Receipt does not name the financial destination for each resolution

1. **Title:** Receipt does not name the financial destination for each resolution.
2. **Location:** `/orders/{id}` → “Receipt,” payer role, after cancellation, expiry or payment exception. Viewport not observed.
3. **Evidence:** **Code-supported.** No live receipt reproduced. The receipt shows “Credit returned,” “Missed pickup fine · 10%,” and a generic “Payment resolution · {state}” followed by amount and reason. The frontend `Detail.resolutions` type contains amount/state/reason but omits the `provider_refund` field present in the catalogue response. Current broad policy copy reads: “Eligible cancellations return as same-canteen credit. Missed pickups return 90% after a 10% fine. Credits expire after 30 days.” See `src/components/mint-app.tsx` around lines 2239–2300 and the corresponding receipt data shape near the top of the file; `src/modules/catalogue.ts` returns provider refund metadata. No claim is made about a live refund’s status or method.
4. **User consequence:** A payer may see that a resolution exists without being able to distinguish spendable canteen credit from a refund sent to the original payment method, or identify whether the money is still processing. This can lead to incorrect expectations or a repeated payment/support request. Frequency is unknown; the receipt remains available.
5. **Severity:** **3 — Major.** Financial destination/status ambiguity can cause substantial confusion and repeated support work. Actual frequency is unknown, and the payer can recover by checking credit activity or provider records.
6. **Exact recommendation:** Render each resolution as its own item with (a) reason and affected amount/portions, (b) destination, (c) status, and (d) date/time. Use “MINT credit” only when the ledger has posted credit; use “refund to original payment method” only for provider refunds. If pending, explicitly say the money is not available yet. Keep the 10% fine separate from the 90% credit. Do not infer a refund from cancellation or from a generic `completed` label.
7. **Replacement wording:** Posted credit: “₹{amount} added to your {canteen} credit. Use it at {canteen} before {expiry date}.” Pending refund: “₹{amount} refund to your original payment method is processing. It is not MINT credit.” Completed refund: “₹{amount} refunded to your original payment method.” Missed arrival: “₹{credit} added as {canteen} credit; ₹{fine} missed-arrival fine deducted.” Replace these with the exact server-confirmed channel/status; do not promise a bank posting time unless the provider supplies one.
8. **Interaction behavior:** The receipt updates from pending to completed only after server confirmation and retains prior states/timestamps. “View credit activity” opens the same-canteen credit ledger, not a bank-refund view. On timeout, show “Checking status” and keep the order reference visible; do not prompt another payment. A partial resolution identifies which units it covers.
9. **Implementation scope:** `src/components/mint-app.tsx` `Detail` type and receipt section around lines 2203–2300; `src/modules/catalogue.ts` resolution response; `src/modules/payments.ts` / cancellation services determine actual method and status; manager refund metric in `src/components/manager-dashboard.tsx` is related but not a substitute for payer detail.
10. **Acceptance check:** Test one posted same-canteen credit, one pending original-method refund, one completed original-method refund, one 90% missed-arrival credit plus 10% fine, and one partial cancellation. Each outcome names the destination, status and amount. Credit activity changes only after posting. Reload preserves the same resolution. No test or copy labels bank refund as MINT credit.
11. **Effort and dependencies:** **Medium.** Frontend needs a typed outcome/destination and per-resolution display; backend/provider state mapping must be confirmed first.
12. **Confidence and validation:** High confidence that the current UI uses generic resolution wording and omits the available provider-refund field. Actual resolution semantics require backend and test-environment validation. Validate comprehension with students before release.

### Journey D — Arrival and location

#### UX-001: Checkout and pickup copy allows staff scan to count as arrival

1. **Title:** Checkout and pickup copy allows staff scan to count as arrival.
2. **Location:** `/cart` before payment and `/orders/{id}` pickup view, student payer or delegated collector; corresponding `/staff` scan workflow. Viewport not observed.
3. **Evidence:** **Code-supported; policy conflict confirmed in workspace sources and workflow tests.** No live interaction reproduced. Checkout currently says: “Arrive within 25 minutes, with 5 minutes of grace. Check in using a fresh phone location or show your pickup pass at the counter.” Pickup says: “Show your pass at the counter to check in, or use your phone’s location.” For non-demo canteens it says: “Allow precise location, or show your pass at the counter. A staff scan also checks you in.” These are in `src/components/mint-app.tsx` around lines 1629–1635 and 1880–1959. This is not copy-only drift: `src/modules/operations.ts` around lines 92–118 calls `recordArrival` while resolving a valid staff QR pass and writes a `staff_scan_arrival` audit event. `tests/workflows.test.ts` around lines 521–574 explicitly expects the scan to arrive the scanned collector’s portions. Location failure copy in `src/modules/pickup.ts` also tells students to show a pass so staff can check them in. The source spec says arrival is self-service, has no staff confirmation/override and forbids a scan from implicitly recording arrival (`localnotes/Campus_Canteen_System_Specification.md`, sections 5.6 and 7). The 11 October frontend handoff and its section 3 currently conflict with that rule. The app computes a 25-minute target and final 30-minute deadline in visible copy/source; no timer behavior was observed.
4. **User consequence:** A student may believe that showing a pass or being scanned at the serving counter protects unarrived quantities, even if they did not complete app check-in. A serving worker may be led to perform or expect an arrival action outside the approved policy. At deadline, this can create surprise expiry/credit outcomes. This touches core collection and money expectations. Frequency is unknown.
5. **Severity:** **4 — Critical.** The mismatch can affect a core arrival task and financial eligibility; once a portion expires, the student may only receive the policy-defined credit. Frequency is unknown, and recovery after the deadline may not be available under the explicit policy.
6. **Exact recommendation:** Remove every claim that a staff scan checks in, approves location, extends the arrival window or substitutes for the student’s app action. The student/delegate must tap the app check-in and submit a current location sample. A staff scan may read the existing arrival state, but it must not create/change it. If app location fails, show actionable permission/network guidance and a self-service retry while the original final deadline remains. Do not add staff approval, staff arrival, location override or scan-based arrival override. Resolve the product-spec/handoff conflict in source documentation so the next developer does not reintroduce the behavior.
7. **Replacement wording:** Checkout: “Check in through MINT by {final deadline}. The target is 25 minutes after payment, followed by a 5-minute grace period. Your final deadline is shown on the order. A pass is for collection; it does not check you in.” Pickup action: “Check in through my app.” Help: “Allow location access and try again. If it still fails, retry before {deadline}; counter staff cannot check you in.” Staff missing-arrival result: “The student must check in through MINT before collection.”
8. **Interaction behavior:** After verified payment, store/display target = confirmation + 25 minutes and final eligibility cutoff = confirmation + 30 minutes, using server time. The order detail shows both times and a clear remaining-time label. Student location denial/outside/inaccurate/timeout produces distinct next steps, preserves the order and allows retry until the final cutoff. At/after cutoff, UI reflects the server outcome and the exact 90% same-canteen credit/10% fine policy only for eligible unarrived portions. Staff scan with no accepted arrival displays a read-only message and cannot alter arrival state. Delegation does not restart the original deadline; each collector checks in for only their assigned quantities.
9. **Implementation scope:** Frontend copy/conditions in `src/components/mint-app.tsx` around lines 1629–1635 and 1867–1960; server mutation in `src/modules/operations.ts` `resolvePass`; student-only location path in `src/modules/pickup.ts`; API validation in `src/app/api/[...path]/route.ts`; regression tests in `tests/workflows.test.ts` and `tests/browser/frontend.spec.ts`. Update the 11 October implementation handoff because its arrival rule conflicts with the authoritative user constraint. Do not alter unrelated post-arrival collection-deadline rules.
10. **Acceptance check:** Student checkout shows both the 25-minute target and 30-minute final cutoff. Fresh valid app location succeeds; denial, timeout, inaccurate/outside sample and network failure give a retry path without creating arrival. Assigned staff scans an unarrived pass and cannot check in or hand over; remove/rewrite the existing test that currently expects a successful staff scan to record arrival. A collector scan after accepted app check-in reads that status only. Delegated portions keep the original deadline and have separate collector arrival state. A check evaluated at/after the server deadline cannot race into accepted arrival. Verify policy copy with a test order; no real payment/credit is used.
11. **Effort and dependencies:** **Medium/large.** Requires removing the scan-side arrival mutation, changing handover gating and error copy, revising unit/browser tests, and correcting the conflicting handoff. Backend behavior is a release dependency.
12. **Confidence and validation:** High confidence that current backend code and tests implement staff-scan arrival and conflict with the explicit rule. Live behavior was not reproduced. After correction, validate with isolated workflow tests and then test wording/task success with students and serving staff. GPS accuracy still requires physical on-campus device tests; browser location emulation is not proof of campus accuracy.

### Journey E/F — Pickup, partial handover and delegation

Source structure already contains a useful distinction between order status, remaining/collected counts, counter groups, collector/token detail, per-portion selection, preparation actions and “Next pickup.” The delegated invitation text says acceptance transfers pickup rights and tells the friend to check in before the supplied deadline. The source does not support a reproduced claim about QR sizing, placement, partial-refresh timing, stale passes or screen-reader flow. These states remain in the coverage matrix for live validation after access is restored. Do not redesign these flows from source alone.

### Journey H — Counter staff and manager

#### UX-003: Manager overdue action extends a deadline on one tap without showing the current deadline

1. **Title:** Manager overdue action extends a deadline on one tap without showing the current deadline.
2. **Location:** `/dashboard`, manager for an assigned canteen, “Needs attention” list containing an overdue checked-in portion. Viewport not observed.
3. **Evidence:** **Code-supported.** No interaction reproduced. Each row currently shows item, order reference, collector, station and state; the button reads “Extend 15 minutes.” Clicking immediately calls the manager endpoint with a hardcoded 15-minute extension and reason. The row does not display the old deadline or time overdue and has no confirmation step. See `src/components/manager-dashboard.tsx` around lines 124–150 and `src/components/mint-app.tsx` around lines 3126–3137.
4. **User consequence:** A manager can extend a collection window without seeing the current cutoff or confirming which case is being changed. The row has identifying details, but a quick tap or mobile mis-touch can still make an unintended deadline change. Frequency is unknown; the extension is not shown as reversible in the UI.
5. **Severity:** **2 — Minor.** It affects a consequential exception action but is recoverable through review/contact and does not itself issue money or mark a portion collected. Frequency is unknown.
6. **Exact recommendation:** Keep the overdue case row and contact instruction. Add the current collection deadline and elapsed overdue duration. Change the immediate action into a small case review with the item/order/collector/station, current deadline, reason and clear confirm/cancel choices. Do not add an arrival override; this action only concerns an already checked-in portion’s collection deadline.
7. **Replacement wording:** Row: “Past collection deadline · due {time} · {minutes} min overdue.” Action: “Review 15-minute extension.” Confirmation: “Extend this collection deadline by 15 minutes?” Buttons: “Cancel” and “Extend deadline.” Success: “Deadline extended to {new time}. Contact the collector and serving staff.”
8. **Interaction behavior:** Opening review does not mutate data. Confirm shows busy state and disables repeat submit. On success, update the new deadline in the row and announce it. On network/authorization failure, leave the prior deadline visible and offer retry. The extension must not change arrival status or payment/credit state.
9. **Implementation scope:** `src/components/manager-dashboard.tsx` overdue detail row; callback and mutation in `src/components/mint-app.tsx` around lines 3126–3137; manager collection-review API/module determines actual cap and audit fields.
10. **Acceptance check:** A manager can see the item, collector, station, current due time and overdue duration at 360/390 px. Opening review causes no request. Cancel changes nothing; confirm makes exactly one extension and shows the new server deadline. Retry after timeout does not apply a duplicate extension. A manager cannot extend a non-overdue or unassigned portion.
11. **Effort and dependencies:** **Small/medium.** UI confirmation and current-deadline detail depend on the manager summary/API returning the authoritative deadline and extension result.
12. **Confidence and validation:** High confidence from source. Frequency and accidental-tap risk are unknown; validate with managers using a simulated overdue row.

### Common interaction feedback

#### UX-006: Critical action feedback is only a three-second toast

1. **Title:** Critical action feedback is only a three-second toast.
2. **Location:** Shared app message surface across student checkout/arrival, staff handover and manager actions; all roles. Viewport not observed.
3. **Evidence:** **Code-supported.** No live timing measured. Any non-empty shared `message` opens a popover and is cleared after exactly 3000 ms; the element uses `role="status"`, `aria-live="polite"` and an explicit dismiss button. See `src/components/mint-app.tsx` around lines 342–347 and 3288–3298. This is an implementation timer, not an observed time-to-read.
4. **User consequence:** A user who is interrupted, using assistive technology, or reading a long explanation may miss an error or next step. Financial pending state is separately rendered inline in the order view, which is a good existing recovery pattern. The concern is only messages that are the sole outcome of a consequential action. Frequency is unknown.
5. **Severity:** **2 — Minor.** Most success notices can be transient; a lost error can cause extra effort or a repeat attempt. Persisting order state can recover some cases. Frequency is unknown.
6. **Exact recommendation:** Retain the floating three-second toast for routine confirmations because this is the selected app notification behavior. For payment uncertainty, failed check-in, failed handover, stock conflict or deadline extension, also write the outcome into the relevant persistent order/queue/case panel. Never make a toast the only evidence that money or food changed. Keep the polite status announcement and prevent repeated announcements during polling.
7. **Replacement wording:** Payment timeout: “Payment status is still being checked. Do not pay again yet.” Check-in failure: “We couldn’t confirm your arrival. Check location access and try again before {deadline}.” Handover timeout: “We couldn’t confirm whether these portions were handed over. Check the latest pickup status before serving them again.”
8. **Interaction behavior:** Toast remains visible for up to three seconds and can be dismissed. The relevant order/case panel retains pending/failed/confirmed state after the toast disappears and after reload. A retry first refreshes authoritative state; it does not create another payment, arrival or handover. Long-running/polling updates are not announced repeatedly.
9. **Implementation scope:** Shared toast in `src/components/mint-app.tsx` around lines 342–347 and 3288–3298; persistent states belong in payment, pickup and manager/serving panels. Follow `src/modules/payments.ts` and `src/modules/pickup.ts` outcomes.
10. **Acceptance check:** For payment, arrival, handover and stock mutation, dismiss or wait for the toast to disappear and confirm the outcome is still visible in the relevant page and after reload. Trigger an uncertain network outcome and confirm the user is told to verify state before repeating. A routine “Saved” confirmation still dismisses automatically.
11. **Effort and dependencies:** **Small/medium.** Reuse existing order/case status surfaces; no new notification system or dependency is needed.
12. **Confidence and validation:** High confidence in the three-second timer from source. The spoken announcement and real reading time were not observed. Test keyboard and screen-reader behavior after browser access returns.

### Journey I — Canteen selection

#### UX-007: Paused canteen state is a dot without visible text

1. **Title:** Paused canteen state is a dot without visible text.
2. **Location:** `/menu`, student, canteen switch when a canteen is paused. Viewport not observed.
3. **Evidence:** **Code-supported.** No visual interaction reproduced. A paused canteen adds a `status-dot` with `role="img"` and `aria-label="Ordering paused"`; the accessible name is not visible text. Item cards later show “Ordering paused.” See `src/components/mint-app.tsx` around lines 1347–1372 and 1480–1485; `src/app/globals.css` around lines 322–329 and 435–442.
4. **User consequence:** A sighted student choosing a canteen may not know why it has a dot or whether ordering is paused until viewing an item. The later card state is recoverable but costs browsing effort. Frequency is unknown.
5. **Severity:** **1 — Cosmetic.** It is a small status-clarity gap; per-item state still communicates pause. Frequency is unknown.
6. **Exact recommendation:** Put a short visible text label beside the paused canteen name. Keep the selected canteen state conveyed by both color and `aria-pressed`; do not rely on a dot color alone.
7. **Replacement wording:** Add “Ordering paused” to the canteen switch option. If the canteen is not paused, show no extra status text.
8. **Interaction behavior:** Disabled/paused status is visible before opening the canteen; browsing remains allowed if the product intends browsing while closed/paused, while Add controls remain disabled. On resuming orders, remove the label from the refreshed server state.
9. **Implementation scope:** `src/components/mint-app.tsx` canteen switch around lines 1347–1382; mobile hide rules for `.canteen-switch > button > span:last-child` and text layout in `src/app/globals.css` around lines 409–442 and 1306–1330 need review so the new label is not hidden at phone widths.
10. **Acceptance check:** At 360 and 390 px, a paused canteen name and “Ordering paused” remain visible and do not overlap the other canteen choices. Screen reader output includes the name and paused state once. Add controls for its items stay unavailable while paused.
11. **Effort and dependencies:** **Small.** Needs a compact mobile label treatment.
12. **Confidence and validation:** High confidence in the source markup. Check actual wrapping and status legibility in the browser before implementation.

## 5. Screen revisions

These revisions retain the existing components and visual identity. They specify hierarchy and state behavior, not a new visual system.

### Checkout (`/cart`)

| Order | Section | Purpose and action |
|---:|---|---|
| 1 | “Review order” + selected canteen | Confirm which canteen this order belongs to; expose a return-to-menu action. |
| 2 | Item lines grouped by station | Show item, quantity, unit price and line total; allow quantity correction before payment. Do not substitute unavailable food. |
| 3 | Total and payment split | Show total, canteen credit used and amount due online as separate values. |
| 4 | “Before you pay” policy panel | State 25-minute target, five-minute grace, final 30-minute cutoff, student app-only arrival, same-canteen credit rules and the 90%/10% missed-arrival treatment. Explain prepared-food exceptions only as actually configured. |
| 5 | Stock/price changes | Show removed/changed lines, updated availability and exact revised total. Require explicit acceptance of a price increase; never silently swap items. |
| 6 | Sticky primary action | “Place order” / “Reserving your items…”; keep total and payment amount visible. Disable during submit and preserve an idempotent retry path. |
| 7 | Result / unresolved payment state | Confirm only server-verified payment. If uncertain, persist “Do not pay again yet” with order reference and “Check payment status.” |

Use the current checkout policy area, but replace the staff-scan sentence per UX-001. Do not claim that digital billing removes preparation or serving waits; current “Skip the billing queue. Preparation and serving queues still apply.” is accurate and should remain.

### Pickup (`/orders/{id}`)

| Order | Section | Purpose and action |
|---:|---|---|
| 1 | Canteen, order reference and order state | Identify the order and whether it is paid/confirmed, pending, expired or under review. |
| 2 | Arrival target + final deadline | Show “Target: {time}” and “Check in through MINT by {time}”; one persistent primary “Check in through my app” action while unarrived and eligible. Keep self-service retry visible after permission/location failure. |
| 3 | “To collect / Preparing / Collected” summary | Show counts from remaining order state, not just a generic completed badge. |
| 4 | Remaining portions grouped by counter | Put station name above its items, then item/quantity, collector, readiness, token, collection cutoff and next action. Keep uncollected quantities prominent. |
| 5 | Pickup pass action | Open large high-contrast QR only when needed. Keep station/counter name, collector name and eligible items visible with the QR; keep the receipt separate. |
| 6 | Collected portions | Keep a compact “Already collected” group after remaining items; show time and prevent selecting or presenting them as still collectible. |
| 7 | Share / receipt views | Sharing clearly says rights move only after acceptance, original deadline stays, no additional payment or kitchen order is created. Receipt lists posted MINT credit and original-method refunds separately. |

The source already has a promising order header, three progress counts, arrival panel and counter grouping. The key change is policy-accurate wording and persistent action/result state, not replacing the pickup screen.

### Serving (`/staff`)

| Order | Section | Purpose and action |
|---:|---|---|
| 1 | Assigned canteen/station | Make the current station unmissable. Station changes clear scanned customer context before the next scan. |
| 2 | “Scan pickup” / “Pending items” | Keep scanning as the default fast task and prep queue one tap away. |
| 3 | Scan prompt + camera / paste fallback | “Scan the student’s pickup pass.” If no accepted app arrival exists, give an informational block: “The student must check in through MINT before collection.” Do not offer staff arrival actions. |
| 4 | Scanned collector and eligible portions | Show only this station’s portions, remaining quantity, readiness and whether arrival is accepted. Make unavailable/already-collected items visibly distinct. |
| 5 | Preparation action per item | For made-to-order items, show “Start {item},” then “Mark {item} ready.” Preserve its token while the worker moves to another student. |
| 6 | Confirm actual handover | Keep item-level selection and use “Hand over {n} selected portions.” Confirmation must identify the selected item/count before mutation; don't use scan alone as handover. |
| 7 | Confirmed state / next student | After server-confirmed handover, update only those portions and make “Next pickup” immediately available. On timeout, query state before a second physical handover. |

Existing “Done · {n} items given” and “Next pickup” already support explicit, partial service. Confirm real scanner behavior and focus restoration before changing staff density.

### Manager dashboard (`/dashboard`)

Keep “Needs attention” at the top, followed by online paid order value, distinct payment/credit totals, pickup activity and menu/stock actions. For each overdue checked-in portion, add current collection cutoff and overdue duration. Replace the one-tap “Extend 15 minutes” action with the review/confirm flow in UX-003. Label all figures “Online orders only”; this is already stated in the dashboard copy and is necessary because walk-in sales live in a separate system.

## 6. Shared UI changes

- **Do not introduce a new palette or typography system.** Keep the existing Amrita burgundy, warm neutral background, cream accent, Georgia page titles and system sans body.
- **Keep current shared sizing tokens** as the baseline: controls are generally at least 44 px tall, input text is 16 px and small/help text is 12 px. The 44 px target is a usability recommendation, larger than WCAG 2.2 SC 2.5.8’s 24 × 24 CSS px minimum; the WCAG criterion has spacing and other exceptions. Check every icon-only control’s actual hitbox, not just `min-height`. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- **Keep contrast tokens**, subject to rendered verification. Static calculations: muted `#756B70` on canvas `#FAF8F7` = 4.85:1; burgundy `#A4123F` on surface `#FFFDFB` = 7.56:1; white on burgundy = 7.67:1. For normal text, compare the rendered pair with WCAG 2.2 SC 1.4.3 (4.5:1); icons and control boundaries have separate non-text contrast criteria. These pairs do not cover every CSS color or disabled state. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- **Use text with status color.** The paused-canteen indicator in UX-007 is the one specific source-backed exception to otherwise textual readiness/status labels.
- **Keep the single-field OTP design.** `autocomplete="one-time-code"`, numeric input mode and six-digit validation support paste and password-manager autofill. WCAG’s accessible-authentication guidance supports allowing copy/paste and compatible autofill; do not split the code into six forced boxes. [W3C accessible authentication](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)
- **Keep status announcement semantics**, then verify them manually. The toast is `role="status"` and polite-live; screen-specific progress should update without announcing each polling tick. WCAG SC 4.1.3 requires status messages to be programmatically determinable without forcing focus. [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- **Respect reflow and fixed-frame scrolling.** The implementation intentionally fixes the document and scrolls internal content panels. Validate 320 CSS px minimum reflow/400% zoom, a visible on-screen keyboard, short landscape height, dialogs and sticky checkout/pass controls. If essential content is clipped, allow the owning content panel to scroll; do not hide controls to preserve the fixed frame.
- Keep warm illustrations decorative and out of the way of item name, price, readiness and add action. No photography, animation, AI recommendations, dark mode or new dependency is justified by the evidence collected here.

## 7. Execution backlog

### Before a pilot

1. Resolve UX-001 across app copy, scan handling and backend authorization. Update the conflicting implementation handoff and verify no staff-only call can create arrival. This is a policy requirement, not optional polish.
2. Implement UX-002 with an explicit backend status/destination contract for posted credit versus original-method refund. Validate partial outcomes and the 90%/10% calculation against actual server records.
3. Add persistent state for uncertain payment, location/check-in failure and handover timeout per UX-006. Confirm retries read/return the authoritative outcome before another payment or physical handover.
4. Run the responsive, keyboard, screen-reader and physical-device checks in the validation plan. Treat real camera, real geolocation and provider-return results as separate from mocks.

### Operational improvements

5. Add the manager review/confirmation context in UX-003 for overdue, already-checked-in portions. Do not use it as an arrival override.
6. Clarify OTP resend cooldown and return-to-route behavior (UX-004/UX-005), then measure sign-in recovery with new students.
7. Add a visible paused canteen label at phone and desktop sizes (UX-007).
8. Validate quantity/availability wording and source-of-truth freshness with canteen staff. Keep available online order quantity distinct from planned production and walk-in inventory. Do not display estimates or promises without a reliable source.

### Optional polish

9. After observing staff in a lunch simulation, adjust scan/worklist density only where the task trace shows wasted movement or missed state. The current source structure already supports partial handover and next-student throughput.
10. Consider minor spacing or card adjustments only after real viewport captures; the available source does not substantiate a broad visual redesign.

Effort labels are local implementation estimates, not schedule commitments. The order prioritizes policy and financial safety before friction reduction.

## 8. User validation plan

Use an isolated demo/test environment, simulated menu/stock/orders and test payment provider only. Do not change live stock, issue real credit, charge a real account or contact real students. Use separate demo accounts for payer, friend/delegate, serving staff and manager; do not share account credentials in the audit report. Run at least one first-time or less technically confident participant in each student task and a serving staff member who has not seen the flow before. This is a proposed protocol, not completed research.

For every task, record task success (complete / incomplete), critical errors (wrong canteen, duplicate payment attempt, missed/incorrect arrival, wrong item handover, unintended deadline change), hesitation (visible pause before choosing an action), help requests, and completion time. Start time at the task prompt becoming visible; stop at the first server-confirmed end state specified below. Record interruptions separately. Do not treat location emulation as evidence of real campus positioning.

| Participant | Task | Start event | End event | Critical errors to record |
|---|---|---|---|---|
| First-time student | Sign in using university email and return to a provided order link | Order link opened | Correct order detail visible after sign-in | Wrong email, OTP resend loop, route lost, repeat submissions |
| Student | Browse all three canteens with an existing cart; add from another canteen only after accepting replacement | Existing cart shown | Target canteen cart contains intended item and old cart outcome is understood | Cart cleared during browsing; unclear cross-canteen confirmation |
| Student | Place a test order with one unavailable/changed item and an updated price | Cart review opened | Revised order is accepted or safely abandoned | Silent substitution/price, duplicate payment, uncertainty mistaken for success |
| Student | Complete app-only arrival with permission granted, then repeat with denied/stale/outside sample | Active order opened | Server reports accepted arrival, or retry guidance is visible | Belief that staff scan is a check-in; lost order; hidden final deadline |
| Student + friend | Transfer selected quantity to a verified friend; friend accepts and checks in | Payer opens Share | Friend sees only assigned portions and uses own app check-in/pass | Deadline reset, extra charge/prep job, payer loses ownership clarity |
| Student + staff | One ready portion and one made-to-order portion at different counters; give one, keep one pending, serve next student | First pass scanned | One portion collected, other remains pending, second student scan can proceed | Entire order accidentally closed, wrong station, duplicate handover |
| Student | Review a simulated same-canteen credit and a pending/completed original-method refund | Resolution notice appears | Student correctly identifies destination and whether money is usable | Treats pending refund as credit or credit as a bank refund |
| Manager | Review an overdue checked-in portion and decide whether to extend 15 minutes | Dashboard attention item visible | Correct case deadline is extended once or left unchanged | Wrong row/action, accidental one-tap extension, arrival state changed |

After fixes, repeat the same tasks and participant mix as a baseline comparison. **Proposed targets, not results:** 100% of participants correctly identify “staff scan does not check me in” and the final arrival time before payment; zero duplicate test charges or duplicate handovers; at least 90% task completion without moderator rescue; every money resolution correctly classified as MINT credit or original-method refund; no accidental manager extension. Compare median completion time and counts of hesitation/help requests with the pre-change baseline. Keep raw event definitions and sample size beside any reported result; do not claim campus-wide adoption or queue-time gains from this usability test.

## 9. Sources and open decisions

### Product and implementation sources

- `localnotes/Campus_Canteen_System_Specification.md` v1.1, 10 October 2026: policy/actor/flow requirements; this file is ignored by Git, so it should be placed in an approved tracked product-doc location if it is meant to remain the shared source of truth.
- `docs/frontend/HANDOFF.md`, 11 October 2026: current frontend scope/readiness. Its arrival bullets conflict with the user constraint and v1.1 spec and must be corrected.
- `src/components/mint-app.tsx`, `src/components/manager-dashboard.tsx`, `src/app/globals.css`, `src/app/[...screen]/page.tsx`, `src/app/page.tsx`, `src/modules/catalogue.ts` and browser test files: implementation evidence only; not proof of runtime behavior.
- Brand asset inspected: `public/icon-512.png`; design tokens are in `src/app/globals.css`.

### External standards and guidance checked

- [Nielsen Norman Group — 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): use visibility of status, real-world language, error prevention and minimalist design to assess the arrival copy and financial outcomes. It is broad heuristic guidance, not MINT-specific user research.
- [Nielsen Norman Group — Severity Ratings for Usability Problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/): severity considers frequency, impact and persistence. Frequency is unknown for all source-supported findings here.
- [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/): reference for contrast, reflow, keyboard access, focus, time limits and status handling; no full conformance audit was possible.
- [W3C — Target Size (Minimum), SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): distinguishes AA’s 24 × 24 CSS px minimum and its exceptions from the app’s 44 px usability target.
- [W3C — Accessible Authentication (Minimum), SC 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html): supports paste/autofill-compatible OTP entry; it does not verify MINT’s provider behavior.
- [W3C — Status Messages, SC 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): status changes should be exposed programmatically without moving focus.
- [Baymard — Mobile Checkout Usability Considerations](https://baymard.com/research-articles/mobile-checkout): general checkout guidance is adapted here only for clear totals, error recovery and uncertain payment states. MINT must keep verified-student authentication; guest checkout is not recommended.

### Open decisions that materially affect the product

1. **Arrival authority conflict:** User constraint and version 1.1 say only the student’s app geolocation can confirm arrival. The 11 October frontend handoff, current copy, `src/modules/operations.ts`, and a workflow test say a staff QR scan also checks in. The user already made the app-only rule explicit for this audit; implementation should follow it. Remove the scan-side `recordArrival` mutation and revise the conflicting tests. No staff-assisted arrival or override is proposed here.
2. **Credit versus refund ownership:** The specification says same-canteen credit may be policy-dependent and asks operators to define refund authority. For each resolution reason, define whether funds go to the original payment method or become same-canteen MINT credit, who approves it, when it is posted, and what status the UI may claim.
3. **Post-arrival collection expiry:** The spec says an overdue arrived portion needs staff review until food-specific policy is agreed. Confirm what the manager’s 15-minute extension means and the maximum/repeat rules. It must not change arrival status.
4. **Walk-in inventory:** The current PWA exposes online availability only; walk-in sales are in a separate system. Confirm whether there is an operational quota or reconciliation process before presenting online availability as a view of total physical stock.
5. **OTP configuration:** Confirm provider-supported validity, cooldown, attempt limit, resend and superseded-code behavior against the live Auth configuration; the UI text alone cannot establish these rules.
6. **Physical site/device constraints:** Validate each canteen’s location radius/accuracy, camera devices, network coverage, screen brightness/QR scan distance and actual counter naming on site. Browser simulation is not a substitute.

## Areas requiring a later runtime audit

When the app can be opened in a safe demo environment, repeat the coverage matrix with student, delegate, serving-staff and manager accounts. Add cashier only if that role exists in the separate walk-in system and is explicitly in scope. Capture 360/390/768/1440 px layouts; test OTP paste/resend/expiry, interrupted provider return without a real charge, geolocation permission/retry, partial collection, repeated and wrong-station scans, camera denial, offline/reconnect, dialogs/keyboard focus, 200% text and 400% zoom. Test real campus GPS and camera behavior on physical devices. Until then, this report remains a code-supported audit with an explicit runtime-access limitation.
