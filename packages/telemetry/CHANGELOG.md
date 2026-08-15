# @lazslov/telemetry

## 1.0.0

Verified against knowledge base `5191225`: content-service `ecf20fd`, invoice-service `3aa099f`,
payment-service `62a1799`.

**First published release, at `1.0.0` rather than in `0.x`.** A caret range does not cross a minor
below `1.0.0`, so `^0.2.0` refuses `0.3.0`: every rule this package gains would cost each service a
bump of its own. This package exists so one log envelope is shared across the estate, and drift
between services is the failure it prevents — a range that lets minors arrive on their own serves
that better than the caution `0.x` signals.

**Renamed from `@lamido/telemetry` before its first publish.** The repository had already settled
on the `@lazslov` user scope for every package — `@lamido` on npm resolves to an account that may
not be ours, and a user scope needs no organisation, no membership and no paid plan. This package
was added afterwards and did not follow it. `Lamido` stays where it names the **project**: the
repository, `LAMIDO_KB_PATH`, and the services. Nothing depended on the old name, and nothing was
published under it.

### Major Changes

- Implement OB-4 and OB-5, the two envelope rules the package shipped without.

  The observability house rules were merged as OB-1…OB-20 after this package was written against a
  draft. The numbering matches; two rules inside its own scope were not covered.

  - **OB-4 — `correlation_id`.** `telemetry.correlated(id, from?)` binds the id onto a logger so
    every line it writes carries it. Deliberately not part of `requestMiddleware`: a correlation id
    arrives in the **event envelope body**, not a header, so a webhook receiver only has it after
    parsing and no middleware can bind it for them. It is what turns "a payment succeeded, an
    invoice was issued, an email was sent" into one query.
  - **OB-5 — the flag vocabulary.** `LogMeta` now names the seven closed, estate-wide boolean flags
    — `alert`, `anomaly`, `security`, `unmapped`, `external_refund`, `recovered`, `fail_open` — so a
    typo in one is a compile error. `correlation_id` is typed too. The record stays open; only these
    members are named.

  OB-16…OB-20 are deliberately not implemented: they govern the vendor projection (Grafana rule
  files, probe topology) and the process for adopting a rule. Neither is an npm library's to carry.

  Nothing was removed, and no existing call site changes.

## 0.1.0

Initial release: the OB-1…OB-15 mechanics. The canonical log envelope (`time`, `service`,
`env`, `level`, `message`, emit-time redaction deny-list), the batched lossy sink with the
Grafana Loki adapter, `alert()` with the Telegram channel and the `alert: true` log
backstop, and the request middleware (`request_id` binding, `http.request` summary,
scheduled flush).
