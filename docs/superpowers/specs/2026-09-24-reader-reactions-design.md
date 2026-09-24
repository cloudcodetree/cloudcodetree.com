# Reader reactions: like, dislike, and engagement events — design

Date: 2026-09-24. Status: approved in conversation.
Sub-project C of "reader features" (A search analytics ✓, B reader state ✓,
**C reactions**, D highlights).

It is also the first of four pieces toward recommendations. Each piece gets its
own spec:

1. **Reactions and engagement events** (this spec)
2. Personal recommendations
3. Editorial recommendation posts
4. Slack delivery through RSS

## Goal

Capture what readers like, dislike, save and actually read, from everyone,
signed in or not. The output is a clean event stream that pieces 2 and 3 turn
into recommendations. Readers only ever see their own state.

## Context

Signal volume is close to zero today (2026-09-17: one signed-in user, six
`reader_state` rows). Anything gated on sign-in will run on the owner's clicks
for a long time. That is why signed-out readers must be able to react.

## Decisions taken

- **Everyone can react.** A signed-in reaction is stored per reader and also
  counted in the aggregate. A signed-out reaction is counted in the aggregate
  only.
- **No counts are shown.** Reactions are signal, not social proof. At current
  traffic, visible counts would read "0" on almost every post.
- **Two stores, two jobs.**
  - `reader_state` is the state of record for a signed-in reader's own
    reaction. It is private under RLS. Piece 2 reads it.
  - Workers Analytics Engine holds the aggregate event stream from everyone.
    Piece 3 reads it through a CI harvester.
  - Neither store reads the other's private data.
- **Rejected: Workers Logs as the store.** It is the path search misses use,
  but logs are kept 7 days, and the harvester only runs when something pushes
  to `main`. A week without pushes loses events for good.
- **Rejected: a Supabase counter table.** It routes an anonymous, abuse-prone
  write path into the database of record, needing either a service-role key in
  the Worker or an anon-callable RPC that bypasses edge rate limiting. It also
  fails whenever the free-tier project pauses, which happened on 2026-09-17.
- **Anonymous events need Turnstile, once per 30 minutes.** Signed-in readers
  skip it.
- **Reads are tracked** once per browser per item, only after 10 seconds
  visible.
- **Buttons appear on article pages only**, not on list cards. People react
  after reading, not to a headline.

## Reader experience

- A like button and a dislike button on every AI News article and every
  tutorial lesson, next to the existing Save chip.
- One reaction per item: like, dislike, or none. Clicking the active button
  clears it. Clicking the other one switches.
- No counts anywhere. A reader sees only their own state.
- Signed out, state lives in `localStorage`. Signed in, it lives in
  `reader_state.reaction`.
- On sign-in, local reactions are copied into the account for items where the
  account has no reaction yet. This sends no events, because each was already
  counted when it happened.

## Client: state changes and the events they send

Reactions are stored as `1` (like), `0` (none), `-1` (dislike). Each change
sends signed deltas, so the aggregate stays correct without any identity.

| From | To | Events sent |
|---|---|---|
| none | like | `like +1` |
| none | dislike | `dislike +1` |
| like | none | `like -1` |
| dislike | none | `dislike -1` |
| like | dislike | `like -1`, `dislike +1` |
| dislike | like | `dislike -1`, `like +1` |
| any | same | nothing |

Saves: saving sends `save +1`, unsaving sends `save -1`.

Reads: `read +1`, sent once per item per browser, only after the page has been
visible for 10 cumulative seconds (Page Visibility API). The set of items
already sent is kept in `localStorage`, capped at the 2,000 most recent ids.
This is separate from `reader_state.read_at`, which still marks an item as
opened immediately and drives the "Hide read" filter.

Write order when signed in:

1. Write `reader_state` first. If it fails, show the existing write-error
   notice and send no event.
2. Then send the event, fire-and-forget. A lost event under-counts by one.

