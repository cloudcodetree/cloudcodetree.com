# DealFinder Plan 3 — Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run DealFinder at `deals.cloudcodetree.com` for $0. The backend runs on Cloud Run's free tier and scales to zero. Static deal pages sit in R2 behind a Cloudflare Worker, and two Cloud Scheduler jobs keep them under 72 hours old.

**Architecture:** One production image serves the FastAPI app and runs the scheduled jobs. The model is baked in and the image runs as a non-root user. The Worker `dealfinder-edge` owns the hostname. It strips `/api` and proxies to Cloud Run with a shared-secret header. It edge-caches anonymous search, rate-limits `/api/ask`, serves deal pages from R2 and serves the SPA from Workers Static Assets. GCP resources are OpenTofu in `deploy/gcp/`. All secrets live in one Secret Manager secret, which the app expands at startup.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, Docker (`python:3.11-slim`), OpenTofu + `hashicorp/google` provider, Cloud Run (service + jobs), Cloud Scheduler, Secret Manager, Artifact Registry, Workload Identity Federation, Cloudflare Workers (wrangler 4, TypeScript, vitest), R2, the site repo's OpenTofu `infra/`.

**Spec:** `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md` §6.1, §6.4, §6.6, §8, §9 (site repo, branch `docs/dealfinder-launch`).
**Contracts:** `docs/superpowers/plans/2026-10-26-dealfinder-launch-contracts.md`. Every name below that the contracts file defines is used as defined.
**Plan 1:** `docs/superpowers/plans/2026-10-25-dealfinder-p1-identity-and-data.md`. Plan 2 (live data and verdicts) is assumed done.

**Repo and branch:** companion `~/Development/tutorial-dealfinder`, branch `feat/launch-p3-hosting`, cut from `origin/main` after Plan 2 merges, else stacked on `feat/launch-p2-*`. Task 7 is in the site repo `~/Development/cloudcodetree.com`, branch `feat/deals-infra` from `origin/main`.

## Plan sequence

This is Plan 3 of 8. Plan 1 built identity and data. Plan 2 built live data and the license policy. Plan 4 is the shopper front end, which replaces whatever `frontend/dist` holds today. Plan 5 fills the `alerts` job and adds observability. The full list is in Plan 1.

## Free-tier facts this plan relies on

| Fact | Source | Status |
|---|---|---|
| Cloud Run request-based: 180,000 vCPU-s, 360,000 GB-s, 2M requests a month | https://docs.cloud.google.com/free/docs/free-cloud-features | verified 2026-10-26 |
| Cloud Run jobs (instance-based): 240,000 vCPU-s and 450,000 GiB-s a month, aggregated per billing account | https://cloud.google.com/run/pricing | secondary (search snippet of the pricing page). Task 11's live check confirms usage stays under it. |
| Cloud Scheduler: 3 free jobs **per billing account**, then $0.10 a job a month | https://cloud.google.com/scheduler/pricing | secondary (search snippet). Task 12 counts jobs across the billing account before creating ours. |
| Secret Manager: 6 active secret versions, 10,000 access operations a month | https://docs.cloud.google.com/free/docs/free-cloud-features | verified |
| Artifact Registry: 0.5 GB storage a month | same | verified |
| Cloud Logging: first 50 GiB a project a month | same | verified |
| Workers rate-limiting binding: `period` must be 10 or 60. The site's `ENGAGE_LIMITER` already runs it on this Free account. | https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ | verified, plus local precedent in the site's `wrangler.jsonc` |
| A Worker subrequest to a non-Cloudflare origin carries whatever `CF-Connecting-IP` the Worker sets | https://developers.cloudflare.com/fundamentals/reference/http-headers/ | verified |
| A Worker custom domain on the OpenTofu zone is owned by wrangler, and `tofu plan` ignores its record | site `infra/dns.tf:1-8`, `infra/README.md:10-13` (beta precedent) | verified locally |
| R2 lifecycle rules expire objects by age, set with `wrangler r2 bucket lifecycle add --expire-days` | https://developers.cloudflare.com/workers/wrangler/commands/r2/ | verified |

Two facts can only be measured at execution time: the image size (Task 3, gate ≤ 450 MB) and the cold start (Task 12, gate ≤ 10 s).

**GCP tool choice:** OpenTofu. The site's `infra/` already uses it, `tofu plan` reporting "No changes" is the drift check, and `tofu destroy` is the one-command teardown `COST.md` promises.

## Global Constraints

- $0 a month. Every resource here appears in `COST.md` with its free allowance and a teardown command.
- Region `us-central1` for every GCP resource.
- Cloud Run service: `min_instance_count = 0`, `max_instance_count = 2`, 1 vCPU, `1Gi`, `cpu_idle = true` (request-based billing), concurrency 10, timeout 30 s. Jobs: one task, `max_retries = 1`, timeout 900 s.
- No cron on GitHub Actions (spec §6.5). Scheduled work runs only on Cloud Scheduler.
- Secrets: the single Secret Manager secret `dealfinder-env` holds the contract's JSON. Secrets are never in the image, never in a `.env` on a host, and never printed. Scripts print key names, never values. Worker secrets are set with `wrangler secret put` from stdin.
- `load_dotenv()` never runs when `DEALFINDER_ENV=production`.
- When `EDGE_SHARED_SECRET` is set, the backend answers 403 to any request without a matching `X-DealFinder-Edge` header. `/healthz` and `/readyz` are exempt. The comparison is `hmac.compare_digest`.
- No deal page is ever served after 72 hours. Three layers enforce it: the 12-hour rebuild deletes pages it did not rebuild, the Worker refuses any object uploaded more than 72 hours ago, and an R2 lifecycle rule expires objects after 2 days.
- Deal pages carry only Best Buy data, with Best Buy attribution text on every page. The logo `<img src="/brand/bestbuy-logo.svg" alt="Best Buy">` appears once the owner supplies the real file (Plan 4 serves it from `frontend/public/brand/`). Never draw a stand-in logo. No eBay content, no AI-written text, no reviews or ratings in markup.
- The Worker adds `X-DealFinder-Edge` to every request it proxies to Cloud Run, `/lab` and `/lab/*` included. Plan 4's `/lab` route reads it.
- A deal page is `noindex` unless its `verdict` is not null. The sitemap lists only indexable pages.
- Until Plan 8's launch, the Worker sends `X-Robots-Tag: noindex` on every response (var `LAUNCHED = "false"`).
- Worker invocation logs stay off, so no URL with query text is logged (site precedent, `wrangler.jsonc:20`).
- Workflows pass every `${{ }}` expression through `env:`. No `${{ }}` appears inside a `run:` block.
- The offline suite stays green with no network, no DB and no cloud credentials. Ruff rules stay `E4, E7, E9, F`.
- Do not touch the 37 lessons or the step tags.
- Production changes need an explicit owner go, asked as "reply 'you do it'". That covers each `tofu apply`, the prod migration, the login role, a secrets push, the first `wrangler deploy`, the first job run and any merge to `main`.

## Review Focus

1. **The pages job stops for four days.** Expected: the Worker answers 404 for a deal page uploaded 72 h + 1 s ago and schedules its deletion. Pinned in Task 6, `stale deal page is 404 and deleted`.
2. **Best Buy is down for one rebuild.** Expected: the job fails loudly, keeps pages younger than 60 h, deletes older ones, and does not wipe the site. Pinned in Task 4, `test_unhealthy_build_keeps_recent_pages_but_drops_old_ones`.
3. **Someone calls the `run.app` URL directly to skip the edge rate limit.** Expected: 403 without the header or with a wrong one, while health checks still pass. Pinned in Task 2, `test_edge_guard_rejects_missing_or_wrong_header` and `test_edge_guard_exempts_health`.
4. **A signed-in user's request lands in the shared edge cache.** Expected: any request with `Authorization` bypasses the cache both ways, and only `/api/search` is ever cached. Pinned in Task 6, `authorized search bypasses the edge cache`.
5. **A product title holds `</script><script>alert(1)</script>` or a quote.** Expected: it cannot break out of the HTML or the JSON-LD. Pinned in Task 4, `test_deal_page_escapes_title_in_html_and_jsonld`.

---

### Task 1: Production settings and secret loading

**Files:**
- Create: `dealfinder/settings.py`
- Modify: `dealfinder/__init__.py:10-15`
- Modify: `.env.example` (document `DEALFINDER_ENV`, `DEALFINDER_SECRETS_JSON`)
- Test: `tests/test_settings.py`

**Interfaces:**
- Produces, as the contract defines:
  - `settings.is_production() -> bool` returns `os.getenv("DEALFINDER_ENV") == "production"`.
  - `settings.load_secrets() -> None` parses `DEALFINDER_SECRETS_JSON` as a JSON object of string values. It calls `os.environ.setdefault` for each key and never overrides a set variable. It raises `RuntimeError("DEALFINDER_SECRETS_JSON is not a JSON object")` on bad JSON and does nothing when the variable is unset. Error text never includes the value.
