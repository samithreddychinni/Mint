# MINT frontend implementation handoff

**Date:** 10 October 2026

**Workspace:** `/run/media/samithreddy/Projects/mint`

**Purpose:** Let another model finish the frontend without repeating discovery or changing the design direction.

## 1. Start here

Read this document before editing application files.

1. Read the root `AGENTS.md`.
2. Read the files listed in section 4.
3. Open [the visual target](./visual-target.svg).
4. Read the remaining tasks in section 12.
5. Complete those tasks in their listed order.
6. Run the checks in section 13.
7. Report actual results and remaining limits.

The replacement frontend now exists. The layout and workflow fixes listed below have been implemented. Real-device and live-provider checks remain.

**Continue the current replacement. Do not restart the application again.**

This document was updated after implementation continued. Use the current status in section 10. Do not repeat completed tasks.

**Latest scope correction:** Walk-in sales use a separate system. This PWA has no cashier or billing workspace. Managers update online availability. Serving staff scan pickup passes, hand over permitted portions, and confirm what they gave. A manager is a staff account, but serving accounts cannot change stock.

### Source priority

Use this order when instructions conflict:

1. The user's latest instructions.
2. This document's frontend requirements and acceptance criteria.
3. Existing backend contracts and security rules.
4. The workspace specification's business rules.
5. Existing frontend styling and historical design notes.

This document does not authorize changing a backend rule to satisfy a screenshot.

## 2. What the user actually wants

The user wants a campus canteen PWA that behaves like an installed app.

- Make ordering and pickup the main tasks.
- Use Amrita University's colour scheme.
- Provide a home-screen installation popup.
- Keep the application frame fixed within the viewport.
- Keep screens functional on phones and desktop browsers.
- Reduce unnecessary taps, explanations, and visual clutter.
- Keep the design warm and personal through typography and small illustrations.
- Preserve all eight business steps in section 3.

The user initially requested no page scrolling. They subsequently asked the implementer to research and choose the appropriate behaviour.

**Selected behaviour:** The browser document does not scroll. Content panels can scroll vertically when their content exceeds the viewport.

Keep the header, primary navigation, and applicable primary action visible. Do not paginate a short food menu merely to prevent scrolling.

At small heights or large text sizes, allow the content panel to scroll. Never clip controls to satisfy the viewport requirement.

### Visual decisions versus user approval

The user specified the product behaviour and Amrita theme. They did not approve a final screenshot.

The dimensions, typography, and layouts below are the selected implementation contract. Use them consistently instead of inventing another design.

## 3. Business behaviour that must remain intact

| Step | Required behaviour |
| --- | --- |
| Menu publishing | Authorized staff publish items, prices, counters, and available quantities. |
| Ordering | A student chooses Main, IT, or MBA. One cart belongs to one canteen. |
| Checkout | The server validates prices, reserves quantities, and verifies payment. |
| Receipt | Show a confirmed receipt only after the server confirms payment. |
| Arrival | Accept fresh student geolocation or an authenticated staff scan of a valid pickup pass. |
| Arrival deadline | Show the 25-minute target and final deadline after five minutes of grace. |
| Expiry | Eligible unarrived portions become the payer's same-canteen credit. They do not create a bank refund. |
| Pickup | Staff scan a pass, inspect permitted portions, and confirm only portions physically handed over. |
| Preparation | Unfinished items retain their pending tokens. Staff can process another student immediately. |
| Completion | An order finishes only when every portion reaches its final state. |
| Friends | The payer selects portions and invites a verified friend. Acceptance transfers pickup rights. |
| Delegation | Acceptance creates neither another payment nor another preparation task. |
| Authentication | Students use university-email OTP. Staff use separately assigned accounts. |

Do not describe online ordering as priority in the serving queue. It skips the billing queue.

Arrival is recorded by either accepted student geolocation or a valid pickup-pass scan by an assigned serving account. Do not add a separate staff arrival-confirmation action or accept a location on the student's behalf. A reference/email lookup alone must not record arrival.

Do not infer dietary, allergy, opening-hour, or preparation-time claims from item names.

## 4. Repository map and current state

