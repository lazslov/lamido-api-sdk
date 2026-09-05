# Live testing — what to provision, and why

`pnpm test:live` is the only suite that proves the SDK's *understanding of the services* is
still true — the three original ones in depth, and the four phase 9 added through their refusals. Everything else proves something narrower:

| Suite | Proves | Cannot notice |
| --- | --- | --- |
| `pnpm test` | the SDK does what it was written to do | that a service changed |
| the pinned HMAC fixtures | the verifiers agree with a signer | that a signer changed |
| `pnpm test:live` | the services still behave as documented | nothing — this is the backstop |

> **RULE — verify against a real provisioned tenant, not against the code.** Two of the reference
> build's sharpest bugs were found only by pointing a site at a live dev tenant, and **a keyless build
> actively hid one of them.**

With no credentials the suite skips every case and says so loudly. It is green, and it is worthless —
which is exactly why it shouts.

---

## What actually needs deploying to Vercel, and what does not

Short answer: **almost nothing, while you are developing.** Most of what you might want to test runs
fine against a service on `localhost`. The release is the exception — the second row, kept next to
the first because the two differ only in where the suite runs from.

| What you want to verify | Needs a Vercel deployment? | Why |
| --- | --- | --- |
| The SDK's request/response contract with all three services (`pnpm test:live`), **run here** | **No** | Every assertion is an outbound call the SDK makes. A service on `localhost` answers them identically. |
| The same suite, **run by the release workflow** | **Yes — all three** | A GitHub runner cannot reach your laptop. A `localhost` secret fails every case with `ECONNREFUSED`, and because the suite sees the service as *configured* it fails the release rather than skipping. See below. |
| A revalidation webhook reaching a site's `/api/revalidate` | **No**, if both sides are local | content-service POSTs to every enabled webhook endpoint registered for the site. Register one at `http://localhost:3000/api/revalidate` and a local Next site receives it. |
| A PSP callback reaching payment-service | **No**, for this suite | The live cases create and read a payment; they never complete one through a PSP's hosted page. `refresh` is an *outbound* call and works from localhost. A callback would need a public `PUBLIC_BASE_URL`, which is only relevant to finishing a real checkout. |
| **`x-vercel-cache: HIT` on a mode-A route** | **Yes** | That header is produced by Vercel's edge and by nothing else. It is the only mechanical proof that a mode-A route is still statically rendered — the bug it catches is a latency and cost regression with no error, invisible in a diff, and hidden entirely by a keyless local build. |

So, **while you are developing**: run the contract suite locally, and deploy **one** thing — a Next
site that reads through `@lazslov/content/next`'s mode A — to prove the caching claim.
`examples/next-site` in this repository is that site; `devora` would do just as well and is more
realistic.

**When you release, that changes.** The release workflow runs the same suite from a GitHub runner,
so all three services need scratch tenants reachable over the internet, and the three base-URL
secrets on the `release` environment must name them rather than `localhost`. The `v1.0.0` release
failed on its first tag for exactly this reason — every case died on `ECONNREFUSED 127.0.0.1:3302`,
which is the local content-service port. Nothing published, because the live suite runs before the
publish step; the fix was three URLs, then a re-run of the same tag.

---

## The safety facts that decide how you do this

Read these before pointing anything at anything.

1. **payment-service's preview and production share one database and one base URL.** As deployed, no
   preview-scoped override exists for `DATABASE_URL` or `PUBLIC_BASE_URL` — so a payment created from a
   preview deployment is a **real production row**, and a PSP callback it provokes is delivered to
   production. Treat a preview as production, or scope it properly first (below).
2. **No environment can currently reach a real card.** `PAYMENT_PROVIDERS_ALLOW_LIVE` is unset, and
   unset means `false`, which makes the service refuse to construct a live PSP adapter at all. This is
   the one guard standing between a mistake and money.
3. **A payment's mode is a property of its credential.** There is no sandbox hostname and no
   `test: true` flag. Store a `mode: sandbox` credential and every payment under it is sandbox.
4. **invoice-service issues real documents.** A successful create is a real invoice at szamlazz.hu or
   Billingo and is reported to NAV. The only undo is a storno, which is itself a real document. The
   live suite therefore stops at failures raised *before* the provider is called.
5. **`POST /v1/admin/sites/{id}/pages/{slug}/publish` on content-service makes every unpublished draft
   on that page live.** No case in the live suite publishes. The one write case reads a value and
   patches it back unchanged.
6. **Changing `CREDENTIALS_ENC_KEY` is irreversible.** It makes every stored credential undecryptable.
   All three services now use that one name; content-service still boots on the old `SECRETS_ENC_KEY`
   for one release, with a deprecation warning. Generate once, store in the password manager, never
   "regenerate to be safe". content-service's `PREVIEW_TOKEN_SECRET` is the deliberate opposite:
   changing it revokes every outstanding draft-preview link and nothing else.

