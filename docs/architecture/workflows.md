# Core workflows

This guide follows the durable state changes behind the user experience. The [technical reference](../TECHNICAL_REFERENCE.md) has exact schemas, endpoint contracts, deadlines, and failure rules.

## Sign-in and identity

Students request a six-digit code for an approved university email. Supabase Auth delivers and verifies the code, then gives the browser a session cookie. Staff use a provisioned identity and password. For a protected API call, the backend asks Supabase Auth to verify the current user, then loads or updates the MINT profile.

Identity type and canteen role answer different questions. Identity type determines whether the account is a student or staff identity. A role grants a staff identity actions at a canteen and, for serving staff, a station. The server checks this scope when it handles the action.

See [authentication and authorization](../TECHNICAL_REFERENCE.md#8-authentication-authorization-and-security) and [OTP template setup](../OTP_EMAIL_TEMPLATE.md).

## Checkout and payment

```mermaid
sequenceDiagram
    actor Student
    participant UI as Browser app
    participant API as API and order modules
    participant DB as PostgreSQL
    participant Pay as Razorpay
    Student->>UI: Submit cart and retry key
    UI->>API: Create checkout
    API->>DB: Validate policy; reserve stock and credit
    DB-->>API: Commit short-lived hold
    alt Credit covers total
        API->>DB: Confirm order and portions
    else External payment is due
        API->>Pay: Create provider order
        Pay-->>UI: Checkout details
        Student->>Pay: Approve payment
        Pay-->>API: Callback, webhook, or later reconciliation
        API->>Pay: Verify captured payment
        API->>DB: Confirm once or queue financial resolution
    end
```

The database transaction reserves inventory and wallet credit before MINT asks the provider to collect money. This prevents checkout from promising the same stock twice. A short hold can expire if payment does not complete. External payment cannot join a PostgreSQL transaction, so callback verification, signed webhooks, and scheduled reconciliation converge on an idempotent confirmation path.

The order is the payment container. Each portion is a separate unit with its own stock batch, price snapshot, collector, and fulfillment state. That allows a friend to collect one item while the payer collects another.

See [checkout and inventory](../TECHNICAL_REFERENCE.md#10-checkout-and-inventory-algorithm), [payment recovery](../TECHNICAL_REFERENCE.md#11-payment-verification-and-failure-recovery), and [concurrency and idempotency](../TECHNICAL_REFERENCE.md#15-concurrency-transactions-and-idempotency).

## Credit and missed pickup

Credit belongs to one student at one canteen. Each grant is recorded as a lot with its own expiry. Checkout allocates the earliest-expiring credit first and records which lots it reserved. Releasing a hold restores those allocations to their original lots, subject to each lot's expiry.

Eligible cancellation or a canteen-side failure returns credit according to the order's saved policy. For the current policy, a paid portion that expires without arrival returns 90% of its price to the payer's account. MINT records the remaining 10% as a fine. A portion that the student collected is not credited or fined. Portions that reached a staff-dependent state can require manager review.

The policy version is saved on the order. A later policy change must not silently change an existing order. See [wallet expiry and fine accounting](../TECHNICAL_REFERENCE.md#12-wallet-expiry-and-fine-accounting).

## Arrival, preparation, and handover

Each portion has a collector, station, state, and version. The collector can check in near the canteen, subject to the configured distance, reported GPS accuracy, and sample age. A serving worker can also scan a valid, scoped pickup pass to record arrival. A pass is a limited bearer token; a stored hash and portion versions support expiry and revocation checks.

Arrival permits fulfillment to continue. For made-to-order items, staff can start and complete preparation. For ready items, staff can proceed to handover. Handover confirms only the selected portions that the assigned station can serve. A name or order-reference lookup can help staff find an order, but does not prove arrival or authorize handover.

The student or payer may assign selected portions to a verified friend. Acceptance changes the collector and portion version. Old passes then fail their version check. The recipient gets pickup rights, not access to the payer's wallet or private receipt.

See [pickup, geofencing, QR, and delegation](../TECHNICAL_REFERENCE.md#13-pickup-geofencing-qr-and-delegation).

## Manager and serving operations

Serving staff see a station worklist and can act on portions at their assigned station. Cashiers can record scoped walk-in stock sales. Managers can inspect a canteen summary and perform audited menu, stock, geofence, role, pause, and exception actions. The server checks canteen and station scope for each protected action; the UI does not grant authority by hiding or showing a button.

Changes to stock or menu settings include expected current values. If another manager changed the row first, the stale edit fails instead of overwriting that update. Important mutations record an audit event with actor, reason, and source.

See the [endpoint and manager action reference](../TECHNICAL_REFERENCE.md#9-complete-endpoint-reference) and [manager summary](../TECHNICAL_REFERENCE.md#18-reporting-deployment-and-operations).

## Background recovery

Supabase Cron calls the private worker route on a short schedule. The route verifies a request signature, then runs one bounded tick. A tick expires old checkout holds, processes missed pickups, checks uncertain payments, retries queued refunds, and records worker health. Database state makes each step safe to retry after a process restart.

The scheduler is not the same as the optional laptop health monitor. The worker changes business state; the monitor only requests the read-only health endpoint. See [worker and durable scheduling](../TECHNICAL_REFERENCE.md#16-worker-and-durable-scheduling) and [deployment operations](../DEPLOYMENT.md#laptop-health-monitor).

## Common failure paths

| Failure | Durable result | What the user or operator should expect |
| --- | --- | --- |
| Price or policy changed after the cart loaded | Checkout does not reserve stock | Refresh the menu and review the cart |
| Another order takes the last portion | Checkout transaction rejects the hold | Select another item or quantity |
| Payment result is unclear | Order remains eligible for reconciliation | Do not assume failure or pay again until the order refreshes |
| Payment captured after the hold cannot be restored | Financial resolution is queued | A refund attempt runs through the worker and remains auditable |
| Wrong station or expired pass | No handover occurs | Use an assigned station and a current collector pass |
| Browser loses network | No new order is queued | Reconnect and refresh durable server state |

The exact API error codes and retry conditions live in the [failure behavior reference](../TECHNICAL_REFERENCE.md#23-failure-behavior-reference).