| File | Read or change for |
| --- | --- |
| `src/components/mint-app.tsx` | Existing API integration, state, authentication, and all application screens. |
| `src/components/install-prompt.tsx` | New installation dialog and browser installation handling. |
| `src/app/globals.css` | Theme, screen layouts, responsive rules, and viewport ownership. |
| `src/components/ui/button.tsx` | Existing button component and variants. Reuse it. |
| `src/components/ui/input.tsx` | Existing input component. Reuse it. |
| `src/components/ui/badge.tsx` | Existing status component. Reuse it. |
| `src/app/layout.tsx` | Metadata, PWA theme, and root application mounting. |
| `src/app/[...screen]/page.tsx` | Allowed application routes. |
| `src/app/api/[...path]/route.ts` | Authoritative API payload validation. Read before changing a caller. |
| `src/modules/catalogue.ts` | Response shapes and role-filtered data. |
| `src/lib/fulfillment.ts` | Shared order summary and final-state rules. Reuse these functions. |
| `public/manifest.webmanifest` | Installation metadata and icon paths. |
| `public/sw.js` | Offline fallback and caching policy. |
| `public/offline.html` | Offline launch screen. |
| `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png` | Matching MINT application icons. |
| `tests/browser/frontend.spec.ts` | New isolated frontend workflow tests. |
| `tests/browser/navigation.spec.ts` | Isolated navigation, role, and manifest checks. |
| `tests/browser/app.spec.ts` | Existing connected browser tests. These use real configured accounts. |
| `tests/browser/external-pickup.spec.ts` | Existing external-payment workflow tests. Inspect before execution. |
| `localnotes/Campus_Canteen_System_Specification.md` | Detailed business context. This directory is ignored by Git. |

### Existing implementation

The replacement includes these features:

- Burgundy theme with warm neutral surfaces.
- Compact student menu with Main, IT, and MBA selection.
- Search, readiness filtering, stock display, and quantity controls.
- Checkout policy, credit selection, and existing payment integration.
- Pickup detail with counter grouping, portion states, passes, and delegation.
- Account, credit, serving, and manager-only stock views.
- Fixed application frame with internal content scrolling.
- Installation dialog with native and manual installation paths.

The old frontend's API handling was preserved where practical. The staff UI is restricted to the requested stock and pickup tasks.

`mint-app.tsx` remains large. Do not start an unrelated architecture rewrite. Extract a component only when that extraction directly simplifies a required fix.

### Working-tree rules

The repository contained many staged files before this frontend task. Preserve those staged files and unrelated changes.

Do not run `git reset`, `git clean`, database seeding, migrations, account provisioning, or deployment as frontend cleanup.

Do not print `.env.local`, credentials, payment keys, or account passwords.

The framework generated the root `AGENTS.md` during `next dev`. Follow it. Do not treat it as a user-authored design specification.

## 5. Visual contract

### Palette

Amrita's official branding page specifies **RGB 164, 18, 63 / HEX #A4123F**.