If `/api/engage` returns 403, the client obtains clearance (next sections)
and retries once. This covers both a first anonymous event and a signed-in
reader whose bearer check failed because JWKS was unreachable.

## Endpoint: `POST /api/engage`

Request:

```json
{ "post_id": "2026-09-23-01-example", "changes": [{ "event": "like", "delta": 1 }] }
```

Validation. Any failure returns 400 and writes nothing:

- `Origin` must be in the environment's `ENGAGE_ORIGINS` list: the production
  origin, the beta origin, and the local Wrangler origin used by
  `pnpm run start`.
- `post_id` must match `^[a-z0-9][a-z0-9-]{0,95}$`. The 95 keeps the id
  within Analytics Engine's 96-byte index limit. The longest id today is 74.
- `changes` holds 1 or 2 items.
- `event` is one of `like`, `dislike`, `save`, `read`.
- `delta` is `1` or `-1`, and `read` only accepts `1`.
- The body is at most 1 KB.

Well-formed but unknown ids are accepted here and dropped later by the piece-3
harvester, which checks them against `posts.json` and the tutorial manifest.
That keeps the Worker free of a content index.

Who is signed in is decided by the Worker, never by the client:

- A signed-in client sends `Authorization: Bearer <access_token>`, the current
  token from supabase-js, which refreshes it automatically. The Worker checks
  it with the existing `verifyToken` in `worker/auth.ts`. Valid means `user`.
- `cct_session` is not used. It is minted once at sign-in, capped at one hour,
  and never re-minted on refresh, so it would silently expire mid-session.
- No valid bearer token means the request must carry a valid `cct_engage`
  clearance cookie (next section). Without either, return 403 and write
  nothing.
- If JWKS is unreachable, the bearer check fails, and the request falls back
  to the clearance cookie.

Rate limit: 30 requests per 60 seconds, keyed by client IP, through the Workers
rate-limit binding. Over the limit returns 429. The IP is only the limiter key
and is never written anywhere. The binding is per Cloudflare location and
approximate by design. It damps spam. It is not an accounting system.

Response: 204. A failed Analytics Engine write is caught and still returns 204,
so engagement can never break a page.

## Clearance: `POST /api/engage/clearance`

For signed-out readers only.

1. On the first reaction, save or read dwell, the page lazy-loads Turnstile in
   invisible mode. Readers who never engage never load it.
2. The page posts the token to `/api/engage/clearance`. The Worker verifies it
   with Turnstile's siteverify API.
3. On success the Worker sets `cct_engage`:
   `HttpOnly; Secure; SameSite=Strict; Path=/api/engage; Max-Age=1800`.
   The value is `base64url(expiry, nonce) + "." + HMAC-SHA256(key, payload)`.
   It holds no identity.
4. On failure it returns 403 and sets nothing.

`/api/engage` verifies the HMAC and the expiry. A tampered or expired cookie is
treated as missing.

## Event schema (Analytics Engine)

| Field | Value |
|---|---|
| Dataset | `cct_engagement` (production), `cct_engagement_staging` (beta) |
| `indexes[0]` | `post_id` |
| `blobs[0]` | event: `like`, `dislike`, `save`, `read` |
| `blobs[1]` | kind: `post` or `tutorial`, derived from the `tutorial-` id prefix |
| `blobs[2]` | auth: `user` or `anon`, decided by the Worker |
| `doubles[0]` | delta: `1` or `-1` |

One data point per change, so at most 2 per request. The Analytics Engine limit
is 250 per invocation.

Piece 3 aggregates with `sum(_sample_interval * double1)` grouped by index and
event, so any future sampling is corrected for.

Staging writes to its own dataset so testing on beta never touches production
aggregates.

## Data

Migration `supabase/migrations/0007_reader_state_reaction.sql`:

```sql
alter table public.reader_state
  add column reaction smallint not null default 0
  check (reaction in (-1, 0, 1));
```