- `dealfinder/__init__.py` calls `settings.load_secrets()` first, then `load_dotenv()` only when `not settings.is_production()`.

- [ ] **Step 1: Write the failing tests**

```python
def test_load_secrets_expands_but_never_overrides(monkeypatch):
    monkeypatch.setenv("BESTBUY_API_KEY", "real")
    monkeypatch.delenv("EDGE_SHARED_SECRET", raising=False)
    monkeypatch.setenv("DEALFINDER_SECRETS_JSON", '{"BESTBUY_API_KEY": "blob", "EDGE_SHARED_SECRET": "s1"}')
    settings.load_secrets()
    assert (os.environ["BESTBUY_API_KEY"], os.environ["EDGE_SHARED_SECRET"]) == ("real", "s1")

def test_bad_json_fails_without_echoing(monkeypatch):
    monkeypatch.setenv("DEALFINDER_SECRETS_JSON", "not-json-hunter2")
    with pytest.raises(RuntimeError) as e:
        settings.load_secrets()
    assert "hunter2" not in str(e.value)

def test_production_never_reads_dotenv(monkeypatch, tmp_path):
    (tmp_path / ".env").write_text("SHOULD_NOT_LOAD=1\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DEALFINDER_ENV", "production")
    monkeypatch.delenv("SHOULD_NOT_LOAD", raising=False)
    importlib.reload(importlib.import_module("dealfinder"))
    assert "SHOULD_NOT_LOAD" not in os.environ
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_settings.py -v`. Expected: FAIL with `ImportError: cannot import name 'settings'`.

- [ ] **Step 3: Implement** `settings.py` and the `__init__.py` change. Update the package docstring: `.env` loads only outside production.

- [ ] **Step 4: Run and see them pass.** Run: `./.venv/bin/python -m pytest tests/test_settings.py -v && ./.venv/bin/python -m pytest -q`. Expected: 3 passed, and the suite stays green.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/settings.py dealfinder/__init__.py .env.example tests/test_settings.py
git commit -m "feat(settings): one JSON secret expands at startup; no .env in production"
```

---

### Task 2: Edge guard and in-app rate limits

**Files:**
- Create: `dealfinder/ratelimit.py`
- Modify: `dealfinder/serve.py` (two middlewares after `app = FastAPI(...)`, line 31)
- Test: `tests/test_ratelimit.py`, `tests/test_serve.py`

**Interfaces:**
- Consumes: `settings.is_production()` (Task 1). It reuses `compliance.SlidingWindowRateLimiter` (`compliance.py:34`) rather than writing a new window.
- Produces:
  - `ratelimit.LIMITS: dict[str, tuple[int, float]]` = `{"/ask": (5, 60), "/ask_agentic": (5, 60), "/search": (30, 10), "/search/stream": (30, 10), "/check": (30, 10), "/ranked": (30, 10), "/semantic": (30, 10)}`. `/search/stream` is the lab's SSE mode. The zone rule matches only the exact path `/api/search`, so this limit and the Worker's `STREAM_LIMITER` (Task 6) are its only cover.
  - `class ratelimit.Limiter(limits=LIMITS, *, clock=time.monotonic, max_keys=10_000)` with `check(path: str, client: str) -> float | None`. It returns `None` when allowed, or the retry-after seconds. Keys are `f"{path}|{client}"`. When the key count passes `max_keys`, it drops every key with no event inside its window.
  - `ratelimit.client_key(request) -> str` returns `CF-Connecting-IP`, else `request.client.host`. The Worker sets that header from the visitor's own IP (Task 6). It is trusted only because the edge guard passed first.
  - `ratelimit.enabled() -> bool` is `is_production() or os.getenv("DEALFINDER_RATELIMIT") == "on"`. That keeps other test modules from tripping limits.
  - Middleware `edge_guard` answers 403 `{"detail": "direct access not allowed"}`. It applies only when `EDGE_SHARED_SECRET` is set, and exempts `/healthz` and `/readyz`.
  - Middleware `rate_limit` answers 429 `{"detail": "slow down"}` with `Retry-After: <ceil seconds>` when enabled.
  - The limiter is per instance by design: Cloud Run caps at 2 instances, and the zone and Worker limits sit in front.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ratelimit.py
def test_ask_is_limited_hardest():
    t = [0.0]
    lim = ratelimit.Limiter(clock=lambda: t[0])
    assert all(lim.check("/ask", "1.2.3.4") is None for _ in range(5))
    assert lim.check("/ask", "1.2.3.4") > 0
    assert lim.check("/ask", "5.6.7.8") is None          # other clients unaffected
    t[0] = 61.0
    assert lim.check("/ask", "1.2.3.4") is None          # window slides

def test_search_stream_shares_the_search_limit():
    lim = ratelimit.Limiter(clock=lambda: 0.0)
    assert all(lim.check("/search/stream", "ip") is None for _ in range(30))
    assert lim.check("/search/stream", "ip") > 0

def test_unlisted_paths_are_not_limited():
    lim = ratelimit.Limiter()
    assert all(lim.check("/watchlist", "x") is None for _ in range(100))
# Also pin test_limiter_memory_is_bounded: 100 clients at max_keys=100, then one more after
# the window passes, leaves at most 2 keys.

# tests/test_serve.py
def test_edge_guard_rejects_missing_or_wrong_header(monkeypatch):
    monkeypatch.setenv("EDGE_SHARED_SECRET", "s3cret")
    assert client.get("/config.json").status_code == 403
    assert client.get("/config.json", headers={"X-DealFinder-Edge": "wrong"}).status_code == 403
    assert client.get("/config.json", headers={"X-DealFinder-Edge": "s3cret"}).status_code == 200

def test_edge_guard_exempts_health(monkeypatch):
    monkeypatch.setenv("EDGE_SHARED_SECRET", "s3cret")
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code in (200, 503)   # never 403

def test_rate_limit_returns_429_with_retry_after(monkeypatch, stub_sources):
    monkeypatch.setenv("DEALFINDER_RATELIMIT", "on")
    monkeypatch.setattr(serve, "_limiter", ratelimit.Limiter())
    codes = [client.get("/ask", params={"q": "x"}, headers={"CF-Connecting-IP": "9.9.9.9"}).status_code
             for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_ratelimit.py tests/test_serve.py -k "limit or edge_guard" -v`. Expected: FAIL with `ModuleNotFoundError: No module named 'dealfinder.ratelimit'`.

- [ ] **Step 3: Implement** `ratelimit.py`, the module global `serve._limiter = ratelimit.Limiter()`, and both middlewares. `edge_guard` runs first.

- [ ] **Step 4: Run and see them pass**, then the full offline suite. Expected: 7 passed. The suite stays green because neither env var is set by default.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/ratelimit.py dealfinder/serve.py tests/test_ratelimit.py tests/test_serve.py
git commit -m "feat(edge): shared-secret edge guard and per-instance rate limits, /ask hardest"
```

---

### Task 3: Production image

**Files:**
- Modify: `Dockerfile` (rewrite as two stages)
- Modify: `.dockerignore` (add `frontend/`, `edge/`, `deploy/`, `notebooks/`, `docs/`, `tests/`, `infra/`, `scripts/`, `course/`, `*.md` except `README.md`)
- Modify: `dealfinder/embed.py:36-44` (`_get_model` honors `DEALFINDER_MODEL_DIR`)
- Test: `tests/test_deploy.py`, `tests/test_embed.py`

**Interfaces:**
- Produces:
  - Build stage `python:3.11-slim`. It runs `pip install --no-cache-dir .` into `/opt/venv`, core dependencies only, with no `dev`, `torch`, `mlflow` or `prefect` extras. It bakes the model with `python -c "from dealfinder.embed import warm; warm()"` under `DEALFINDER_MODEL_DIR=/opt/models`.
  - Runtime stage `python:3.11-slim`. It copies `/opt/venv`, `/opt/models`, `dealfinder/` and `data/`. It sets `ENV DEALFINDER_MODEL_DIR=/opt/models HF_HUB_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1`. It adds user `app` with uid 10001 and sets `USER 10001`.
  - `CMD ["sh", "-c", "exec uvicorn dealfinder.serve:app --host 0.0.0.0 --port ${PORT:-8000}"]`
  - `embed._get_model()` passes `cache_dir=os.getenv("DEALFINDER_MODEL_DIR")` to `TextEmbedding` when set. Fix the stale "~130MB" comment at `embed.py:24` to the measured 66.5 MB.
  - The same image runs the jobs: `python -m dealfinder.jobs <name>` (Task 5).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_deploy.py — keep the three existing tests, add:
def test_dockerfile_is_production_shaped():
    df = Path("Dockerfile").read_text()
    users = [l.split()[1] for l in df.splitlines() if l.startswith("USER ")]
    assert users and users[-1] not in ("root", "0")
    assert "${PORT:-8000}" in df
    assert "DEALFINDER_MODEL_DIR=/opt/models" in df and "HF_HUB_OFFLINE=1" in df

def test_image_excludes_dev_trees():
    ignored = Path(".dockerignore").read_text().split()
    assert {"frontend/", "edge/", "deploy/", "tests/", "notebooks/", ".env"} <= set(ignored)

# tests/test_embed.py
def test_model_dir_is_honored(monkeypatch):
    seen = {}
    class Fake:
        def __init__(self, name, **kw): seen.update(kw)
    monkeypatch.setattr("fastembed.TextEmbedding", Fake)
    monkeypatch.setattr(embed, "_model", None)
    monkeypatch.setenv("DEALFINDER_MODEL_DIR", "/opt/models")
    embed._get_model()
    assert seen["cache_dir"] == "/opt/models"
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_deploy.py tests/test_embed.py -v`. Expected: FAIL. There is no `USER` line, no `$PORT` and no `cache_dir`.

