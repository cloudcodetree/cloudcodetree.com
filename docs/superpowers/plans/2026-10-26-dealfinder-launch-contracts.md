# DealFinder launch: cross-plan contracts (Plans 1-6)

Every plan in the launch sequence uses the names below. A plan may add names of
its own. It may not rename or reshape one listed here without updating this file
and every plan that consumes it.

**Spec:** `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md`
**Plan 1:** `docs/superpowers/plans/2026-10-25-dealfinder-p1-identity-and-data.md`

## Repos and branches

- Product: `~/Development/tutorial-dealfinder` (GitHub `cloudcodetree/tutorial-dealfinder`).
  Plan N works on `feat/launch-pN-<slug>`, cut from `origin/main` after Plan N-1
  merges. If Plan N-1 is not merged yet, stack on its branch.
- Site: `~/Development/cloudcodetree.com`. Site pieces use `feat/deals-<slug>` from `origin/main`.
- Plans never touch the 37 lessons or the step tags, except Plan 6's pilot step.

## Migration numbers (companion `dealfinder/migrations/`)

| File | Plan |
|---|---|
| `0001_dealfinder_schema.sql` | 1 |
| `0002_saved_searches.sql` | 1 |
| `0003_job_role.sql` | 2 |
| `0004_offer_provenance.sql` | 2 |
| `0005_profiles_and_alerts.sql` | 5 (also adds `watchlist.baseline_price`) |

Plan 3 adds no migration. The production login role is created by a script, never in SQL.

## Roles

| Role | Attributes | Used by | Plan |
|---|---|---|---|
| `dealfinder_app` | `NOLOGIN NOSUPERUSER NOBYPASSRLS` | request path, via `db.scoped(...)` | 1 |
| `dealfinder_job` | `NOLOGIN NOSUPERUSER NOBYPASSRLS`, role-targeted policies `TO dealfinder_job USING (true)` on every `dealfinder` table | scheduled jobs, via `db.job_scope(...)` | 2 |
| `dealfinder_svc` | `LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`, granted `dealfinder_app` and `dealfinder_job`, plus direct `USAGE ON SCHEMA dealfinder` and `SELECT ON dealfinder.schema_migrations` (NOINHERIT means `/readyz` needs them), password only in Secret Manager | Cloud Run service and jobs, through the pooler on port 6543 | 3 |

`db.job_scope(*, url: str | None = None) -> ContextManager[psycopg.Cursor]` (Plan 2) opens one
transaction with `SET LOCAL ROLE dealfinder_job` and `SET LOCAL search_path = dealfinder, extensions, public`.

## Public URL map: `deals.cloudcodetree.com`

The deals Worker (`edge/` in the companion, Worker name `dealfinder-edge`, Plan 3) owns the hostname.

| Path | Served by |
|---|---|
| `/api/<rest>` | Cloud Run backend at `/<rest>`. The `/api` prefix is stripped. Anonymous `GET /api/search` is edge-cached 300 s. |
| `/lab`, `/lab/*` | Cloud Run backend, path unchanged |
| `/deal/<slug>` | R2 bucket `dealfinder-pages`, key `deal/<slug>.html`. A miss is a 404 page, never a stale page. |
| `/sitemap.xml`, `/robots.txt` | R2 keys `sitemap.xml`, `robots.txt` |
| anything else | Workers Static Assets from `frontend/dist`, SPA fallback to `index.html` |

- The Worker adds `X-DealFinder-Edge: <EDGE_SHARED_SECRET>` and `CF-Connecting-IP` to **every** request it proxies to Cloud Run, `/lab` included. The lab reads the first to set its API base to `/api`. The app limiter keys on the second.
- Worker bindings: R2 `PAGES`, rate limiters `ASK_LIMITER` and `STREAM_LIMITER`, var `BACKEND_ORIGIN`, var `LAUNCHED` (site-wide `noindex` until it is `"true"`), secret `EDGE_SHARED_SECRET`.
- R2 key `manifest.json` records the last publish. The Worker never serves it.
- Plan 5 adds Worker secret `HEALTHCHECK_UPTIME_URL` and a Cron Trigger `*/10 * * * *` on `dealfinder-edge` for the uptime probe.
  With the site's keep-alive cron, that uses 2 of the account's 5 free Cron Triggers.