---

## Checklist

Everything below runs on this machine. The three service repositories are already cloned as siblings of
this one.

### 0 · A scratch database per service — do this first

Each service needs `DATABASE_URL`. Use a **Neon branch**, not the production database: a branch is a
copy-on-write fork, costs nothing, and throwing it away throws away every row these tests created.

- [ ] For each of the three Neon projects, create a branch named e.g. `sdk-live`.
- [ ] Copy the **pooled** connection string — the host must contain `-pooler.`. A direct endpoint runs
      out of connections under serverless fan-out, and every service's `db:check` warns about it.

### 1 · content-service

```bash
cd ../content-service
cp .env.example .env      # then fill in:
#   DATABASE_URL=<the sdk-live branch, pooled>
#   CREDENTIALS_ENC_KEY=$(openssl rand -base64 32)
#   PREVIEW_TOKEN_SECRET=$(openssl rand -base64 32)
#   BLOB_READ_WRITE_TOKEN=<from the linked Vercel Blob store>

pnpm db:check                                   # connectivity + the pooled-host warning
pnpm db:migrate
pnpm db:admin-key -- mint --label sdk-live      # capture the cad_…
SEED_ADMIN_KEY=cad_… pnpm db:seed -- sdk_live "SDK live probe" hu \
  --origins http://localhost:3000               # a bare site row + its csk_/cpk_ pair
pnpm dev                                        # http://localhost:3302, no Vercel CLI needed
```

- [ ] `curl http://localhost:3302/healthz` → `{"status":"ok"}`. That is the only unauthenticated
      endpoint; database health is `GET /v1/admin/health` and needs the `cad_` key.
- [ ] Mint the `cad_` admin key **first**. `db:seed` calls the admin API in-process, so it refuses to
      run without `SEED_ADMIN_KEY`, and the first admin key cannot come from the API itself.
- [ ] Use a slug of lowercase letters, digits and underscores only. `sdk-live` is **rejected** —
      the hyphen fails the slug validator.
- [ ] Capture the `csk_…`. `db:seed` prints the pair **once**; nothing recovers it. If you lose it,
      `pnpm db:site-key -- mint --site sdk_live` mints a replacement.
- [ ] Optional: capture the `cpk_…` too — it enables the one case that proves a publishable key is
      refused on the client tier.
- [ ] Optional: create a page with at least one text field and note its slug, for the round-trip case.
      Any page will do; nothing gets published.

### 2 · invoice-service

```bash
cd ../invoice-service
cp .env.example .env      # then fill in:
#   DATABASE_URL=<the sdk-live branch, pooled>
#   CREDENTIALS_ENC_KEY=$(openssl rand -base64 32)
#   DOWNLOAD_LINK_SECRET=$(openssl rand -base64 32)   # set it now; adding it later breaks live links

pnpm db:check
pnpm db:migrate
pnpm db:wizard            # creates a client + credential interactively → capture the isk_…
pnpm dev                  # http://localhost:3301, no Vercel CLI needed
```

- [ ] `curl http://localhost:3301/healthz` → `{"status":"ok","db":"ok"}`. Like content-service, this is
      the only unauthenticated endpoint; `GET /v1/admin/health` is the authenticated one.
- [ ] Capture the `isk_…`.
- [ ] The wizard will ask for a provider credential. **You can skip a real one.** Every live case except
      one asserts a failure that happens before the provider is contacted, so a client with no working
      credential still exercises them. Only supply a szamlazz/Billingo **sandbox** key if you also want
      the idempotent-replay case, and note its `providerConfigId`.

### 3 · payment-service

```bash
cd ../payment-service
cp .env.example .env      # then fill in:
#   DATABASE_URL=<the sdk-live branch, pooled>
#   PUBLIC_BASE_URL=http://localhost:3300        # no trailing slash — it is rejected
#   CREDENTIALS_ENC_KEY=$(openssl rand -base64 32)
#   PAYMENT_PROVIDERS_ALLOW_LIVE=false           # set it EXPLICITLY, do not rely on the default

pnpm db:migrate
npx tsx --env-file=.env scripts/wizard.ts        # merchant + pmk_ key + sandbox credential
pnpm dev                                         # http://localhost:3300
```

- [ ] `curl http://localhost:3300/healthz` → `{"status":"ok","db":"ok"}`.
- [ ] Capture the `pmk_…`.
- [ ] In the wizard, set the credential's mode to **`sandbox`**. This is what makes every payment under
      that key a sandbox payment.
- [ ] Confirm with one read that the key works before running the suite.

### 3b · The four services phase 9 added