- [ ] **Step 3: Implement** the Dockerfile, `.dockerignore` and `embed.py` change.

- [ ] **Step 4: Run and see them pass.** Expected: all pass. `test_healthcheck_path_exists_in_deploy_config` still passes, because `render.yaml` stays for the course.

- [ ] **Step 5: Measure: build, size gate, offline model**

Run:
```bash
docker build -t dealfinder:prod .
docker save dealfinder:prod | gzip -1 | wc -c          # compressed bytes
docker run --rm --network none -e PORT=8080 -p 8080:8080 -d --name df-offline dealfinder:prod
sleep 8 && curl -fsS localhost:8080/healthz && \
  docker exec df-offline python -c "from dealfinder.embed import embed_texts; print(embed_texts(['tv']).shape)"
docker exec df-offline id -u ; docker rm -f df-offline
```
Expected:
- The compressed size is **≤ 450,000,000 bytes**. Artifact Registry gives 0.5 GB free.
- `/healthz` answers, and the embed prints `(1, 384)` with no network.
- `id -u` prints `10001`.

If the size gate fails, cut in this order and re-measure each time: strip `__pycache__` and `tests` dirs from site-packages, move `stripe` and `mcp` behind lazy imports and an extra if the production routes never import them, then drop `selectolax` if only scrapers use it. Record the final number in the commit message.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore dealfinder/embed.py tests/test_deploy.py tests/test_embed.py
git commit -m "build: non-root prod image with the embedding model baked in (<N> MB compressed)"
```

---

### Task 4: Static deal pages

**Files:**
- Create: `dealfinder/pages.py`
- Create: `dealfinder/templates/deal_page.html`, `dealfinder/templates/deal.css`
- Create: `data/tracked_queries.txt` (40 electronics queries, one per line, `#` comments allowed)
- Modify: `pyproject.toml` (`package-data`: `templates/*`)
- Test: `tests/test_pages.py`