- The Best Buy logo is `/brand/bestbuy-logo.svg`, served from `frontend/dist` (Plan 4). Deal pages use the same path. Until the owner supplies the real file, attribution is text only. Never draw a stand-in.

- Rate limits: the zone rule in the site's `infra/ratelimit.tf` already matches the exact paths
  `/api/search` and `/api/search/` at 30 per 10 s per IP. `/api/ask` is limited in the Worker and in the app (Plan 3).
  `/api/search/stream` (the lab's SSE mode) is outside the zone rule, so the app limits it like `/search`.
- The backend rejects any request without the right `X-DealFinder-Edge` header when `EDGE_SHARED_SECRET`
  is set. `/healthz` and `/readyz` are exempt (Plan 3).

## Backend routes (after Plans 1-5)

| Route | Plan | Notes |
|---|---|---|
| `GET /healthz`, `GET /readyz` | 1 | |
| `GET /config.json` | 1, 4 | public settings only. Keys: `supabaseUrl`, `supabasePublishableKey`, `providers`, `verdictMode` (Plan 4 adds the last) |
| `GET/POST /watchlist`, `DELETE /watchlist/{offer_id}` | 1 | Plan 2 limits watchable offers to verdict sources |
| `GET/POST /saved-searches`, `DELETE /saved-searches/{search_id}` | 1 | |
| `GET /search?q=&k=12` | 2 | **the shopper search** (shape below). Replaces today's raw-aggregate `/search`. |
| `GET /check?title=&price=` | 2 | "check a deal" mode |
| `GET /ranked?q=&k=12` | 2 | lab view, same scorer, same license policy |
| `GET /lab` | 4 | the one Nocturne lab, holding all course modes. `GET /redesign` and backend `GET /` answer 301 to `/lab`. |
| `GET /snapshot?q=&limit=50` | 6 | the Part 1 pilot's view of the teaching snapshot, never with `image_url` |
| `GET /account/export`, `DELETE /account`, `PATCH /account` | 5 | `PATCH` turns alerts back on. `DELETE` removes DealFinder data and keeps the shared cloudcodetree.com sign-in account. |
| `GET /unsubscribe?t=`, `POST /unsubscribe?t=` | 5 | `POST` is RFC 8058 one-click |

## Shopper `/search` response (Plan 2 produces; Plans 3, 4, 5 consume)

```json
{
  "query": "noise cancelling headphones",
  "mode": "live",
  "count": 12,
  "median_price": 199.99,
  "fetched_at": "2026-10-26T08:00:00Z",
  "results": [{
    "id": "bestbuy-6505727", "sku": "6505727", "slug": "sony-wh-1000xm5-bestbuy-6505727",
    "title": "Sony WH-1000XM5", "brand": "Sony", "source": "BestBuy",
    "price": 299.99, "regular_price": 399.99, "url": "https://www.bestbuy.com/...", "image_url": "https://...",
    "verdict": "deal", "pct_under_median": 18.2, "fair": 331.0, "residual_frac": 0.094,
    "basis": "model", "reason": "18% under the median and consistent with the price model (~$331) — a genuine deal."
  }],
  "ebay": {"enabled": true, "note": "Listings from eBay. Not compared or rated.",
           "items": [{"id": "ebay-…", "title": "…", "price": 180.0, "currency": "USD", "url": "…", "condition": "Used", "image_url": "…"}]},
  "attribution": [{"source": "BestBuy", "text": "Prices and product data from Best Buy", "url": "https://www.bestbuy.com", "logo": "bestbuy"}],
  "degraded": false
}
```

- `mode` is `"live"` or `"check"`, from env `DEALFINDER_VERDICT_MODE` (default `live`; an unknown value fails closed to `check`).
  In `check` mode every `results[].verdict`, `fair`, `residual_frac`, `basis` and `pct_under_median` is `null`, the top-level
  `median_price` is `null`, and the front end leads with the check form.
- `results[].slug` is `null` for a row without a SKU. Only course-only dev sources produce those.
- `aggregate()` results also carry `timed_out: list[str]`, the sources that hit `DEALFINDER_SOURCE_TIMEOUT_S`, and
  `benched: list[str]`, the sources skipped while their breaker cools down.
- `degraded` is `true` when a store timed out, failed or was benched, so the results may be incomplete. A degraded
  anonymous response is sent `Cache-Control: no-store`, never the edge's `public, max-age=300`. `/ranked` and the
  `/search/stream` `done` event carry the same `attribution` list, and both null their median in `check` mode.
- `verdict` is one of `deal | fair | overpriced | suspicious | null`. Only sources whose policy allows verdicts get one.
- `regular_price` is display-only. It is never a reference price in any signal.
- `ebay.enabled` is `false` and `items` is `[]` when eBay keys or production access are missing.
- `GET /check` returns `{"title", "price", "category", "fair", "residual_frac", "verdict", "reason", "basis"}`.

## Python modules

| Module | Plan | Public names |
|---|---|---|
| `dealfinder/licensing.py` | 2 | `SourcePolicy`, `POLICIES`, `LAUNCH_SOURCES`, `source_key(source) -> str`, `policy_for(source) -> SourcePolicy \| None`, `may_verdict(source) -> bool`, `may_store(source) -> bool`, `may_embed(source) -> bool`, `may_comingle(source) -> bool`. An unknown source is denied everything. |
| `dealfinder/live_sources.py` | 2 | `enabled_sources(names: str \| None = None) -> list` (env `DEALFINDER_SOURCES`, comma list, unset = all course sources except eBay; with `DEALFINDER_ENV=production` an unset list or a `launch=False` source raises), `EBAY: EbaySource` (`is_sandbox`, env `DEALFINDER_EBAY_ALLOW_SANDBOX`), `BestBuySource.lookup_skus(skus: list[str]) -> dict[str, Product]`, which **raises** `RuntimeError` when a lookup fails (no key, a network error, a non-200 batch), so a failure is never read as "item gone" |
| `dealfinder/shop.py` | 2 | `score_offers(offers, median) -> list[dict]`, `shop_search(q, k=12) -> dict`, `ebay_box(q, limit=6) -> dict`, `attribution_for(rows) -> list[dict]`, `check_deal(title, price) -> dict`, `offer_slug(title, sku) -> str`, `verdict_mode() -> str` |
| `dealfinder/retention.py` | 2, 5 | `purge_expired(now=None, url=None, margin_s=25 * 3600) -> dict[str, int]` (Plan 5 adds the keys `alert_payloads` and `alert_log`); CLI `python -m dealfinder.retention`. The margin covers two 12 h purge intervals plus an hour, so a Best Buy row is gone before 72 h even when one run fails: the effective cut-off is 47 h. |
| `dealfinder/settings.py` | 3 | `is_production() -> bool` (`DEALFINDER_ENV == "production"`), `load_secrets() -> None` (reads one JSON env var `DEALFINDER_SECRETS_JSON`, never overrides a set var) |
| `dealfinder/ratelimit.py` | 3 | per-instance limiter keyed on `CF-Connecting-IP` |
| `dealfinder/pages.py` | 3 | `render_deal_page(item, *, built_at, logo=False) -> str`, `render_sitemap(slugs, *, built_at) -> str`, `build_pages(queries, report=None) -> dict[str, str]`, `publish(pages, store, healthy=True, now=None) -> dict`, `PageStore`, `R2PageStore`, `DirPageStore` |
| `dealfinder/healthcheck.py` | 3 | `ping(check: str, status: str = "ok") -> None`, status `start \| ok \| fail`, URL from env `HEALTHCHECK_<CHECK>_URL`, no-op when unset |
| `dealfinder/jobs.py` | 3 | CLI `python -m dealfinder.jobs <pages\|purge\|alerts>`. Plan 3 ships `pages` and `purge`. Plan 5 registers `alerts`. |
| `dealfinder/notify.py` | 5 | `ResendNotifier`, `ConsoleNotifier` |
| `dealfinder/alerts.py` | 5 | `run_alerts(now=None, notifier=None, url=None, *, lookup=None, search=None) -> dict` |
| `dealfinder/tenancy.py` | 1, 5 | `Principal` gains optional `email` (Plan 5), taken only from the verified JWT |
| `dealfinder/observability.py` | 5 | `init_sentry() -> None`, JSON request-log middleware |

## Scheduled work (Plan 3 creates, Plan 5 fills `alerts`)

| Cloud Scheduler job | Cron (UTC) | Runs |
|---|---|---|
| `dealfinder-pages` | `0 */12 * * *` | `python -m dealfinder.jobs pages`: purge expired rows, refresh tracked items, rebuild and publish pages, delete pages not rebuilt |
| `dealfinder-alerts` | `30 13 * * *` | `python -m dealfinder.jobs alerts`: re-price every watched SKU, email drops, run saved searches |

Both jobs ping `HEALTHCHECK_PAGES_URL` / `HEALTHCHECK_ALERTS_URL` with `start`, then `ok` or `fail`.

Freshness rules both jobs honor: tracked Best Buy items and watched SKUs are refreshed well inside the 47 h purge
cut-off. `last_checked_at` and `fetched_at` are updated only after a successful lookup, never after a failed one.
A watch whose item stopped refreshing for 47 h is deleted by the purge, so a watch survives about one failed daily re-price.
No cron runs on GitHub Actions.

## Secrets

One Secret Manager secret, `dealfinder-env`, holds a JSON object. Cloud Run exposes it as the env var
`DEALFINDER_SECRETS_JSON`, and `settings.load_secrets()` expands it at startup. That keeps the project
within Secret Manager's free active-version allowance. Keys:
`DATABASE_URL`, `BESTBUY_API_KEY`, `EBAY_APP_ID`, `EBAY_CERT_ID`, `EDGE_SHARED_SECRET`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_TOKEN`, `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET`, `SENTRY_DSN`,
`HEALTHCHECK_PAGES_URL`, `HEALTHCHECK_ALERTS_URL`, `CLOUDFLARE_AI_TOKEN` (Plan 5, Workers AI for `/ask`).
Not secret, plain env: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DEALFINDER_ENV=production`,
`DEALFINDER_SOURCES=BestBuy`, `DEALFINDER_VERDICT_MODE`, `DEALFINDER_BESTBUY_LOGO` (set once the real logo file ships),
`DEALFINDER_PUBLIC_ORIGIN`, `ALERT_FROM`, `ALERT_DAILY_CAP`, `WORKERS_AI_MODEL`, `ASK_CACHE_TTL_S`, `ASK_LLM_DAILY_MAX`,
`DEALFINDER_MAX_INSTANCES`, and the front-end build-time `VITE_SENTRY_DSN`. `/config.json` does not change for Plan 5.

## Front end (Plan 4)

- React + Vite in `frontend/`, builds to `frontend/dist`. API base is the same-origin `/api`.
  The Vite dev proxy maps `/api/*` to `http://127.0.0.1:8000/*` with the prefix stripped, the same as the Worker.
- Routes: `/`, `/check`, `/watchlist`, `/saved`, `/how-we-rank`, `/privacy`.
- Content files: `frontend/src/content/how-we-rank.md` and `frontend/src/content/privacy.md` (Plan 4 drafts, Plan 5 finalizes privacy).
- The front end sets no cookies. supabase-js keeps the session in localStorage.
- Design tokens: `frontend/src/theme/tokens.css` is the source of truth, lifted from `dealfinder/static/redesign.html`.
  Plan 3's `dealfinder/templates/deal.css` uses the same variable names. Plan 4 adds a test that the values match.

## Lab hooks for the course pipeline (Plan 4 builds, Plan 6 uses)

- `/lab` works when the backend serves it directly, with no Worker in front. The API base is then empty.
- Each mode renders a `[data-mode="<id>"]` container. `dealfinder/static/lab/lessons.json` has one entry per mode.
- `?mode=<id>&q=<query>` on load opens that mode and runs the query.
- A mode's container gets `data-ready="true"` when rendering finishes. Screenshot manifests wait on it.

## Course branches (Plan 6)

- Before release: `main` is the product's source of truth. `course` is a linear branch of `step-NN:` commits, rebuilt freely.
  The site pins each step by SHA, so it needs no tags yet.
- At release: `main` is replaced by `course`, the old `main` is kept as tag `archive/pre-course-v1`, the `step-NN` tags
  move, and `course-v1` is set. Each of those is an owner "you do it".
- After release: the tooling refuses to move tags. Product work lands as ordinary commits after the last step.

## Owner-only actions

Every plan lists them in an "Owner setup" section. For each, the plan first tries the route that needs
nothing from the owner (API, CLI, existing token) and asks only after quoting the failure. Production
changes (prod migration, merge to `main`, DNS, Supabase auth config, a GCP or Cloudflare resource) need
an explicit owner go, asked as "reply 'you do it'".
