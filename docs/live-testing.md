# Live testing — what to provision, and why

`pnpm test:live` is the only suite that proves the SDK's *understanding of the three services* is
still true. Everything else proves something narrower:

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

Short answer: **almost nothing.** Three of the four things you might want to test run fine against a
service on `localhost`.

| What you want to verify | Needs a Vercel deployment? | Why |
| --- | --- | --- |
| The SDK's request/response contract with all three services (`pnpm test:live`) | **No** | Every assertion is an outbound call the SDK makes. `vercel dev` on `localhost:3000` answers them identically. |
| A revalidation webhook reaching a site's `/api/revalidate` | **No**, if both sides are local | content-service POSTs to the URL stored on the site row. Point it at `http://localhost:3000/api/revalidate` and a local Next site receives it. |
| A PSP callback reaching payment-service | **No**, for this suite | The live cases create and read a payment; they never complete one through a PSP's hosted page. `refresh` is an *outbound* call and works from localhost. A callback would need a public `PUBLIC_BASE_URL`, which is only relevant to finishing a real checkout. |
| **`x-vercel-cache: HIT` on a mode-A route** | **Yes** | That header is produced by Vercel's edge and by nothing else. It is the only mechanical proof that a mode-A route is still statically rendered — the bug it catches is a latency and cost regression with no error, invisible in a diff, and hidden entirely by a keyless local build. |

So: run the contract suite locally, and deploy **one** thing — a Next site that reads through
`@lamido/content/next`'s mode A — to prove the caching claim. `examples/next-site` in this repository
is that site; `devora` would do just as well and is more realistic.

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
5. **`POST …/publish` on content-service makes every unpublished draft on that page live.** No case in
   the live suite publishes. The one write case reads a value and patches it back unchanged.
6. **Changing `CREDENTIALS_ENC_KEY` or `SECRETS_ENC_KEY` is irreversible.** It makes every stored
   credential undecryptable. Generate once, store in the password manager, never "regenerate to be
   safe".

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
#   SECRETS_ENC_KEY=$(openssl rand -base64 32)
#   BLOB_READ_WRITE_TOKEN=<from the linked Vercel Blob store>

pnpm db:check                                   # connectivity + the pooled-host warning
pnpm db:migrate
pnpm db:seed -- sdk-live "SDK live probe" hu    # a bare site row
pnpm db:site-key -- mint --site sdk-live        # capture the csk_… and cpk_…
pnpm dev:node                                   # http://localhost:3000, no Vercel CLI needed
```

- [ ] `curl http://localhost:3000/api/health` → `{"status":"ok",...}`
- [ ] Capture the `csk_…`. It is printed **once**.
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

npm run db:check
npm run db:migrate
npm run db:wizard         # creates a client + credential interactively → capture the isk_…
npm run dev               # vercel dev → http://localhost:3000
```

- [ ] `curl http://localhost:3000/api/health` → `{"status":"ok"}`
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
#   PUBLIC_BASE_URL=http://localhost:3000        # no trailing slash — it is rejected
#   CREDENTIALS_ENC_KEY=$(openssl rand -base64 32)
#   PAYMENT_PROVIDERS_ALLOW_LIVE=false           # set it EXPLICITLY, do not rely on the default

npm run db:migrate
npx tsx --env-file=.env scripts/wizard.ts        # merchant + pmk_ key + sandbox credential
npm run dev
```

- [ ] Capture the `pmk_…`.
- [ ] In the wizard, set the credential's mode to **`sandbox`**. This is what makes every payment under
      that key a sandbox payment.
- [ ] Confirm with one read that the key works before running the suite.

### 4 · Wire it up here

Create `.env.live` in this repository. It is untracked — `.env.*` is in `.gitignore` — and it must stay
that way. **Do not paste these values into a chat, a commit message, or an issue.**

```ini
# .env.live — real credentials for a scratch tenant. Never committed.

CONTENT_SERVICE_BASE_URL=http://localhost:3000
CONTENT_SERVICE_SECRET_KEY=csk_...
CONTENT_SERVICE_PUBLISHABLE_KEY=cpk_...        # optional, enables one more case
CONTENT_SERVICE_SCRATCH_SLUG=                  # optional, enables the round-trip case

INVOICE_SERVICE_BASE_URL=http://localhost:3001
INVOICE_SERVICE_CLIENT_KEY=isk_...
INVOICE_SERVICE_PROVIDER_CONFIG_ID=            # optional, only for the replay case

PAYMENT_SERVICE_URL=http://localhost:3002
PAYMENT_SERVICE_KEY=pmk_...

# Off by default. Turn on only when every target above is a scratch database you are
# willing to leave rows in. This is what enables the create/refresh cases.
LIVE_ALLOW_WRITES=false
```

The three services all default to port 3000, so run them on different ports (`vercel dev --listen 3001`)
or one at a time — the suite runs files serially and skips any service that is not configured.

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

- [ ] Optional, and worth it once: register the deployed site's `/api/revalidate` as its revalidation
      URL, publish a page, and confirm the change appears within seconds rather than after the
      time-based fallback. That is the end-to-end proof that the tag a read sets is the tag the webhook
      busts.

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