**Interfaces:**
- Consumes: `shop.shop_search(q, k=12) -> dict` (Plan 2, contract shape). It reads only `results[]` and `attribution`, and ignores `ebay`. It skips any row whose `slug` is `null` or whose `source` fails `licensing.may_store`, so no page is ever built for a row without a Best Buy SKU. Also `retention.purge_expired` (Plan 2), via Task 5.
- Produces, as the contract names them:
  - `pages.SITE = "https://deals.cloudcodetree.com"`, `pages.MAX_AGE_S = 72 * 3600`, `pages.KEEP_ON_FAILURE_S = 60 * 3600`.
  - `render_deal_page(item: dict, *, built_at: datetime, logo: bool = False) -> str`. The contract's two required arguments are unchanged. `build_pages` passes `logo=os.getenv("DEALFINDER_BESTBUY_LOGO") == "1"`, a plain env var Task 12 turns on once the real file is deployed. It uses `string.Template` plus `html.escape`, with no new dependency. The JSON-LD is `json.dumps(...)` with every `<` replaced by its JSON unicode escape (a backslash, then `u003c`), so a title can never close the script tag. The page contains:
    - the canonical URL `f"{SITE}/deal/{slug}"`
    - Open Graph `og:title`, `og:description` (the item's `reason`), `og:url`, `og:type=product`, and `og:image` only when `image_url` is set
    - `<meta name="robots" content="noindex">` when `verdict` is null
    - a schema.org `Product` with `name`, `brand`, `sku`, `image`, and `offers: {"@type": "Offer", "price", "priceCurrency": "USD", "url", "seller": {"@type": "Organization", "name": "Best Buy"}}`. It never has `review`, `aggregateRating` or `availability`.
    - the verdict badge and `reason` exactly as Plan 2 returned them
    - `regular_price` struck through with the text equivalent `Regular price $X at Best Buy`
    - "Prices checked {built_at:%Y-%m-%d %H:%M} UTC. Prices change. Check Best Buy before you buy."
    - the attribution text "Prices and product data from Best Buy" linking to `https://www.bestbuy.com`, always. When `logo=True` it is preceded by `<img src="/brand/bestbuy-logo.svg" alt="Best Buy">`. That file is Plan 4's `frontend/public/brand/bestbuy-logo.svg`, holding only the owner-supplied official asset.
    - links to `/`, `/how-we-rank` and `/privacy`
  - `render_sitemap(slugs: list[str], *, built_at: datetime) -> str`
  - `ROBOTS_TXT` disallows `/api/` and `/lab` and names `{SITE}/sitemap.xml`.
  - `build_pages(queries: list[str], *, report: dict | None = None) -> dict[str, str]` returns keys `deal/<slug>.html`, `sitemap.xml` and `robots.txt`. It keeps the latest copy of a duplicate slug and sleeps `PAGES_QUERY_DELAY_S = 0.3` between queries to stay under Best Buy's 5 calls a second. It fills `report` with `queries_ok`, `queries_failed` and `indexable`. A query that raises or returns no results counts as failed.
  - `class PageStore(Protocol)`: `get(key) -> bytes | None`, `put(key, body: bytes, content_type: str) -> None`, `delete(key) -> None`.
  - `DirPageStore(root: Path)`
  - `R2PageStore.from_env()` reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_R2_TOKEN` and uses `httpx` against `https://api.cloudflare.com/client/v4/accounts/{id}/r2/buckets/dealfinder-pages/objects/{key}`. The key is quoted with `safe="/"`, so `deal/x.html` stays a path. The site's `r2Put` encodes `/` and stores flat keys, which the Worker would never find. Errors never include the token.
  - `publish(pages: dict[str, str], store: PageStore, *, healthy: bool = True, now: datetime | None = None) -> dict` returns `{"put", "deleted", "kept_stale"}`. The manifest key is `manifest.json`, holding `{"version": 1, "pages": {key: iso_built_at}}`. The order is crash-safe:
    1. read the old manifest M0
    2. put every new page
    3. write the manifest as N ∪ M0
    4. delete each key in M0 − N. When `healthy` is false, keep any key younger than `KEEP_ON_FAILURE_S`.
    5. write the final manifest

- [ ] **Step 1: Write the failing tests**

```python
ITEM = {"id": "bestbuy-6505727", "sku": "6505727", "slug": "sony-wh-1000xm5-bestbuy-6505727",
        "title": "Sony WH-1000XM5", "brand": "Sony", "source": "BestBuy", "price": 299.99,
        "regular_price": 399.99, "url": "https://www.bestbuy.com/site/6505727.p", "image_url": None,
        "verdict": "deal", "reason": "18% under the median and consistent with the price model (~$331) — a genuine deal."}
NOW = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)

def _jsonld(html):
    return json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S).group(1))

def test_page_has_product_schema_and_attribution():
    html = pages.render_deal_page(ITEM, built_at=NOW)
    ld = _jsonld(html)
    assert ld["@type"] == "Product" and ld["offers"]["price"] == "299.99"
    assert not {"review", "aggregateRating"} & set(ld)
    assert "Prices and product data from Best Buy" in html
    assert '/brand/bestbuy-logo.svg' not in html                     # text only until the real logo ships
    assert '<img src="/brand/bestbuy-logo.svg" alt="Best Buy">' in pages.render_deal_page(ITEM, built_at=NOW, logo=True)
    assert 'rel="canonical" href="https://deals.cloudcodetree.com/deal/sony-wh-1000xm5-bestbuy-6505727"' in html
    assert "noindex" not in html and "Regular price $399.99 at Best Buy" in html

def test_page_without_verdict_is_noindex_and_left_out_of_sitemap(monkeypatch):
    html = pages.render_deal_page({**ITEM, "verdict": None}, built_at=NOW)
    assert '<meta name="robots" content="noindex">' in html
    plain = {**ITEM, "slug": "plain-bestbuy-1", "verdict": None}
    monkeypatch.setattr(pages.shop, "shop_search", lambda q, k=12: {"results": [ITEM, plain], "attribution": []})
    monkeypatch.setattr(pages, "PAGES_QUERY_DELAY_S", 0)
    sitemap = pages.build_pages(["headphones"])["sitemap.xml"]
    assert ITEM["slug"] in sitemap and "plain-bestbuy-1" not in sitemap

def test_deal_page_escapes_title_in_html_and_jsonld():
    evil = {**ITEM, "title": '</script><script>alert(1)</script> "q"'}
    html = pages.render_deal_page(evil, built_at=NOW)
    assert "<script>alert(1)</script>" not in html
    assert _jsonld(html)["name"] == evil["title"]           # JSON-LD still parses to the real title

def test_build_pages_ignores_ebay_and_counts_failures(monkeypatch):
    def fake(q, k=12):
        if q == "boom": raise RuntimeError("down")
        return {"results": [ITEM], "ebay": {"items": [{"title": "EBAY-ONLY"}]}, "attribution": []}
    monkeypatch.setattr(pages.shop, "shop_search", fake)
    monkeypatch.setattr(pages, "PAGES_QUERY_DELAY_S", 0)
    report = {}
    out = pages.build_pages(["headphones", "boom"], report=report)
    assert set(out) == {"deal/sony-wh-1000xm5-bestbuy-6505727.html", "sitemap.xml", "robots.txt"}
    assert "EBAY-ONLY" not in "".join(out.values())
    assert report == {"queries_ok": 1, "queries_failed": 1, "indexable": 1}

def test_build_pages_skips_rows_without_slug_or_storage(monkeypatch):
    noslug = {**ITEM, "id": "itunes-1", "slug": None, "source": "iTunes"}
    monkeypatch.setattr(pages.shop, "shop_search", lambda q, k=12: {"results": [ITEM, noslug], "attribution": []})
    monkeypatch.setattr(pages, "PAGES_QUERY_DELAY_S", 0)
    out = pages.build_pages(["headphones"])
    assert [k for k in out if k.startswith("deal/")] == ["deal/sony-wh-1000xm5-bestbuy-6505727.html"]

def test_unhealthy_build_keeps_recent_pages_but_drops_old_ones(tmp_path):
    store = pages.DirPageStore(tmp_path)
    pages.publish({"deal/old.html": "O"}, store, now=NOW)
    pages.publish({"deal/new.html": "N", "deal/old.html": "O"}, store, now=NOW + timedelta(hours=50))
    r = pages.publish({}, store, healthy=False, now=NOW + timedelta(hours=61))
    assert store.get("deal/new.html") is not None     # 11 h old: kept
    assert store.get("deal/old.html") is not None     # rebuilt at +50 h: 11 h old, kept
    r = pages.publish({}, store, healthy=False, now=NOW + timedelta(hours=111))
    assert store.get("deal/new.html") is None and store.get("deal/old.html") is None   # 61 h: dropped

def test_publish_is_crash_safe(tmp_path):
    store = pages.DirPageStore(tmp_path)
    pages.publish({"deal/a.html": "A", "deal/b.html": "B"}, store, now=NOW)
    class Boom(pages.DirPageStore):
        def delete(self, key): raise OSError("network")
    with pytest.raises(OSError):
        pages.publish({"deal/c.html": "C"}, Boom(tmp_path), now=NOW)
    pages.publish({"deal/c.html": "C"}, store, now=NOW)
    assert {k for k in json.loads(store.get("manifest.json"))["pages"]} == {"deal/c.html"}
    assert store.get("deal/a.html") is None and store.get("deal/b.html") is None

def test_r2_store_keeps_slashes_in_keys():
    s = pages.R2PageStore(account_id="acct", token="t")
    assert s._object_url("deal/x.html").endswith("/r2/buckets/dealfinder-pages/objects/deal/x.html")
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_pages.py -v`. Expected: FAIL with `ModuleNotFoundError: No module named 'dealfinder.pages'`.

- [ ] **Step 3: Implement** `pages.py`, the two templates and `tracked_queries.txt`. `deal.css` uses the Nocturne variable names from `dealfinder/static/redesign.html`. Plan 4 tests that the values match `frontend/src/theme/tokens.css`. Pick queries the trained category models cover (the snapshot's categories), so most pages get `basis: "model"`.

- [ ] **Step 4: Run and see them pass.** Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/pages.py dealfinder/templates data/tracked_queries.txt pyproject.toml tests/test_pages.py
git commit -m "feat(pages): static Best Buy deal pages with schema.org, noindex-until-verdict, crash-safe publish"
```

The logo file belongs to Plan 4. This plan only references its path.

---

### Task 5: Jobs runner and dead-man's-switch pings

**Files:**
- Create: `dealfinder/jobs.py`, `dealfinder/healthcheck.py`
- Test: `tests/test_jobs.py`

**Interfaces:**
- Consumes: `retention.purge_expired(now=None, url=None) -> dict[str, int]` (Plan 2), plus `pages.build_pages`, `pages.publish` and `pages.R2PageStore.from_env` (Task 4).
- Produces, as the contract names them:
  - `healthcheck.ping(check: str, status: str = "ok") -> None` reads `HEALTHCHECK_{CHECK.upper()}_URL` and does a GET on `url`, `url + "/start"` or `url + "/fail"` with a 5 s timeout. It swallows every error and never logs the URL.
  - `jobs.JOBS: dict[str, Callable[[], dict]]` and `jobs.register(name: str)`, a decorator Plan 5 uses for `alerts`.
  - `jobs.run_job(name: str) -> int` pings `start`, runs the job, prints one JSON line `{"job", "ok", "summary"}` (no secrets, no user data), pings `ok` or `fail`, and returns 0 or 1. An unknown name prints the known jobs to stderr and returns 2.
  - `jobs.main(argv: list[str] | None = None) -> int`. `python -m dealfinder.jobs pages|purge` calls `sys.exit(main())`.
  - The `pages` job runs `purge_expired()`, then `build_pages(load_tracked_queries(), report=r)`, then `publish(..., healthy=r["queries_failed"] <= r["queries_ok"])`. It returns a summary. It **raises** `RuntimeError("unhealthy build: N of M queries failed")` after publishing when unhealthy, so the switch alerts the owner.
  - The `purge` job runs `purge_expired()` and returns its counts.
  - Both jobs ping check `pages`. `HEALTHCHECK_PAGES_URL` is from the contract.

- [ ] **Step 1: Write the failing tests**

```python
def test_run_job_pings_start_then_ok(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(jobs.healthcheck, "ping", lambda c, s="ok": calls.append((c, s)))
    monkeypatch.setitem(jobs.JOBS, "demo", lambda: {"n": 1})
    monkeypatch.setitem(jobs.CHECKS, "demo", "pages")
    assert jobs.run_job("demo") == 0
    assert calls == [("pages", "start"), ("pages", "ok")]
    assert json.loads(capsys.readouterr().out) == {"job": "demo", "ok": True, "summary": {"n": 1}}

def test_run_job_pings_fail_and_returns_1(monkeypatch):
    calls = []
    monkeypatch.setattr(jobs.healthcheck, "ping", lambda c, s="ok": calls.append(s))
    monkeypatch.setitem(jobs.JOBS, "demo", lambda: 1 / 0)
    monkeypatch.setitem(jobs.CHECKS, "demo", "pages")
    assert jobs.run_job("demo") == 1 and calls == ["start", "fail"]

def test_pages_job_fails_loudly_when_unhealthy(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs.retention, "purge_expired", lambda **k: {"offers": 0})
    monkeypatch.setattr(jobs.pages, "build_pages", lambda qs, report: report.update(queries_ok=1, queries_failed=3, indexable=0) or {})
    monkeypatch.setattr(jobs.pages.R2PageStore, "from_env", classmethod(lambda cls: jobs.pages.DirPageStore(tmp_path)))
    with pytest.raises(RuntimeError, match="unhealthy build: 3 of 4"):
        jobs.JOBS["pages"]()

# Also pin: test_unknown_job_is_exit_2 (jobs.main(["alerts-typo"]) == 2), and
# test_healthcheck_never_raises (no URL is a no-op; an unreachable URL is swallowed).
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_jobs.py -v`. Expected: FAIL with `ModuleNotFoundError: No module named 'dealfinder.jobs'`.

- [ ] **Step 3: Implement** `healthcheck.py` and `jobs.py`. `jobs.CHECKS: dict[str, str]` maps a job name to its health check name, with `pages` and `purge` both mapping to `pages`.

- [ ] **Step 4: Run and see them pass.** Expected: 5 passed. Then a local dry run with a `DirPageStore`:
`./.venv/bin/python -c "from dealfinder import pages; from pathlib import Path; print(pages.publish(pages.build_pages(['tv']), pages.DirPageStore(Path('/tmp/df-pages'))))"`. Open one generated file in the browser and check the attribution.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/jobs.py dealfinder/healthcheck.py tests/test_jobs.py
git commit -m "feat(jobs): pages and purge jobs with start/ok/fail dead-man's-switch pings"
```

---

### Task 6: The deals Worker

**Files:**
- Create: `edge/package.json` (`wrangler`, `vitest`, `@cloudflare/workers-types`, `typescript`, pinned to the versions the site's `package.json` uses), `edge/package-lock.json`
- Create: `edge/wrangler.jsonc`, `edge/tsconfig.json`, `edge/vitest.config.ts` (`environment: 'node'`, the site's pattern)
- Create: `edge/src/index.ts`, `edge/src/index.test.ts`
- Modify: `.github/workflows/ci.yml` (job `edge`: `npm ci && npm test && npx tsc --noEmit` in `edge/`)

**Interfaces:**
- Consumes: the contract's URL map, and `EDGE_SHARED_SECRET` (Task 2).
- `edge/wrangler.jsonc`:
  - `"name": "dealfinder-edge"`, `"main": "src/index.ts"`, `"compatibility_date": "2026-10-20"`
  - `"routes": [{ "pattern": "deals.cloudcodetree.com", "custom_domain": true }]`
  - `"assets": { "directory": "../frontend/dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/lab", "/lab/*", "/deal/*", "/sitemap.xml", "/robots.txt"] }`
  - `"r2_buckets": [{ "binding": "PAGES", "bucket_name": "dealfinder-pages" }]`
  - `"ratelimits": [{ "name": "ASK_LIMITER", "namespace_id": "4201", "simple": { "limit": 5, "period": 60 } }, { "name": "STREAM_LIMITER", "namespace_id": "4202", "simple": { "limit": 30, "period": 10 } }]`. The site uses 4101 and 4102, so these share no counters. `STREAM_LIMITER` covers `/api/search/stream`, which the zone rule does not match.
  - `"vars": { "BACKEND_ORIGIN": "<Task 12: tofu output api_url>", "LAUNCHED": "false" }`
  - `"observability": { "enabled": true, "logs": { "enabled": true, "invocation_logs": false } }`
  - Secret: `EDGE_SHARED_SECRET`
- Produces, exported from `edge/src/index.ts` for tests:
  - `routeOf(pathname: string): "api" | "lab" | "deal" | "r2root" | "assets"`
  - `dealKey(pathname: string): string | null` returns `deal/<slug>.html` only when the slug matches `^[a-z0-9-]{1,120}$`, else `null`.
  - `searchCacheKey(url: URL): string | null`. For `/api/search` it returns `https://deals.cloudcodetree.com/api/search?k=<k>&q=<q>`, with `q` trimmed, lowercased and whitespace-collapsed, and `k` defaulting to `12`. Every other parameter is dropped. It returns `null` for any other path.
  - `default { fetch(request, env, ctx) }`:
    - `api`: strip `/api` and forward to `BACKEND_ORIGIN` with the method, body and headers. Set `X-DealFinder-Edge`, set `CF-Connecting-IP` to the visitor's inbound value, and drop any inbound `X-DealFinder-Edge`.
      - For `/api/ask` and `/api/ask_agentic`, call `ASK_LIMITER.limit({ key: ip })` first and answer 429 when it fails. For `/api/search/stream`, do the same with `STREAM_LIMITER`.
      - For a `GET /api/search` with no `Authorization` header, use `caches.default` with the cache key. Store only a 200, with `Cache-Control: public, s-maxage=300`. Add `X-DealFinder-Cache: HIT|MISS`.
      - Backend 5xx or a network error becomes 503 `{"detail": "backend unavailable"}`.
    - `lab`: forward with the path unchanged. It sets the same `X-DealFinder-Edge` and `CF-Connecting-IP` headers as `api`, because the edge guard covers `/lab` too and Plan 4's `/lab` route reads the header to point the lab at `/api`.
    - `deal`: `PAGES.get(key)`. A missing or invalid key is a 404 HTML page linking to `/`. When `Date.now() - obj.uploaded > 72 h`, answer 404 and call `ctx.waitUntil(env.PAGES.delete(key))`. Otherwise answer 200 `text/html; charset=utf-8` with `Cache-Control: public, max-age=300`.
    - `r2root`: `/sitemap.xml` and `/robots.txt` from R2. Only those two keys. `manifest.json` is never served.
    - `assets`: `env.ASSETS.fetch(request)`
    - Every response gets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Robots-Tag: noindex` while `LAUNCHED !== "true"`.

- [ ] **Step 1: Write the failing tests** in `edge/src/index.test.ts`. Use plain mocks: an `R2` stub with `get`, `delete`, a `ctx` collecting `waitUntil` promises, `vi.stubGlobal('fetch', ...)`, and a `caches.default` stub keyed by URL.

```ts
it('routes the contract table', () => {
  expect(routeOf('/api/search')).toBe('api'); expect(routeOf('/lab')).toBe('lab');
  expect(routeOf('/lab/x')).toBe('lab');      expect(routeOf('/deal/a-b')).toBe('deal');
  expect(routeOf('/sitemap.xml')).toBe('r2root'); expect(routeOf('/manifest.json')).toBe('assets');
  expect(routeOf('/watchlist')).toBe('assets');
});
it('rejects slugs that could escape the deal prefix', () => {
  expect(dealKey('/deal/sony-xm5-bestbuy-1')).toBe('deal/sony-xm5-bestbuy-1.html');
  for (const p of ['/deal/../manifest', '/deal/A', '/deal/x%2Fy', '/deal/']) expect(dealKey(p)).toBeNull();
});
it('strips /api and adds the edge secret and client IP', async () => {
  const res = await call('/api/watchlist', { headers: { 'CF-Connecting-IP': '1.2.3.4', 'X-DealFinder-Edge': 'forged' } });
  const sent = lastFetch();
  expect(sent.url).toBe('https://backend.test/watchlist');
  expect(sent.headers.get('X-DealFinder-Edge')).toBe('s3cret');
  expect(sent.headers.get('CF-Connecting-IP')).toBe('1.2.3.4');
});
it('caches anonymous search under a normalized key', async () => {
  await call('/api/search?q=%20Noise%20%20Cancelling&utm=x');
  const second = await call('/api/search?q=noise%20cancelling');
  expect(second.headers.get('X-DealFinder-Cache')).toBe('HIT');
  expect(fetchCount()).toBe(1);
});
it('authorized search bypasses the edge cache', async () => {
  await call('/api/search?q=tv', { headers: { Authorization: 'Bearer t' } });
  await call('/api/search?q=tv', { headers: { Authorization: 'Bearer t' } });
  expect(fetchCount()).toBe(2); expect(cachePuts()).toBe(0);
});
it('limits /api/ask and /api/search/stream', async () => {
  env.ASK_LIMITER = { limit: async () => ({ success: false }) };
  env.STREAM_LIMITER = { limit: async () => ({ success: false }) };
  expect((await call('/api/ask?q=x')).status).toBe(429);
  expect((await call('/api/search/stream?q=x')).status).toBe(429);
});
it('proxies /lab with the edge secret and the path unchanged', async () => {
  await call('/lab/static/x.js', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
  const sent = lastFetch();
  expect(sent.url).toBe('https://backend.test/lab/static/x.js');
  expect(sent.headers.get('X-DealFinder-Edge')).toBe('s3cret');
});
it('stale deal page is 404 and deleted', async () => {
  pages.set('deal/a.html', { body: '<html>', uploaded: new Date(Date.now() - 72 * 3600e3 - 1000) });
  const res = await call('/deal/a');
  await Promise.all(waited);
  expect(res.status).toBe(404); expect(pages.has('deal/a.html')).toBe(false);
});
it('fresh deal page is served', async () => {
  pages.set('deal/a.html', { body: '<html>ok', uploaded: new Date() });
  const res = await call('/deal/a');
  expect(res.status).toBe(200); expect(await res.text()).toContain('ok');
});
it('backend outage is a clean 503', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('down'); });
  expect((await call('/api/search?q=tv')).status).toBe(503);
});
it('everything is noindex before launch', async () => {
  expect((await call('/deal/missing')).headers.get('X-Robots-Tag')).toBe('noindex');
});
```

- [ ] **Step 2: Run and see them fail.** Run: `cd edge && npm ci && npx vitest run`. Expected: FAIL, because `./index` exports nothing.

- [ ] **Step 3: Implement** `edge/src/index.ts`, the `ci.yml` `edge` job, and `wrangler.jsonc`.

- [ ] **Step 4: Run and see them pass.** Run: `cd edge && npx vitest run && npx tsc --noEmit && npx wrangler deploy --dry-run --outdir /tmp/df-edge`. Expected: 11 passed, no type errors, and the dry run bundles.

- [ ] **Step 5: Commit**

```bash
git add edge/package.json edge/package-lock.json edge/wrangler.jsonc edge/tsconfig.json edge/vitest.config.ts edge/src/index.ts edge/src/index.test.ts .github/workflows/ci.yml
git commit -m "feat(edge): dealfinder-edge Worker: /api proxy, edge cache, /ask limit, 72h-guarded deal pages"
```

---

### Task 7: R2 bucket in the site's OpenTofu (site repo)

**Files (site repo, branch `feat/deals-infra`):**
- Modify: `infra/r2.tf` (add `cloudflare_r2_bucket.dealfinder_pages`)
- Modify: `infra/dns.tf:3-8` and `infra/README.md:10-16` (add "not here" lines: the `deals.cloudcodetree.com` custom domain and its record are owned by the companion's `edge/wrangler.jsonc`, and the bucket's lifecycle rule is owned by wrangler)

**Interfaces:**
- Produces: bucket `dealfinder-pages`, `location = "WNAM"`, `storage_class = "Standard"`, `jurisdiction = "default"`, the same as `blog_images`. The lifecycle rule `expire-2d` (`--expire-days 2`) is added with wrangler in Task 12, because this file owns the bucket only.

- [ ] **Step 1: Add the resource and the doc lines.**

- [ ] **Step 2: Plan**

Run: `node scripts/tofu.mjs plan`
Expected: `Plan: 1 to add, 0 to change, 0 to destroy.`, and the one resource is `cloudflare_r2_bucket.dealfinder_pages`. Any other change means drift. Stop and report it.

- [ ] **Step 3: Commit and open the PR**

```bash
git add infra/r2.tf infra/dns.tf infra/README.md
git commit -m "infra: R2 bucket dealfinder-pages for DealFinder's static deal pages"
git push -u origin feat/deals-infra && gh pr create --fill
```

`tofu apply` and the merge each need the owner's "you do it" (Task 12).

---

### Task 8: GCP infrastructure in OpenTofu

**Files:**
- Create: `deploy/gcp/versions.tf`, `variables.tf`, `apis.tf`, `registry.tf`, `iam.tf`, `secrets.tf`, `run.tf`, `jobs.tf`, `scheduler.tf`, `wif.tf`, `budget.tf`, `outputs.tf`, `README.md`, `.gitignore`
- Test: `tests/test_gcp_config.py`

**Interfaces:**
- Variables: `project_id`, `region = "us-central1"`, `billing_account`, `github_repo = "cloudcodetree/tutorial-dealfinder"`, `bootstrap_image = "us-docker.pkg.dev/cloudrun/container/hello"`, `supabase_url`, `supabase_publishable_key`, `verdict_mode = "live"`, `bestbuy_logo = false`.
- `apis.tf` enables `run`, `cloudscheduler`, `secretmanager`, `artifactregistry`, `iam`, `iamcredentials`, `sts` and `billingbudgets`.
- `registry.tf`: Docker repo `dealfinder`. Cleanup policies: `keep-2` (KEEP, `most_recent_versions.keep_count = 2`) and `delete-rest` (DELETE, `tag_state = "ANY"`). `cleanup_policy_dry_run = false`.
- `iam.tf` service accounts:
  - `dealfinder-run` has `roles/secretmanager.secretAccessor` on `dealfinder-env` only.
  - `dealfinder-scheduler` has `roles/run.invoker` on the two jobs only.
  - `dealfinder-deploy` has `roles/run.developer` on the project, `roles/artifactregistry.writer` on the repo, and `roles/iam.serviceAccountUser` on `dealfinder-run`.
- `secrets.tf`: the secret `dealfinder-env` only, automatic replication, **no** `google_secret_manager_secret_version`. Values never enter state. Task 9 pushes versions.
- `run.tf`: `google_cloud_run_v2_service.api`, name `dealfinder-api`. The Global Constraints sizing applies.
  - `ingress = "INGRESS_TRAFFIC_ALL"`, `deletion_protection = false`, `startup_cpu_boost = true`
  - Plain env: `DEALFINDER_ENV=production`, `DEALFINDER_SOURCES=BestBuy`, `DEALFINDER_VERDICT_MODE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `DEALFINDER_BESTBUY_LOGO` (`"1"` when `var.bestbuy_logo`)
  - `DEALFINDER_SECRETS_JSON` from `secret_key_ref { secret = "dealfinder-env", version = "latest" }`
  - `lifecycle { ignore_changes = [template[0].containers[0].image, client, client_version] }`, so CI owns the image
  - `allUsers` invoker. The edge guard is the access control, because the Worker cannot mint Google ID tokens cheaply.
- `jobs.tf`: `dealfinder-pages` and `dealfinder-alerts` on the same image, env and secret. `command = ["python", "-m", "dealfinder.jobs"]`, args `["pages"]` and `["alerts"]`. Image ignored the same way.
- `scheduler.tf`:
  - `dealfinder-pages`, schedule `0 */12 * * *`, time zone `Etc/UTC`
  - `dealfinder-alerts`, schedule `30 13 * * *`, **`paused = true`** until Plan 5 registers the job
  - Each is an HTTP POST to `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/<name>:run` with `oauth_token { service_account_email = dealfinder-scheduler }` and `retry_config { retry_count = 1 }`.
- `wif.tf`:
  - pool `github` and provider `github` with issuer `https://token.actions.githubusercontent.com`
  - `attribute_mapping` for `google.subject`, `attribute.repository` and `attribute.ref`
  - `attribute_condition = "assertion.repository == '${var.github_repo}' && assertion.ref == 'refs/heads/main'"`
  - `roles/iam.workloadIdentityUser` on `dealfinder-deploy` for `principalSet://iam.googleapis.com/${pool}/attribute.repository/${var.github_repo}`
- `budget.tf`: `google_billing_budget`, `amount.specified_amount = { currency_code = "USD", units = "1" }`, filtered to this project. Threshold rules 0.5, 0.9 and 1.0 on current spend, plus 1.0 forecasted. The provider block for budgets sets `user_project_override = true` and `billing_project = var.project_id`.
- `outputs.tf`: `api_url`, `wif_provider`, `deploy_service_account`, `registry`.
- `.gitignore`: state, `.terraform/`, `*.tfvars`. **Commit** `.terraform.lock.hcl`, unlike `infra/`, because this stack is production.

- [ ] **Step 1: Write the failing static checks** in `tests/test_gcp_config.py`. They read the `.tf` text and need no network.

`TF` is every `deploy/gcp/*.tf` joined. One test per line, regex over `TF`:

| Test | Assertion |
|---|---|
| `test_scales_to_zero_and_is_capped` | `min_instance_count = 0` and `max_instance_count = 2` |
| `test_everything_is_in_us_central1` | the `region` default is `"us-central1"` |
| `test_no_secret_values_in_state` | `google_secret_manager_secret_version` never appears |
| `test_alerts_schedule_starts_paused` | the `dealfinder-alerts` scheduler block has `paused = true` |
| `test_wif_is_pinned_to_this_repo_and_main` | the condition holds `assertion.repository ==` and `assertion.ref == 'refs/heads/main'` |
| `test_ci_owns_the_image` | `ignore_changes` appears at least 3 times (service and two jobs) |
| `test_budget_is_one_dollar` | `units = "1"` |

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_gcp_config.py -v`. Expected: FAIL, because `deploy/gcp` does not exist.

- [ ] **Step 3: Write the `.tf` files and `deploy/gcp/README.md`.** The README covers init, plan, apply and destroy, and which steps need the owner.

- [ ] **Step 4: Validate**

Run: `./.venv/bin/python -m pytest tests/test_gcp_config.py -v && tofu -chdir=deploy/gcp init -backend=false && tofu -chdir=deploy/gcp validate`
Expected: 7 passed, and `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
git add deploy/gcp tests/test_gcp_config.py
git commit -m "infra(gcp): Cloud Run service + jobs, Scheduler, one secret, WIF, AR cleanup, \$1 budget"
```

---

### Task 9: Secrets push and the production login role

**Files:**
- Create: `deploy/secrets.py`, `deploy/create_login_role.py`
- Test: `tests/test_deploy_scripts.py`

**Interfaces:**
- `deploy/secrets.py`:
  - `KEYS` is the contract's secret key list.
  - `build_payload(env: dict[str, str]) -> str` returns compact JSON of only the `KEYS` present.
  - `push(payload: str, *, project: str, run=subprocess.run) -> int`. It runs `gcloud secrets versions add dealfinder-env --data-file=- --project <p>` with the payload on stdin, then destroys every older enabled or disabled version. That keeps one active version, inside the free 6. It returns the new version number.
  - `current(*, project, run=subprocess.run) -> dict` runs `gcloud secrets versions access latest`. The result is never printed.
  - `merge(updates: dict, *, project, run=...) -> int` pushes `current() | updates`.
  - CLI `python deploy/secrets.py push --project P`: reads the companion `.env` itself, prints `✓ dealfinder-env v<N>: <comma-joined key names>`, and never prints a value. `EDGE_SHARED_SECRET` and `UNSUBSCRIBE_SECRET` are generated with `secrets.token_urlsafe(32)` when absent.
  - CLI `python deploy/secrets.py edge --project P`: pipes the stored `EDGE_SHARED_SECRET` into `npx wrangler secret put EDGE_SHARED_SECRET` (cwd `edge/`) through stdin.
- `deploy/create_login_role.py`, CLI `--project P [--rotate]`:
  - It connects with the admin connection the script reads from the env file itself (`MIGRATION_DATABASE_URL`, else `SUPABASE_DIRECT_CON_STRING`).
  - It runs `CREATE ROLE dealfinder_svc LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD <literal>`, or `ALTER ROLE ... PASSWORD` with `--rotate`. The password comes from `secrets.token_urlsafe(32)` and goes through `psycopg.sql.Literal`.
  - It grants `dealfinder_app` and `dealfinder_job` to `dealfinder_svc`. It also grants `USAGE ON SCHEMA dealfinder` and `SELECT ON dealfinder.schema_migrations` directly, because NOINHERIT would otherwise make `migrate.schema_ready()` and `/readyz` read "pending".
  - It reads the pooler host from the Supabase Management API `GET /v1/projects/{ref}/config/database/pooler`, with the token read from the site's env file. It builds `postgresql://dealfinder_svc.{ref}:{pw}@{host}:6543/postgres?sslmode=require` and calls `secrets.merge({"DATABASE_URL": url})`.
  - It prints only `✓ dealfinder_svc ready, DATABASE_URL stored in dealfinder-env v<N>`.

- [ ] **Step 1: Write the failing tests** with a fake `run` that records argv and stdin.

```python
def test_payload_keeps_only_contract_keys():
    p = json.loads(secrets_mod.build_payload({"BESTBUY_API_KEY": "k", "OPENROUTER_API_KEY": "nope"}))
    assert p == {"BESTBUY_API_KEY": "k"}

def test_push_sends_value_on_stdin_and_destroys_old_versions():
    fake = FakeRun(versions=["3", "2", "1"])
    assert secrets_mod.push('{"A":"v"}', project="p", run=fake) == 4
    add = fake.calls[0]
    assert "--data-file=-" in add.argv and add.stdin == '{"A":"v"}' and '{"A":"v"}' not in " ".join(add.argv)
    assert {c.argv[4] for c in fake.calls if c.argv[:4] == ["gcloud", "secrets", "versions", "destroy"]} == {"1", "2", "3"}

def test_push_cli_prints_no_values(capsys, monkeypatch, tmp_path):
    (tmp_path / ".env").write_text("BESTBUY_API_KEY=supersecretvalue\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(secrets_mod, "push", lambda payload, **k: 7)
    secrets_mod.main(["push", "--project", "p"])
    out = capsys.readouterr().out
    assert "supersecretvalue" not in out and "BESTBUY_API_KEY" in out and "v7" in out

def test_login_role_sql_never_uses_session_scope():
    sql = login_mod.role_statements("pw-literal")
    text = " ".join(s.as_string(None) if hasattr(s, "as_string") else str(s) for s in sql)
    assert "NOBYPASSRLS" in text and "NOINHERIT" in text and "SUPERUSER" not in text.replace("NOSUPERUSER", "")
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_deploy_scripts.py -v`. Expected: FAIL. The modules are missing. The test imports them with `importlib.util.spec_from_file_location`, because `deploy/` is not a package.

- [ ] **Step 3: Implement** both scripts. `login_mod.role_statements(password) -> list[psycopg.sql.Composed]` is the testable seam.

- [ ] **Step 4: Run and see them pass.** Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add deploy/secrets.py deploy/create_login_role.py tests/test_deploy_scripts.py
git commit -m "feat(deploy): one-version secret push and the dealfinder_svc login role; nothing printed"
```

---

### Task 10: CI deploy with Workload Identity Federation

**Files:**
- Modify: `.github/workflows/ci.yml:20-26` (replace the placeholder `deploy` job)
- Modify: `pyproject.toml` (`dev` extra gains `pyyaml>=6`)
- Test: `tests/test_workflows.py`

**Interfaces:**
- The job `deploy` has `needs: [test, edge]` and `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`, with `permissions: { contents: read, id-token: write }`.
- Job `env:`
  - `IMAGE: us-central1-docker.pkg.dev/${{ vars.GCP_PROJECT }}/dealfinder/api:${{ github.sha }}`
  - `GCP_PROJECT: ${{ vars.GCP_PROJECT }}`
  - `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_EDGE_TOKEN }}`
- Steps:
  1. checkout
  2. `google-github-actions/auth@v2` with `workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}` and `service_account: ${{ vars.GCP_DEPLOY_SA }}`. These are `with:` inputs, not `run:`.
  3. `google-github-actions/setup-gcloud@v2`
  4. `gcloud auth configure-docker us-central1-docker.pkg.dev`
  5. `docker build -t "$IMAGE" . && docker push "$IMAGE"`
  6. `gcloud run deploy dealfinder-api --image "$IMAGE" --region us-central1`
  7. `gcloud run jobs update dealfinder-pages --image "$IMAGE" --region us-central1`, and the same for `dealfinder-alerts`
  8. `npm ci && npm run build` in `frontend/`
  9. `npx wrangler deploy` in `edge/`
  10. smoke check: `curl -fsS https://deals.cloudcodetree.com/api/healthz` and `curl -fsS https://deals.cloudcodetree.com/api/readyz`
