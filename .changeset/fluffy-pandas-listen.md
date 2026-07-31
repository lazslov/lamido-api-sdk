---
"@lazslov/api-core": minor
"@lazslov/content": minor
"@lazslov/invoice": minor
"@lazslov/payment": minor
---

Raise the minimum supported Node from 18.17 to 20.19.

Node 18 was never actually able to run the signature-verification paths: it exposes
`globalThis.crypto` only under `--experimental-global-webcrypto`, so `verifySignedBody`,
`verifyRevalidationWebhook` and `verifyPaymentWebhook` all threw there. The unflagged global
arrives in Node 19. The old `engines` field promised support that did not exist.

If you are on Node 18, upgrade to 20.19 or newer. Nothing else changed: no export was added,
removed or renamed, and no behaviour differs on a runtime that already worked.