Source: [Amrita Vishwa Vidyapeetham branding](https://www.amrita.edu/branding/).

Use the following complete UI palette. Only the primary burgundy is an official university colour. The other values are interface choices.

| Token | Exact value | Usage |
| --- | --- | --- |
| Primary | `#A4123F` | Primary buttons, selected canteen, brand mark, active navigation. |
| Primary hover | `#891036` | Hover and pressed emphasis. |
| Background | `#FAF8F7` | Application canvas. |
| Surface | `#FFFDFB` | Cards, fields, tickets, and dialogs. |
| Text | `#292329` | Main text. |
| Secondary text | `#756B70` | Supporting text. Check contrast at its rendered size. |
| Accent surface | `#F7E8ED` | Selected tabs, notices, and secondary emphasis. |
| Border | `#E8DFE2` | Subtle separation. |
| Success | `#39734C` | Accepted check-in and ready status only. |
| Warning | `#926019` | Preparation and deadline warnings. |
| Error | `#A83E2F` | Failed actions and destructive intent. |

Remove leftover green-theme backgrounds and brand accents. Small green food details and success indicators are acceptable.

Keep QR codes dark on white. Never place decorative textures behind a QR code.

Do not use the university's crest as the MINT logo. Keep the custom MINT mark and university context separate.

### Typography and spacing

| Element | Phone | Desktop |
| --- | --- | --- |
| Page title | Georgia, 30px, normal, line-height 1.15 | Georgia, 34px, normal |
| Section title | System sans, 18–20px, weight 600 | Same |
| Food name | System sans, 16px, weight 600 | 18px |
| Body | System sans, 14px, line-height 1.5 | Same |
| Supporting text | 12px minimum | 12px minimum |
| Input text | 16px minimum | 16px |
| Icon | 18–22px | Same |
| Main horizontal padding | 18px | 38px |
| Section gap | 12–16px | 18–22px |
| Card corner radius | 12–14px | 14–16px |
| Primary button height | 52px | 52px |
| Interactive target | At least 44 × 44px | At least 44 × 44px |

Do not retain the draft's 7–10px informational labels. If the text matters to a decision, it must be readable.

Use a thin border before adding a shadow. Reserve stronger shadows for dialogs and the cart action.

Use the existing local SVG food illustrations. Do not add stock photography, remote fonts, hero imagery, gradients, or animation libraries.

Illustrations are decorative. Use `aria-hidden="true"` on decorative SVGs.

### Exact application frame

Use `100dvh` for the root application height. Keep `html` and `body` from scrolling.

Make the root a column layout:

1. Header: fixed flex item, 60px on phone and 68px on desktop.
2. Content: flexible item with `min-height: 0`.
3. Phone navigation: fixed flex item, approximately 70px plus bottom safe-area padding.

On desktop, place navigation in the header area. Do not add a large sidebar.

Keep the total desktop content width at or below 1160px. Center the application content.

Use safe-area insets for installed devices. Account for the on-screen keyboard without hiding form controls.

**Overflow ownership:**

- Menu: Only the item grid scrolls at normal phone heights.
- Long forms and details: The screen content panel scrolls.
- Dialog: Only dialog content scrolls if required.
- Small landscape screens and enlarged text: The content panel can scroll as a fallback.
- Header and primary navigation: Never scroll with content.
- Browser document: Never scroll.

Do not combine a vertically scrolling card with a vertically scrolling list around that card.

Do not apply `overflow: hidden` to content merely to hide an overflow defect.

## 6. Screen contracts

### Sign-in

Order the content as follows:

1. Compact MINT header.
2. Small decorative illustration, maximum 112px high on phones.
3. `Sign in` heading.
4. Student / Staff sign-in control.
5. Required fields.
6. Primary action.
7. University context in small supporting text.

Hide the illustration at short viewport heights. Keep the form accessible with the keyboard open.

Student steps: email → send code → six-digit code → verify.

Staff steps: assigned email + password → sign in.

Retain OTP autocomplete and numeric input. Explain invalid, expired, and delivery-failed codes beside the form.

Do not ask the user to choose an authorization role during registration.

### Menu

Use this exact vertical hierarchy:

1. `What sounds good?` title and one short supporting sentence.
2. Three equal canteen buttons: Main, IT, MBA.
3. A compact active-pickup shortcut, only when applicable.
4. `On the menu` label and current item count.
5. Search field.
6. `All items` and `Ready now` controls.
7. Internally scrolling item grid.
8. Cart action above navigation, only when the cart contains items.

Use two item columns on phones from 360px wide. Use one column below 360px if controls cannot fit.

Use three item columns on desktop. Keep every price and quantity control fully inside its card.

Each card contains:

- A decorative food illustration, approximately 88px high on phones.
- A textual readiness label.
- Counter name.
- Item name.
- Optional staff note.
- Available quantity or paused/sold-out status.
- Price and a quantity control.

Use content-sized grid rows. Never shrink a card below the height its controls require.

Do not infer availability from the illustration. Disable addition for unavailable, paused, offline, or limit-reached items.

The checkout API allows at most 20 portions per item. Match that limit in student quantity controls.

When the user changes canteens with a nonempty cart, request confirmation before clearing the cart.

Keep the cart during navigation between student screens. Do not persist private order data to public caches.

### Cart and checkout

Show item quantities, unit totals, canteen, and serving counters.

Keep one primary action: `Place order`. Display the payable amount next to that action.

Place the checkout action in a persistent action area on phones. Reserve layout space for it.

Show these facts before payment:

- Arrival target: 25 minutes.
- Final arrival deadline: five additional minutes of grace.
- Fresh phone location is required for check-in.
- Eligible expiry/cancellation creates same-canteen credit, not a bank refund.
- Preparation and serving waits can still occur.

Allow same-canteen credit only when a balance exists. Show credit used and online payment separately.

Retain the checkout idempotency key during uncertain retries. Obtain explicit acceptance when prices change.

If payment outcome is uncertain, show the existing order. Do not encourage another paid order.

### Order list

Provide `Active pickups` and `Past orders` tabs.

Show pending invitations before the order list. Each invitation shows portions, counters, deadline, Accept, and Decline.

Each order row shows canteen, reference, fulfillment status, and applicable arrival deadline.

Separate pending payment, confirmed payment, and completed collection in the wording.

Use `fulfillmentSummary` and `isClosed`. Do not duplicate their rules inside a new component.

### Pickup detail

Make pickup the primary task. Use this phone layout:

1. Back control and order reference.
2. Arrival status and deadline.
3. Primary check-in or pass action.
4. `Pickup`, `Share`, and `Receipt` tabs when all content cannot fit comfortably.
5. The selected tab's content panel.

These tabs are implemented. Keep them instead of restoring one long detail panel.

The `Pickup` tab groups portions by counter. Each portion shows its item, token, collector, and current state.

Use plain labels: `Awaiting prep`, `Preparing`, `Ready`, `Collected`, and `Canceled`.

Show an accepted arrival only after a successful server response. Do not use the absence of assigned portions as proof of arrival.

For a payer who delegated every active portion, show `Pickup assigned to friends` instead of `You're checked in`.

Display each friend's arrival separately when the payer can see that data.

The `Share` tab lets the payer select portions and enter a verified friend's email. Show the selected portion count.

Explain that rights transfer after acceptance. Keep the original payment and preparation task.

The `Receipt` tab shows payer-only financial details. A delegate must not see another person's payment details.

Put QR passes in a focused panel or dialog. Show the counter name and collector requirement above each QR.

Keep expired, canceled, or transferred rights from appearing as valid pickup authorization.

### Serving staff

Default to the serving workspace for a serving-only account.

Keep the assigned counter selector visible. Offer `Scan pickup` and `Pending items` tabs. The second tab retains only made-to-order preparation jobs, not a billing queue.

The scan flow is:

1. Start camera. Keep pasted QR text and reference/email lookup inside the collapsed `Camera not working?` recovery section.
2. Resolve the pass through the server.
3. Show the assigned pickup name and permitted portions. The pickup person may be a verified friend, and does not need to be the payer.
4. Select only the portions physically handed over.
5. Confirm handover.
6. Select `Next pickup` immediately.

Scanning a valid pass automatically records arrival for that collector's outstanding portions in the same order and canteen, including other serving counters. It must not record arrival for friends or confirm handover. Show order details immediately after scanning. Repeated scans must not extend collection deadlines. Expired/revoked passes and unauthorized or wrong-counter scans must not record arrival.

Keep unfinished made-to-order portions in `Pending items` with their existing tokens. Also show `Start [item]` and `Mark [item] ready` directly beside scanned items. Ready stock does not appear in this preparation list. To hand over a prepared item, scan the student’s QR again. Refresh scanned portion states after preparation; do not leave the checkbox disabled after an item becomes ready.

Keep preparation and handover actions separate. Preserve portion versions and handover idempotency keys.

Stop the camera when leaving the scanner, changing counter, or signing out.

### Staff roles and stock

There is no cashier workspace. Walk-in billing belongs to a separate system. Do not add sale entry, cash collection, payment-method fields, walk-in receipts, or cashier navigation.

The backend can retain its existing cashier API for compatibility. It is not exposed through this frontend. `/cashier` is not an application route.

Serving accounts see Serving and Account. They can inspect passes, confirm selected physical handovers, retain pending tokens, and process the next student. They cannot edit stock.

Managers see Stock, Serving, and Account. Manager stock access uses the existing canteen assignment. The server must reject serving accounts and students, even if they send a stock request manually.

The manager stock screen has:

1. `Available stock` heading and assigned-canteen selector.
2. One card per configured item, with item name, counter, price, and current online availability.
3. A whole-number quantity field from 0 to 10,000 and a `Save` button.
4. A disabled Save button when nothing changed or the app is busy or offline.
5. A `Review latest stock` action when availability changed after editing started. Preserve the desired quantity until the manager reviews the updated count.

A quantity means portions available for **new online orders**, excluding existing holds and paid commitments. Save sets an absolute available count; it does not add that count to existing stock.

The backend adjusts free batches in its existing canteen transaction. It preserves held and committed quantities, records an audit event, and retains the same retry key when a response is uncertain. Stale observations must return `STOCK_CHANGED` before any adjustment.

There is no manager operations dashboard, financial report, scope-assignment form, geofence editor, or billing workspace in this frontend. Those backend capabilities can remain available to separate administrative tooling.

The user has now requested item editing. Each card has a pencil button. Only that button opens name, price, note, availability status, and default-quantity fields. `Save item details` uses the manager-only `item-settings` action with an optimistic settings snapshot. Reject stale edits as `ITEM_CHANGED`. Changing an item must not rename or reprice previously paid portions. The default quantity is a saved baseline, not an automatic daily reset. `Use default for stock` copies it into the availability field; the manager must still save that count. There is no automatic stock reset or item readiness-mode change.

### Account and credit

After verified student sign-in, require a name and mobile number once when the private profile has no `completed_at` value. Validate and normalize Indian mobile numbers on the server. Email OTP remains the identity check; the phone number is not SMS verified. Only `/api/me` returns the signed-in user’s private profile. `/api/profile` can update only the authenticated actor, not a client-supplied ID or role. Account allows later edits.

Keep Account compact: identity, editable profile, canteen credit, installation action, help, and sign out. The student header bell opens live in-app order progress and pickup invitations. It uses the existing dashboard polling and is not background push. Do not claim closed-app notifications work.

Campus delivery remains a proposal. Read [CAMPUS_DELIVERY_PROPOSAL.md](CAMPUS_DELIVERY_PROPOSAL.md) before implementation. The user approved 10% same-canteen credit rewards and six destination names, but requested a written design first. No delivery charges or rights transfers for delivery are currently enabled.

Credit shows one balance per canteen. Show reserved credit separately from available credit.

Keep credit activity in its own panel. Do not describe credit as bank money or transferable funds.

## 7. Installation behaviour

Use the existing `InstallPrompt` component as the starting point.

- Show an installation popup after eight idle seconds on an authenticated Menu or Account screen when the native prompt is available or iOS instructions apply. Otherwise, wait 30 idle seconds to give Chrome time to become installable.
- Do not open the popup during payment, scanning, check-in, or form submission.
- Keep a manual `Install MINT` action available when installation remains possible.
- Do not show installation controls in standalone mode.
- If `beforeinstallprompt` exists, call its `prompt()` only after a user click.
- If no native prompt exists, show the appropriate browser instructions.
- On iOS, show Safari Share → Add to Home Screen instructions.
- Let the user dismiss the popup and continue in the browser.
- Remember dismissal for seven days using the existing non-sensitive preference key and a timestamp. Treat the old permanent `1` value as expired.
- On Android Chrome, explain ⋮ → Add to home screen → Install, and the regular-tab requirement. Do not imply the app can force a native prompt before Chrome offers one.
- Keep native dialog focus behaviour and Escape dismissal.
- Close the dialog after installation or a transition into standalone mode.

Use this visible copy:

- Heading: `Add MINT to your home screen`
- Description: `Open your menu and pickup passes in one tap.`
- Primary action: `Add to home screen`
- Secondary action: `Keep using the browser`

Use functional installation copy. Remove the draft's promotional `ONE TAP FROM YOUR NEXT BREAK` text.

Handle unavailable storage and failed installation requests without blocking ordering.

An accepted native prompt is not proof that installation completed. Use `appinstalled` or standalone detection for installed state.

## 8. API contracts to preserve

All paths below have the `/api/` prefix. Read the route implementation for complete validation.

| Method and path | Frontend responsibility |
| --- | --- |
| `GET catalogue` | Load canteens, counters, items, quantities, and server time. |
| `GET me` | Load identity, private own profile, roles, orders, credit, and invitations. |
| `POST profile` | Update the authenticated actor’s name and mobile number; never accept another user ID or role. |
| `POST auth/request` | Send `{ email }`. |
| `POST auth/verify` | Send `{ email, token }`. |
| `POST auth/password` | Send assigned-account credentials. |
| `POST auth/logout` | Clear authenticated state after successful sign-out. |
| `POST checkouts` | Send canteen, item IDs, quantities, observed prices, credit, and retry key. |
| `GET orders/:id` | Read receipt, visible portions, invitations, and resolutions. |
| `POST orders/:id/payment-setup` | Resume the existing payment setup. |
| `POST orders/:id/payment` | Send provider result for server verification. |
| `POST orders/:id/check-in` | Send latitude, longitude, accuracy, and sample timestamp. |
| `POST orders/:id/passes` | Request current passes for the current collector. |
| `POST orders/:id/invite` | Send selected portion IDs and friend email. |
| `POST orders/:id/cancel` | Send selected portion IDs. |
| `POST orders/:id/return` | Return selected delegated pickup rights. |
| `POST invitations/:id` | Send `accept`, `decline`, or `withdraw`. |
| `GET staff/worklist?station=:id` | Read the assigned counter's worklist. |
| `POST staff/resolve` | Resolve pass or reference plus collector within a counter. |
| `POST staff/handover` | Send counter, selected portion IDs and versions, and retry key. |
| `POST staff/preparation` | Send portion ID and `start` or `ready`. |
| `POST manager/:canteen` | Manager-only stock override or `item-settings` edit. Stock uses `expectedAvailable`; settings use `expectedSettings`; both retain their retry key. |

Amounts use integer paise. Convert to rupees only for display or explicit rupee-entry fields.

Read deadlines from the server. Use the server-time offset for countdowns.

Request geolocation with `maximumAge: 0` and high accuracy. Preserve timestamp and accuracy in the request.

Do not cache receipts, passes, account responses, or mutation results in the service worker.

## 9. Interaction and accessibility rules

Every visible control must perform its named action or explain why it is disabled.

Use real buttons for actions. Use links for navigation.

Show loading, empty, error, offline, and successful states for each relevant screen.

Announce asynchronous results with an appropriate live region. Avoid moving the entire layout when a notice appears.

Use text with every status colour. Use visible focus outlines.

Preserve input focus during the five-second data refresh. Preserve the user's current selections unless rights actually changed.

Reset the screen content scroll position when navigating to a different route. Do not reset it during polling.

Keep the keyboard from covering the active input and submit control.

When an action fails, retain user input and show a useful retry path.

Clear private form values, passes, resolved collectors, and transaction retry keys after sign-out.

## 10. Current implementation status

### Completed

- Consolidated stylesheet, warm Amrita palette, readable labels, and 44px quantity targets.
- Fixed app frame and internal scrolling; long menus retain reachable controls.
- Persistent cart, checkout, and pickup-pass actions.
- Pickup, Share, and payer-only Receipt views; focused pass dialog.
- Correct empty-assignment arrival state and delegation privacy.
- Fresh-location error messages and unchanged check-in API contract.
- Route scroll reset, scanner cleanup, sign-out cleanup, and action submission guard.
- Explicit price acknowledgement after refreshing the catalogue; uncertain checkout retries keep their key.
- Installation copy, idle timer, native/manual paths, iOS instructions, dismissal, focus return, and standalone suppression.
- Walk-in billing removed; manager-only absolute stock editing replaces the broad operations workspace.

### Verification record

The isolated browser suite uses mocked API responses. It does not prove live OTP, provider payment, or camera operation.

Final checks after the staff scope change, on 10 October 2026:

| Check | Result |
| --- | --- |
| Isolated browser suite | **21 passed** in 32 seconds. Includes the manager stock editor, six viewport sizes, price acknowledgement, checkout retries, pickup privacy, partial handover, and installation fixtures. |
| Focused manager-stock database tests | **2 passed**. Verified manager-only authorization, protected held/paid portions, stale-observation rejection, retry idempotency, and concurrent checkout. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed without warnings. |
| `npm run build` | Passed. |
| `git diff --check` | Passed. |

Manager-stock database tests use temporary, isolated fixtures and remove them afterward. They do not change the configured Main, IT, or MBA menus.

### Still needs verification

Deployment update, 10 October 2026: the app is hosted on Vercel and its API on Render. See [the deployment record](../DEPLOYMENT.md). All 21 isolated frontend checks passed on the public host. Actual university-email OTP, a captured Razorpay test payment with callback verification, paid pickup, and the connected delegation/preparation/complete-collection flow passed. Gateway failures now show a recovery message, and the password helper text is an accessible description rather than part of the label.

Arrival/install correction, 11 October 2026: a valid staff scan now records arrival automatically and opens portions. Handover remains separate. All 23 isolated frontend checks passed on the public host; four focused database checks and a live scan/geolocation/preparation/handover workflow passed. Production uses the user's three campus map pins recorded in `docs/DEPLOYMENT.md`. The Android install popup waits for browser readiness and provides Chrome instructions. The user confirmed installation works in Chrome on a OnePlus Nord 2. Verify GPS, camera scanning, and installed-app layout on the physical phone; do not restore the old location-only arrival rule.

- Installation on other Android devices and iOS Safari; installed-app safe areas and browser chrome.
- Real keyboard opening, orientation changes, 200% text/zoom, and assistive-technology navigation.
- Physical camera scanning and permission denial.
- Provider-origin webhook delivery, live payment credentials, and closed-checkout recovery on a phone.
- Physical preparation/pickup flow on a phone. Isolated browser coverage now includes start → ready → handover for a shared recipient.
- Screenshots of every screen, including empty/error/loading states, with visual inspection.

Do not mark these complete from mocked tests or a resized desktop browser.

## 11. Visual references

[Open the visual target](./visual-target.svg).

The target shows six illustrative phone screens at **390 × 844 CSS pixels**. Sample food and money values are mock data.

Use its hierarchy, burgundy emphasis, compact spacing, persistent navigation, and action placement.

Use Lucide icons in the application. The SVG uses simple symbols to indicate their positions.

Staff navigation must follow assigned roles. The serving-only reference shows Serving and Account.

Use section 5 for exact CSS values. SVG text rendering is a reference, not a browser-font pixel baseline.

Existing diagnostic captures are under `.local/`:

- `new-menu-mobile.png`
- `new-menu-desktop.png`
- `new-pickup-mobile.png`

Those captures are diagnostic evidence, not a pixel baseline. The latest captures use the fixed layout; use the SVG and section 5 for the design contract. Manager stock also has `.local/qa/manager-stock-390.png`.

Older green-theme and tall-page screenshots are obsolete. They are not the user's final target.

## 12. Remaining work, in order

### Task 1: Verify the narrowed staff scope

1. Confirm no cashier route, navigation, sale controls, or billing copy is exposed.
2. Confirm managers can edit only their assigned canteen's availability.
3. Confirm serving accounts cannot edit stock through the UI or API.
4. Confirm zero availability disables new student purchases.
5. Confirm stock changes preserve active holds and paid portions, reject stale observations, and do not repeat after a retry.
6. Keep the backend's unrelated administrative capabilities intact.

### Task 2: Complete device and accessibility verification

1. Use the viewport matrix in section 13.
2. Test real keyboard resizing, safe areas, and orientation changes.
3. Test enlarged text and zoom, including the manager quantity editor.
4. Capture and inspect every student and staff screen.
5. Correct reproduced clipping or focus problems. Do not redesign completed screens.

### Task 3: Verify connected workflows

1. Read connected-test setup and mutations before execution.
2. Verify student OTP, external payment/resume, fresh-location check-in, accepted delegation, and current passes.
3. Verify camera scan, partial physical handover, preparation readiness, and immediate next pickup.
4. Verify order completion and same-canteen credit from server responses.
5. Verify installation on physical Android and iOS devices.

### Task 4: Final checks and status

1. Run typecheck, lint, production build, and the isolated browser suite.
2. Run the focused manager-stock database tests when the fixture database is configured.
3. Record actual results in section 10.
4. Report remaining checks accurately. Do not claim device or provider verification from fixtures.

## 13. Verification procedure and completion criteria

### Commands

Run from the workspace root. Reuse an existing development server if it is healthy.

```bash
npm run dev
```

Run checks in another terminal:

```bash
npm run typecheck
npm run lint
npx playwright test tests/browser/navigation.spec.ts tests/browser/frontend.spec.ts tests/browser/pwa.spec.ts --timeout=40000
npm run build
```

Installation and six viewport checks are included in the isolated suite.

Focused database check (uses isolated temporary fixtures):

```bash
npx tsx --env-file=.env.local --test --test-name-pattern="manager stock updates" tests/workflows.test.ts
```

Do not run the entire connected browser suite without reading its setup and mutations. Several tests create real configured workflow records.

Do not claim live-provider verification from mocked API tests.

### Required viewport matrix

| Viewport | Purpose |
| --- | --- |
| 390 × 844 | Main phone target. |
| 360 × 740 | Smaller Android phone. |
| 320 × 568 | Narrow-screen fallback. |
| 844 × 390 | Landscape phone. |
| 768 × 1024 | Tablet. |
| 1440 × 900 | Desktop. |

Test enlarged text and browser zoom. Retain zoom support.

### Required browser assertions

- The document height does not exceed the visible viewport through normal app layout.
- The document has no horizontal overflow.
- The header and navigation remain visible while content moves.
- The last item and its controls remain reachable in a long menu.
- The cart action does not cover the last item.
- The on-screen keyboard does not make submission impossible.
- Student views do not show staff controls.
- Staff views show only assigned counters and canteens.
- Offline state blocks purchases, payments, check-in, delegation, and handover.
- Price changes require explicit acknowledgement.
- Checkout retries retain the same retry key when the outcome is unknown.
- Location requests use a fresh sample.
- Partial pickup retains unfinished portions.
- Delegation sends exactly the selected portion IDs.
- A delegate does not see payer-only financial data.
- Sign-out removes private state.
- Installation never blocks browser use.
- No uncaught browser errors occur during the tested flows.

### Screenshot acceptance

Capture each screen in the main phone viewport. Also capture desktop Menu and Pickup.

Use a long menu fixture, a multi-counter order, a pending invitation, and at least one unavailable item.

Exclude development-tool overlays from final reference captures where possible. Do not remove application functionality to obtain a clean screenshot.

The implementation is complete only when:

1. All listed isolated tests pass.
2. Typecheck, lint, and production build pass.
3. Every primary action is reachable and works against its API contract.
4. No content is silently clipped.
5. The visual output follows the palette and hierarchy in this document.
6. The final report distinguishes mocked checks from real-device and provider checks.

## 14. Research used for the selected behaviour

- [Amrita branding](https://www.amrita.edu/branding/): official primary colour `#A4123F`.
- [Material top app bars](https://m3.material.io/components/app-bars/): navigation controls remain distinct from moving content.
- [W3C Reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow): content must remain usable at narrow widths without lost information.
- Local Next.js PWA guide: `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`.

The fixed-frame decision is a design inference from these sources and the user's instructions. It is not an Amrita branding requirement.

## 15. Prompt to give the next model

> Continue the MINT frontend in this workspace. Read `AGENTS.md` and `docs/frontend/HANDOFF.md` first. Open `docs/frontend/visual-target.svg`. Follow the document's remaining task order, exact palette, screen hierarchy, and acceptance criteria. Managers alone update stock. Serving accounts scan and confirm pickup. Walk-in billing uses a separate system; do not add a cashier workspace. Preserve the existing backend contracts and staged work. Complete the pending verification and fix reproduced defects before adding anything. Do not repeat the completed layout rewrite. Do not replace the design, add dependencies, modify database rules, or claim checks you did not run. Complete the isolated tests, inspect screenshots, and report remaining real-device limits.

## Campus refinements, 11 October 2026

The user was testing location from an academic block, outside the canteen. Rejection there is expected; geofencing has not been widened or bypassed. A first staff scan now preserves the assigned collector name/email/reference when arrival rows are merged. The server permits an accepted friend to collect assigned portions; the payer and collector do not have to match. Scanned items show preparation controls, and ready checkboxes update after preparation. Manual QR/reference input stays collapsed under camera recovery. `Pending items` means unfinished preparation, not billing. Name, price, note, availability toggle, and default quantity open only from the manager pencil. Stock remains a manual absolute count with reservations protected. Profile data is private to the authenticated actor; entered phones are not SMS verified. Updates are in-app progress and invitations, not closed-app push.

Migration `0005_thick_vertigo` adds private profile phone/completion fields and a bounded item default quantity. It is additive and does not reset stock or rewrite existing orders. Nine focused workflow tests passed, including actual accepted-recipient scanning/handover, paid-order snapshots, stale manager edits, actor-only profile updates, protected stock, and preparation/concurrent-rights regressions. Supabase database security advisors reported no findings. The full prior workflow suite is not rerun for this change.

All 26 isolated frontend checks passed locally for these refinements. The public demo-credit workflow verified shared-recipient collection, name preservation on the first scan, no phone disclosure to staff, private profile updates, and complete order collection. Release `f7c5aa7` was healthy through both hosts. A small follow-up places the invitation indicator within the bell button; device GPS/camera and background push are still outside verified results.