- `vars.*` are repo variables, not secrets: none is sensitive. The only secret is the Cloudflare token, which needs Workers Scripts Edit and Workers Routes Edit on the zone.

- [ ] **Step 1: Write the failing test**

```python
def _runs(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "run": yield v
            else: yield from _runs(v)
    elif isinstance(node, list):
        for v in node: yield from _runs(v)

def test_no_expressions_inside_run_blocks():
    for wf in Path(".github/workflows").glob("*.yml"):
        for script in _runs(yaml.safe_load(wf.read_text())):
            assert "${{" not in script, f"{wf.name}: move the expression into env:"

def test_deploy_uses_wif_not_a_json_key():
    text = Path(".github/workflows/ci.yml").read_text()
    assert "workload_identity_provider" in text and "credentials_json" not in text
    assert "id-token: write" in text

def test_no_schedule_trigger_anywhere():
    for wf in Path(".github/workflows").glob("*.yml"):
        assert "schedule" not in (yaml.safe_load(wf.read_text()).get(True) or {})   # PyYAML reads `on:` as True
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/pip install -e ".[dev]" && ./.venv/bin/python -m pytest tests/test_workflows.py -v`. Expected: FAIL, because `workload_identity_provider` is missing.

- [ ] **Step 3: Implement** the job.