The existing own-rows RLS policies and the `updated_at` trigger already cover
the new column. No new policies and no delete. `ReaderRow` in
`app/lib/readerState.ts` gains `reaction`, read in the same single select it
already makes.

## Config

`wrangler.jsonc`, both environments:

| Binding | Type | Purpose |
|---|---|---|
| `ENGAGEMENT` | Analytics Engine dataset | The event stream |
| `ENGAGE_LIMITER` | Rate limit, 30 per 60 s | Spam damping |
| `TURNSTILE_SECRET` | Worker secret | siteverify |
| `ENGAGE_HMAC_KEY` | Worker secret | Signs `cct_engage` |
| `ENGAGE_ORIGINS` | Var | Allowed `Origin` values |

The Turnstile site key is public and lives with the other public auth config
in `app/lib/authConfig.ts`.

Both secrets are low-privilege: one can only verify Turnstile tokens, the other
only signs this cookie. That is a different risk class from the database key
rejected above.

CSP in `public/_headers`: add `https://challenges.cloudflare.com` to
`script-src`. Frames are already allowed by `default-src 'self' https:`.
Extend `scripts/validate-csp.mjs` so the entry cannot silently drop out.

`/api/*` is already in `run_worker_first`, so no routing change is needed.

## Failure behaviour

| Condition | Result |
|---|---|
| Invalid request | 400, nothing written |
| No bearer and no clearance | 403, nothing written |
| Over the rate limit | 429, nothing written |
| Analytics Engine write fails | 204, event lost, page unaffected |
| `reader_state` write fails (signed in) | Existing error notice, no event sent |
| Supabase paused or JWKS down | Signed-in readers fall back to the clearance path |
| Turnstile fails to load | No clearance, so anonymous events are not sent. The buttons still update local state. |

## Privacy

- Analytics Engine holds no identifiers: no user id, no IP, no nonce.
- The IP is used only in memory, as the rate-limit key.
- `cct_engage` is an anti-abuse cookie holding an expiry and a random nonce.
- Per-reader reactions stay in `reader_state`, readable only by that reader.

## Testing

Worker unit tests (`worker/engage.test.ts`, vitest, the existing pattern):

- The validation matrix: origin, id shape, event and delta sets, `read -1`,
  more than 2 changes, oversize body. Each returns 400 with no write.
- No bearer and no cookie returns 403.
- A valid bearer returns 204 with auth `user`.
- A valid clearance cookie returns 204 with auth `anon`.
- A tampered or expired cookie returns 403.
- A client cannot claim `user` or choose `kind`. Both are derived server-side.
- Over the limit returns 429.
- A failing Analytics Engine write still returns 204.
- Clearance: siteverify success sets the cookie, failure sets nothing.

Client unit tests (`app/lib/`):

- All 9 reaction transitions produce the deltas in the table above.
- Save and unsave produce `save +1` and `save -1`.
- A read fires once, only after 10 visible seconds, and never twice per item.
- The sign-in merge copies reactions and sends no events.

Browser tests (Playwright, the existing suite's pattern, all network mocked):

- React signed out and signed in on a blog post and a tutorial lesson. Assert
  the request bodies and the persisted state.
- Turnstile and Supabase are mocked. No test touches a live reader's data.

Parity: add `/api/engage` 400 and 403 cases to `scripts/check-parity.mjs`.

## Beta acceptance

1. Deploy to beta. This also confirms the rate-limit binding deploys on the
   Workers Free plan, which the docs did not state outright.
2. React, save and read on beta, signed out and signed in.
3. Query `cct_engagement_staging` through the Analytics Engine SQL API and see
   the rows with the expected event, kind, auth and delta.
4. Confirm `cct_engagement` in production received nothing from the test.

## Out of scope

- Piece 2, personal recommendations.
- Piece 3, the harvester and editorial posts. That is where the CI token gains
  Account Analytics Read and where unknown ids get dropped.
- Piece 4, Slack delivery through RSS.
- Visible counts, buttons on list cards, and an admin dashboard panel.