auth-service, booking-service, email-service and webshop-service each need a scratch tenant and one
key per tier the suite reads — see `.env.live.example` for the exact variable names. Their bootstrap
steps are in each knowledge-base folder's `operations.md` (environment, CLI, migrations) and, for
auth-service, in `examples.http` §0, which takes a tenant from nothing to a working sign-in in four
requests. This file does not restate them: those documents move with the services, and a copy here
would be the one that drifted.

Two facts decide how you do it:

- [ ] **Their live cases are negative only.** Each suite asserts a `401` for an unknown key, a `403`
      for the browser tripwire on a server tier, a `404` for a stranger's id and one `400` that creates
      nothing. None sends mail, takes a booking, creates a cart or checks out — so a tenant with no
      provider credential, no templates and no products is enough.
- [x] **Done for local work, 2026-09-05.** One tenant per service on production, named
      `SDK live probe` / slug `sdk_live`, provisioned through each admin tier. All seven services
      now report `✓` and the four new files contribute 19 passing cases.
- [ ] **The release still cannot pass.** `LIVE_REQUIRE_CONFIGURED=true` turns every unconfigured
      service into a failed release, by design, and the eleven secrets are in `.env.live` only. Run
      `scripts/push-release-secrets.sh` before tagging.
- [ ] **auth-service: leave the organization unpaired.** A non-UUID `external_ref` makes every event
      it emits answer `500` — auth-service T-70. Setting one on this tenant breaks its member and
      webhook routes.

### 4 · Wire it up here

Copy the template and fill it in:

```sh
cp .env.live.example .env.live
```

`.env.live` is untracked — `.gitignore` ignores `.env.*`, and `.env.live.example` is the single
exception it re-includes. It must stay that way. **Do not paste a filled-in value into a chat, a commit
message, or an issue.** If one leaks, rotate it; deleting the message does not recall the copy in
someone's notification e-mail.

[`.env.live.example`](../.env.live.example) documents every variable, which of them are optional and
what each one gates. It also carries `NPM_TOKEN`, which this suite does not read — it is there so one
file describes everything a release needs.

Each service now has its own default port, so the three run side by side without a collision:
payment-service 3300, invoice-service 3301, content-service 3302. Both `pnpm dev` and `pnpm dev:vercel`
use it, and `PORT` overrides the first. Point each `*_BASE_URL` at the matching port. The suite runs
files serially and skips any service that is not configured.

- [ ] `pnpm test:live` — expect the configured services to report `✓` and the rest to say why.
- [ ] Read the output. A **skip is not a pass.**

### 5 · The one thing that needs Vercel

Only to prove `x-vercel-cache: HIT`, which is the sole mechanical check that a mode-A route is still
static.

- [ ] Deploy content-service (production, its own project) — a deployed site cannot read from your
      laptop.
- [ ] Deploy a Next site that reads through `createNextContentGateway().published` — `examples/next-site`
      here, or `devora`. Set `CONTENT_SERVICE_BASE_URL`, `CONTENT_SERVICE_SECRET_KEY` and
      `CONTENT_REVALIDATE_SECRET` on it.
- [ ] Then, twice, against the deployed URL:

```bash
curl -sI https://<your-site>/           # first request populates the cache
curl -sI https://<your-site>/ | grep -i x-vercel-cache
#   x-vercel-cache: HIT   ← the route is static
#   x-vercel-cache: MISS  ← on every request: something made it dynamic
```

- [ ] Optional, and worth it once: register the deployed site's `/api/revalidate` as a webhook endpoint
      — `POST /v1/admin/sites/{id}/webhook-endpoints` — then publish a page and confirm the change
      appears within seconds rather than after the time-based fallback. That is the end-to-end proof
      that the tag a read sets is the tag the webhook busts.

      The create response carries the endpoint's signing secret **once**. That value is what
      `CONTENT_REVALIDATE_SECRET` on the site must hold: each endpoint signs with its own secret, so
      one receiver's leak cannot forge events to another. `POST /v1/admin/webhook-endpoints/{id}/rotate-secret`
      mints a new one and stops the old one at once.

### 6 · Afterwards

- [ ] Delete the Neon branches. That is the whole cleanup — every row these tests created goes with them.
- [ ] Leave `.env.live` in place or delete it; either way it never enters git.

---

## If a live case fails

A failure means one of two things, and they have opposite fixes:

1. **The SDK is wrong.** Fix the SDK.
2. **The service moved and this repository's pinned docs are stale.** Then the fix starts in the
   knowledge base, not here — update the Markdown and `contracts/`, then the SDK, then re-pin
   `CONTRACTS.json`. That is the drift protocol in
   [plans/phase-8-release-and-drift.md](plans/phase-8-release-and-drift.md).

Deciding which one it is means reading the service's own documentation, not the SDK's. The assertion
messages name the documented claim each case rests on, so start there.