- [ ] **Step 4: Run and see them pass.** Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml pyproject.toml tests/test_workflows.py
git commit -m "ci: deploy image, jobs and edge Worker from main via Workload Identity Federation"
```

---

### Task 11: Cost docs and the live cost check

**Files:**
- Modify: `COST.md` (new section "Tier 3: the live product at deals.cloudcodetree.com", plus Teardown lines)
- Modify: `scripts/cost_check.py` (add `--live`)
- Test: `tests/test_cost_check.py`

**Interfaces:**
- `COST.md` Tier 3 has one row per component: Cloud Run service, Cloud Run jobs, Cloud Scheduler, Secret Manager, Artifact Registry, Cloud Logging, the Worker, R2, Supabase (shared), Best Buy API, Healthchecks.io. Columns: free allowance with its source URL from this plan's facts table, expected use, how we stay under, and teardown command. Teardown:
  - `tofu -chdir=deploy/gcp destroy`
  - `npx wrangler delete dealfinder-edge` (in `edge/`)
  - remove `cloudflare_r2_bucket.dealfinder_pages` in the site's `infra/` and apply
  - `DROP ROLE dealfinder_svc`
- `cost_check.live_report(*, project: str, run=subprocess.run, http=urllib.request.urlopen) -> list[Check]` stays stdlib-only. `Check = (name, value, limit, ok)`. It runs read-only gcloud calls for:
  - the service's `minScale` (must be 0) and `maxScale` (≤ 2)
  - the scheduler job count across the billing account's projects (≤ 3)
  - `dealfinder-env` active versions (≤ 6)
  - the `dealfinder` repo `sizeBytes` (≤ 450,000,000)
  - whether a budget exists for the project
  - It also checks whether `dealfinder-pages` exists, through the Cloudflare API with the token read from env.
- `main(["--live", "--project", P])` prints one line per check and exits 1 if any check fails. The default mode without `--live` is unchanged.

- [ ] **Step 1: Write the failing tests** with a fake `run` returning canned gcloud JSON.

| Test | Setup | Assertion |
|---|---|---|
| `test_live_report_flags_min_instances` | fake service annotation `autoscaling.knative.dev/minScale: "1"` | check `cloud run min instances` has `ok is False` |
| `test_live_report_flags_a_fourth_scheduler_job` | 4 scheduler jobs on the billing account | check `scheduler jobs on the billing account` has `ok is False` |
| `test_live_main_exit_code` | `live_report` returns one passing `Check` | `main(["--live", "--project", "p"]) == 0` |
| `test_default_mode_unchanged` | paid flags unset | `main([]) == 0` |

`fake_gcloud` and `fake_cf` are fixtures in `tests/test_cost_check.py`. `main` gains an `argv` parameter. `scripts/` is imported with `spec_from_file_location`.

- [ ] **Step 2: Run and see them fail.** Expected: `AttributeError: live_report`.

- [ ] **Step 3: Implement** `live_report`, the `--live` flag and the `COST.md` section.

- [ ] **Step 4: Run and see them pass.** Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add COST.md scripts/cost_check.py tests/test_cost_check.py
git commit -m "docs(cost): Tier 3 live-product costs with sources; cost_check --live audits GCP + Cloudflare"
```

