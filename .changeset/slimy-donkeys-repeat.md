---
"@lazslov/telemetry": patch
---

Deny `body` at emit time (OB-6 item 4).

The pattern now matches `body`, so a metadata member named `body` — or one ending in
`_body_excerpt` — is replaced with `[redacted]` like every other credential-shaped name.

Found while invoice-service adopted the standard. Its service-local deny-list carried
`body` before this package existed, and that list is where OB-6 item 4 came from: the
route `PUT /v1/admin/clients/:id/integrations` takes a plaintext provider secret in its
body, so one `log.info('upsert', { body })` would put a provider credential on stdout.
The name was lost when the mechanism moved here, which is the direction a consolidation
must not go — a shared implementation that redacts less than the service it replaced is a
regression every service inherits at once.

OB-6 item 2 already bans bodies outright. This is the emit-time net under that rule, for
the same reason the rest of the list exists: a rule that has to be re-obeyed at every call
site eventually is not.
