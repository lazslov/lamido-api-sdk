# @lazslov/auth

## 1.0.2

Verified against knowledge base `2d959d2`: content-service `0048426`, invoice-service `706dc63`,
payment-service `e3828d2`, auth-service `97d9934`, booking-service `aa69aca`,
email-service `23051b9`, webshop-service `b8b1693`.

### Patch Changes

- Re-pin the booking and webshop contracts after four more upstream fixes. No public surface changes in any package.

  - **booking-service `ac0e373` → `aa69aca`.** `hold_expired` and `already_confirmed` are documented at `422` rather than `409` — both are raised through `wrongState`, which is `status: 422`. A client generated from the old contract and branching on `409` for either code would never have matched. The tenant confirm's `409` response is gone: it documented that one code and the route reaches no other conflict.
  - **webshop-service `525fe1e` → `b8b1693`.** Four schemas were written from the database tables rather than from the serializers that fill them, so the generated types now read `fingerprint` (not `secret_fingerprint`) on a webhook endpoint, `event_id` (not `public_id`) on a webhook event, `endpoint_public_id` / `endpoint_url` (not `endpoint_id` / `url`) on a delivery, and `payload` rather than `shop_id` on a job. `GET /v1/admin/shops` also gained the `without_payment_credential` parameter, which was declared and never referenced.

  Every one of those is admin-tier, and `@lazslov/webshop` is storefront-only — so nothing a consumer imports changes shape. The re-pin is what makes the packages' pinned contracts match the services again.

## 1.0.1

Verified against knowledge base `6e23aec`: content-service `0048426`, invoice-service `706dc63`,
payment-service `e3828d2`, auth-service `97d9934`, booking-service `ac0e373`,
email-service `23051b9`, webshop-service `525fe1e`.

### Patch Changes

- Re-pin every contract after the six upstream findings closed. No public surface changes in any package.

  - **booking-service `18846e1` → `ac0e373`.** The three cron `POST`s carry their own `operationId`s, so the generated schema gains `cronDrainJobsByHand`, `cronSyncCalendarsByHand` and `cronMaintenanceByHand` instead of aliasing the `GET`'s. The credential-shaped `bsk_` example is a `YOUR_` placeholder.
  - **webshop-service `529003d` → `525fe1e`.** The generated `CartLine` declares all eleven members the service sends, and `billing_address` reads `Address | null` rather than an `allOf` intersection that erased the `null`. The package's own hand-written `CartLine`, `Order` and `CheckoutInput` are unchanged — they already had the corrected shapes — so nothing a consumer imports moves.
  - **auth-service `bbeb4d4` → `97d9934`.** Provenance only; the contract itself did not move.

  `scripts/lib/dedupe-operations.ts` is deleted: a regeneration against all seven contracts now drops nothing. It is removed rather than kept as a guard because it dropped a byte-identical repeat **silently**, which is how the defect it worked around survived a phase. `redactExampleCredentials` stays, and reports what it rewrote on every import.

## 1.0.0

Verified against knowledge base `714f2ee`: content-service `0048426`, invoice-service `706dc63`,
payment-service `e3828d2`, auth-service `bbeb4d4`, booking-service `18846e1`,
email-service `23051b9`, webshop-service `529003d`.

### Major Changes

- The first release. The `apk_` browser tier (magic link, Google, invitations), the `ask_` client tier (authorize, permissions, entitlements, customers, session verify, tenancy), the webhook verifier, and the route handler on `@lazslov/auth/next`.