---

### Task 12: First deploy, live checks and cold-start measurement

**Files:**
- Create: `scripts/coldstart.py`
- Modify: `edge/wrangler.jsonc` (`BACKEND_ORIGIN` from `tofu output -raw api_url`)
- Modify: `COST.md` and `RUNBOOK.md` (measured cold start, deploy and rollback steps)

**Interfaces:**
- `scripts/coldstart.py --base https://deals.cloudcodetree.com/api --project P --runs 3`:
  - For each run, it forces a fresh revision with `gcloud run services update dealfinder-api --region us-central1 --update-env-vars COLDSTART_NONCE=<unix ts>`, which leaves the new revision with no warm instance.
  - It then times the first `GET /healthz` and the first `GET /readyz`, from request to the last byte.
  - It prints `run N: healthz X.Xs readyz Y.Ys` and the median, and exits 1 if any cold `healthz` is over **10 s**.

Every step marked **(owner go)** waits for "reply 'you do it'". Steps that need nothing from the owner run first.

- [ ] **Step 1: Preflight, read-only.** Run:
  - `gcloud auth list`
  - `gcloud billing accounts list`
  - `gcloud scheduler jobs list` across every project on that billing account
  - `python deploy/secrets.py check`, which prints which `KEYS` the env file has, names only

  Expected: an authenticated account, one open billing account, at most 1 other scheduler job, and `BESTBUY_API_KEY` present. Quote any failure into the Owner setup ask.
- [ ] **Step 2 (owner go): site R2 bucket.** Merge `feat/deals-infra`, run `node scripts/tofu.mjs apply`, then `npx wrangler r2 bucket lifecycle add dealfinder-pages expire-2d --expire-days 2`. Verify with `npx wrangler r2 bucket lifecycle list dealfinder-pages`.
- [ ] **Step 3 (owner go): GCP project and stack.** Run `gcloud projects create` if needed, link billing, then `tofu -chdir=deploy/gcp apply`. Expected: the outputs print. Check: `gcloud run services describe dealfinder-api --region us-central1 --format='value(status.url)'` prints the `run.app` URL.
- [ ] **Step 4 (owner go): production database.**
  1. `MIGRATION_DATABASE_URL=<read by the script> python -m dealfinder.migrate`. Expected: `0001` through `0004` applied, and only the `dealfinder` schema touched.
  2. `python deploy/create_login_role.py --project P`
  3. `python deploy/secrets.py push --project P`
  4. `python deploy/secrets.py edge --project P`
- [ ] **Step 5: R2 key probe.** Run a script that reads its token from env: `R2PageStore.from_env().put("deal/_probe.html", b"ok", "text/html")`. Then run `npx wrangler r2 object get dealfinder-pages/deal/_probe.html --remote --pipe` and expect `ok`. Delete the probe. This proves the Python store and the Worker agree on keys.
- [ ] **Step 6 (owner go): first deploy.** Set the GitHub repo variables with `gh variable set GCP_PROJECT`, `GCP_WIF_PROVIDER` and `GCP_DEPLOY_SA`, and the secret with `gh secret set CLOUDFLARE_EDGE_TOKEN` from stdin. Then merge `feat/launch-p3-hosting` to `main` and watch the deploy job with `gh run watch`.
- [ ] **Step 7 (owner go): first pages run.** `gcloud run jobs execute dealfinder-pages --region us-central1 --wait`. Expected: the JSON summary line in the logs shows `queries_ok` ≥ 30, and `curl -sI https://deals.cloudcodetree.com/sitemap.xml` is 200.
- [ ] **Step 8: Live checks.** Expected results:

| Check | Expected |
|---|---|
| `curl -s https://deals.cloudcodetree.com/api/readyz` | `{"db":"ok","schema":"current"}` |
| `curl -s -o /dev/null -w '%{http_code}' <run.app url>/config.json` | `403` |
| two identical anonymous `/api/search?q=tv` | second has `X-DealFinder-Cache: HIT` |
| six quick `/api/ask?q=x` | a 429 by the sixth |
| one deal page in Chrome DevTools | renders with the Best Buy logo, `X-Robots-Tag: noindex`, valid JSON-LD (screenshot saved) |
| `python scripts/cost_check.py --live --project P` | every check ok, exit 0 |

- [ ] **Step 9: Cold start.** Run `python scripts/coldstart.py --base https://deals.cloudcodetree.com/api --project P --runs 3`. Expected: every cold `healthz` ≤ 10 s.

  If it fails, try these in order and re-measure each time:
  1. move `_category_models(_catalog)` and `_fair` (`serve.py:47-57`) behind `functools.cache` accessors, so import does not fit models
  2. drop the startup warm thread for jobs
  3. raise CPU to 2 only during startup (`startup_cpu_boost` is already on)

  Record the median numbers in `COST.md` and `RUNBOOK.md`. The "Ship it for $0" lesson quotes them.
- [ ] **Step 10: Logo switch.** Only when Plan 4 has deployed `frontend/public/brand/bestbuy-logo.svg` holding the owner-supplied official file: check that `curl -sI https://deals.cloudcodetree.com/brand/bestbuy-logo.svg` returns `200` and `image/svg+xml`, then set `bestbuy_logo = true` and apply **(owner go)**. Until then, pages stay text-only.
- [ ] **Step 11 (owner go): auth allowlist.** In the site repo: `node scripts/supabase-allowlist.mjs --add 'https://deals.cloudcodetree.com/**' --dry-run`, then the real run.
- [ ] **Step 12: Commit and PR** the measurements and `BACKEND_ORIGIN`.

```bash
git add scripts/coldstart.py edge/wrangler.jsonc COST.md RUNBOOK.md
git commit -m "ops: first deploy of deals.cloudcodetree.com; measured cold start <X>s"
git push && gh pr create --fill
```

---

## Owner setup

Each item lists the attempt that needs nothing from the owner. Ask only after quoting that attempt's failure.

| Need | Try first | Ask the owner only if |
|---|---|---|
| GCP account with billing (a card is required) | `gcloud auth list`, `gcloud billing accounts list` | no credentials, or no open billing account |
| GCP project linked to billing | `gcloud projects create dealfinder-prod-<suffix>`, `gcloud billing projects link` | permission denied |
| $1 budget | `tofu apply` of `budget.tf` | `billing.budgets.create` denied |
| Best Buy API key | `python deploy/secrets.py check` reports `BESTBUY_API_KEY` present | absent. It needs a developer.bestbuy.com account in the owner's name. |
| Best Buy logo asset (terms: logo on every page). The file goes to Plan 4's `frontend/public/brand/bestbuy-logo.svg`. | fetch the official asset from developer.bestbuy.com's branding guidelines without signing in | the asset sits behind sign-in. Pages stay text-only until then. |
| Cloudflare R2 token scoped to `dealfinder-pages` (Bucket Item Write) | `POST /user/tokens` with the site's token | 403, meaning the site token lacks API Tokens Edit |
| Cloudflare deploy token for the companion CI | the same API call | the same |
| GitHub repo variables and secret | `gh variable set` and `gh secret set` (stdin) | `gh` not authenticated |

Every production action needs "you do it": Task 7 apply, Task 12 Steps 2, 3, 4, 6, 7, 10 and 11, and each merge.
