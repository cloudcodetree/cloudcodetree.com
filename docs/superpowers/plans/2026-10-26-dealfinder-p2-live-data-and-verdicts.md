# DealFinder Plan 2 — Live Data and Verdict Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every live result obey its store's license. Best Buy rows carry the fair-price verdict and are deleted before 72 hours. eBay listings show in their own unrated box and never touch a model, the median or the database. One env var moves verdicts to a "check a deal" mode.

**Architecture:** One policy table (`licensing.py`) decides, per source, whether a row may be rated, stored, embedded or mixed with other stores' rows. The shopper `/search` and the lab's `/ranked` share one scorer (`shop.score_offers`) that asks the policy before every signal. Sources in a tier run concurrently with a timeout. A job-role transaction (`db.job_scope`) lets `retention.purge_expired` delete expired rows across all users.

**Tech Stack:** Python 3.11, FastAPI, httpx + respx, `concurrent.futures`, psycopg 3, Postgres 16 + pgvector, pytest.

**Spec:** `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md` §6.2, §6.6. Terms evidence: `docs/superpowers/plans/2026-10-25-dealfinder-launch-research.md` §3.
**Contracts:** `docs/superpowers/plans/2026-10-26-dealfinder-launch-contracts.md`. Every name it lists is used exactly as written there.
**Plan 1:** `docs/superpowers/plans/2026-10-25-dealfinder-p1-identity-and-data.md`. This plan assumes Plan 1 is done.

**Repo and branch:** `~/Development/tutorial-dealfinder`, branch `feat/launch-p2-data`, cut from `origin/main` after Plan 1 merges. If Plan 1 is not merged yet, stack it on `feat/launch-p1-identity`. Line numbers are from `20b3fd5` and move after Plan 1, so find code by the name given.

## Plan sequence (this is Plan 2)

The full list is in Plan 1. Later plans consume these names:
- Plan 3: `shop.shop_search`, `shop.offer_slug`, `retention.purge_expired`, `BestBuySource.lookup_skus`, `db.job_scope`.
- Plan 4: the `/search` and `/check` response shapes.
- Plan 5: `BestBuySource.lookup_skus`, `db.job_scope`, the retention cut-off in Task 8.

## Global Constraints

- Plan 1's Global Constraints still hold: identity only from a verified JWT, `SET LOCAL` scope only, migrations only via `python -m dealfinder.migrate`, offline suite green with no `DATABASE_URL`, no stored query text.
- A row gets a verdict only when `licensing.may_verdict(row["source"])` is true. At launch that is Best Buy only (spec §2).
- eBay rows get no verdict, no score, no rank against other stores and no embedding. They are never written to Postgres and never counted in a median or a peer estimate. They live only in `ebay_box`'s in-process cache, for at most 900 s.
- eBay content never trains, tunes or evaluates any model. It is never stored, so no training or eval path can read it.
- No affiliate code path (spec §2, revenue skipped). eBay URLs are `itemWebUrl`, never `itemAffiliateWebUrl`.
- Every Best Buy row in Postgres is deleted before it is 72 hours old.
- Every `/search` response that contains a Best Buy row carries the Best Buy attribution object.
- `regular_price` (the store's "was" price) is display-only. It never feeds the median, the fair price, the residual or the reason.
- No "lowest in 30/90 days" claim and no stored price history for Best Buy items.
- An unknown source is denied everything. An unknown `DEALFINDER_VERDICT_MODE` fails toward `check`, which shows no verdicts.
- The offline suite never touches the network. Sources are stubbed or mocked with respx.
- Lesson MDX and step tags are untouched. Tests that pin lesson numbers stay green unchanged.
- Ruff rules stay `E4, E7, E9, F`.
- The prod migration of `0003`/`0004` and the merge to `main` each need an explicit owner go: "reply 'you do it'".

## Review Focus

1. **An eBay row reaching a verdict, the median, the peer estimate or the database.** Expected: a stray eBay row is dropped from `results`, left out of the median and the embedder input, and never upserted. Pinned in Task 6, `test_ebay_never_reaches_results_median_peers_or_db`, and Task 4, `test_upsert_never_stores_ebay_rows`.
2. **A Best Buy row outliving 72 hours through the 12-hour job gap.** Expected: a row fetched 60 hours ago goes on the next purge, one fetched 58 hours ago stays, and a stale watchlist row goes too. Pinned in Task 8, `test_purge_removes_rows_past_policy_age`.
3. **A slow source holding the whole search.** Expected: a source sleeping 2 s with a 0.2 s timeout returns in under 1 s, the fast source's rows are served, and the slow one is benched. Pinned in Task 3, `test_slow_source_times_out_without_blocking`.
4. **Check mode leaking a verdict through `/search`, `/ranked` or a typo in the env var.** Expected: every `verdict`, `fair`, `residual_frac`, `basis` and `pct_under_median` is null, nothing is embedded, and an unknown mode acts as `check`. Pinned in Task 7, `test_check_mode_nulls_every_signal` and `test_unknown_mode_fails_closed`.
5. **The seller's "was" price moving a signal.** Expected: rows with `regular_price` `None` and `500.0` score identically, and no reason mentions it. Pinned in Task 5, `test_regular_price_never_moves_a_signal`.

---

### Task 1: The source policy table

**Files:**
- Create: `dealfinder/licensing.py`
- Test: `tests/test_licensing.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class SourcePolicy`: `key: str`, `verdicts: bool`, `store: bool`, `embed: bool`, `comingle: bool`, `max_age_s: int`, `launch: bool`, `attribution: dict | None`.
  - `POLICIES: dict[str, SourcePolicy]`, keyed by source key:
    - `"BestBuy"`: verdicts, store, embed, comingle `True`. `max_age_s=72 * 3600`, `launch=True`, `attribution={"source": "BestBuy", "text": "Prices and product data from Best Buy", "url": "https://www.bestbuy.com", "logo": "bestbuy"}`.
    - `"eBay"`: verdicts, store, embed, comingle `False`. `max_age_s=6 * 3600`, `launch=True`, `attribution=None`.
    - `"RapidAPI"`, `"Apify"`, `"Amazon"`, `"Shopify"`, `"Firecrawl"`, `"iTunes"` (course-only): verdicts, store, embed, comingle `True`. `max_age_s=72 * 3600`, `launch=False`, `attribution=None`.
  - `source_key(source: str) -> str`: the text before the first `:`.
  - `policy_for(source: str) -> SourcePolicy | None`, `None` for an unknown key.
  - `may_verdict`, `may_store`, `may_embed`, `may_comingle`: each `(source: str) -> bool`, `False` for an unknown key.
  - `LAUNCH_SOURCES: frozenset[str]`, the keys with `launch=True`.
- No imports from other `dealfinder` modules. The docstring cites research §3 for each rule: eBay §9.5, §9.10, §8.1(b) and §8.1(c), and Best Buy's 72-hour cache, logo rule and third-party clause.

- [ ] **Step 1: Write the failing tests**

```python
def test_best_buy_carries_verdicts_and_expires_in_72h():
    p = licensing.policy_for("BestBuy:sale")
    assert (p.key, p.verdicts, p.store, p.max_age_s) == ("BestBuy", True, True, 72 * 3600)
    assert p.attribution["logo"] == "bestbuy"

def test_ebay_is_unrated_unstored_unembedded_and_separate():
    p = licensing.policy_for("eBay:Used")
    assert (p.verdicts, p.store, p.embed, p.comingle) == (False, False, False, False)
    assert p.max_age_s <= 6 * 3600

def test_unknown_source_is_denied_everything():
    assert licensing.policy_for("Walmart") is None
    checks = (licensing.may_verdict, licensing.may_store, licensing.may_embed, licensing.may_comingle)
    assert not any(f("Walmart:x") for f in checks)

def test_launch_sources_are_best_buy_and_ebay_only():
    assert licensing.LAUNCH_SOURCES == {"BestBuy", "eBay"}
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_licensing.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'dealfinder.licensing'`.

- [ ] **Step 3: Implement `dealfinder/licensing.py`** with the names above.

- [ ] **Step 4: Run the tests and see them pass**

Run: same as Step 2. Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/licensing.py tests/test_licensing.py
git commit -m "feat(licensing): one per-source policy table for verdicts, storage, embedding and mixing"
```

---

### Task 2: Source selection, eBay out of the live set, Best Buy provenance

**Files:**
- Modify: `dealfinder/schema.py:15-30`, `dealfinder/live_sources.py:202-267` (`EbaySource`), `:270-308` (`BestBuySource`), `:413-414` (`LIVE_SOURCES`)
- Modify: `dealfinder/serve.py` (`/sources` at `:1164`, `/search/stream` at `:326`)
- Test: `tests/test_live_sources.py`, `tests/test_licensing.py`, `tests/test_sse.py:32,49`

**Interfaces:**
- Consumes: `licensing.policy_for` (Task 1).
- Produces:
  - `Product.sku: str | None = None`, `Product.regular_price: float | None = None`.
  - `LIVE_SOURCES` loses `EbaySource()` and keeps its order. `EBAY: EbaySource` is the one shared instance, so its token cache persists.
  - `EbaySource.is_sandbox() -> bool` (an `SBX` app id or `EBAY_ENV=sandbox`), used by `_base()`. `search` never sends `X-EBAY-C-ENDUSERCTX` and sets `url` from `itemWebUrl` only. Delete the `EBAY_CAMPAIGN_ID` lines and the docstring's affiliate sentence.
  - `enabled_sources(names: str | None = None) -> list`. `names` defaults to env `DEALFINDER_SOURCES`. Unset or empty gives `list(LIVE_SOURCES)`. Otherwise a comma list, matched case-insensitively, returned in `LIVE_SOURCES` order. `eBay` raises `ValueError("eBay is served only by shop.ebay_box")`. Other unmatched names raise `ValueError(f"unknown source: {name}")`.
  - `BestBuySource.search` sets `sku=str(p["sku"])` and `regular_price=_f(p.get("regularPrice"))`.
  - `BestBuySource.lookup_skus(skus: list[str]) -> dict[str, Product]`. It dedupes, then queries `products(sku in(<≤100>))` with `pageSize=100` and the same `show` fields. It waits ≥ 0.2 s between batches (Best Buy allows 5 requests per second). A SKU not matching `^\d{1,12}$` raises `ValueError` before any request. No key returns `{}`. A non-200 batch raises `RuntimeError(f"bestbuy lookup failed: {status}")`, so callers can tell "gone" from "failed".
  - `GET /sources` returns `{s.name: s.available() for s in enabled_sources()}` plus `"eBay": EBAY.available()`. `/search/stream` streams `enabled_sources()`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_live_sources.py
def test_ebay_is_not_a_live_source():
    assert all(s.name != "eBay" for s in live_sources.LIVE_SOURCES)

def test_enabled_sources_from_env(monkeypatch):
    monkeypatch.setenv("DEALFINDER_SOURCES", "bestbuy")
    assert [s.name for s in live_sources.enabled_sources()] == ["BestBuy"]

def test_enabled_sources_default_is_every_course_source(monkeypatch):
    monkeypatch.delenv("DEALFINDER_SOURCES", raising=False)
    assert live_sources.enabled_sources() == live_sources.LIVE_SOURCES

@pytest.mark.parametrize("names, msg", [("BestBuy,eBay", "ebay_box"), ("Walmart", "unknown source")])
def test_enabled_sources_rejects_bad_names(names, msg):
    with pytest.raises(ValueError, match=msg):
        live_sources.enabled_sources(names)

@respx.mock
def test_ebay_sends_no_affiliate_context(monkeypatch):
    # mocks as in test_ebay_oauth_then_browse_search, plus EBAY_CAMPAIGN_ID=123 and an item
    # carrying itemAffiliateWebUrl "https://aff/x" and itemWebUrl "https://ebay/x"
    out = EbaySource().search("laptop")
    assert "X-EBAY-C-ENDUSERCTX" not in search_route.calls.last.request.headers
    assert out[0].url == "https://ebay/x"

@respx.mock
def test_lookup_skus_batches_and_maps(monkeypatch):
    # BESTBUY_API_KEY=k; the products route answers skus 1 and 2 only
    found = BestBuySource().lookup_skus(["1", "2", "3", "2"])
    assert set(found) == {"1", "2"} and route.call_count == 1 and found["1"].sku == "1"

def test_lookup_skus_rejects_non_digit_skus(monkeypatch):
    monkeypatch.setenv("BESTBUY_API_KEY", "k")
    with pytest.raises(ValueError):
        BestBuySource().lookup_skus(["123)&apiKey=x"])

@respx.mock
def test_lookup_skus_failure_is_not_gone(monkeypatch):
    # the products route answers 500
    with pytest.raises(RuntimeError, match="bestbuy lookup failed: 500"):
        BestBuySource().lookup_skus(["1"])

# tests/test_licensing.py
def test_every_source_class_has_a_policy():
    from dealfinder.live_sources import EBAY, LIVE_SOURCES
    assert all(licensing.policy_for(s.name) for s in [*LIVE_SOURCES, EBAY])
```

Extend `test_bestbuy_search_maps_saleprice` with `assert out[0].sku == "123" and out[0].regular_price == 499.99`. In `tests/test_sse.py`, patch `serve.enabled_sources` (`lambda: [_StubSource()]`, `lambda: []`) instead of `serve.LIVE_SOURCES`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_live_sources.py tests/test_licensing.py tests/test_sse.py -v`
Expected: FAIL. `enabled_sources` and `EBAY` are not defined.

- [ ] **Step 3: Implement** the schema fields, the eBay and Best Buy changes, `enabled_sources` and the two routes.

- [ ] **Step 4: Run the tests and the full offline suite**

Run: the command from Step 2, then `./.venv/bin/python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/schema.py dealfinder/live_sources.py dealfinder/serve.py tests/test_live_sources.py tests/test_licensing.py tests/test_sse.py
git commit -m "feat(sources): DEALFINDER_SOURCES, eBay out of the live set, Best Buy sku/regular_price/lookup_skus, no affiliate context"
```

---

### Task 3: Concurrent sources with per-source timeouts

**Files:**
- Modify: `dealfinder/aggregate.py:1-98`
- Test: `tests/test_aggregate.py`

**Interfaces:**
- Consumes: `enabled_sources` (Task 2).
- Produces:
  - `SOURCE_TIMEOUT_S = float(os.getenv("DEALFINDER_SOURCE_TIMEOUT_S", "8"))`.
  - `aggregate(query: str, sources=None, limit: int = 24, target: int = TARGET_RESULTS, timeout_s: float = SOURCE_TIMEOUT_S) -> dict`. `sources=None` means `enabled_sources()` at call time.
  - A tier's sources run concurrently in a `ThreadPoolExecutor` sized to the tier, bounded by `concurrent.futures.wait(timeout=timeout_s)`. Unfinished sources are benched and listed in `throttled` and in a new key `timed_out`. The executor shuts down with `wait=False, cancel_futures=True`. Tier escalation, the fallback pass and both dedup passes keep today's behavior.
  - Each result dict gains `sku`, `regular_price` and `fetched_at`, the UTC time its source returned, formatted by `_utc_iso(dt) -> str` as `YYYY-MM-DDTHH:MM:SSZ`.
  - `_cooldown` access goes through one `threading.Lock`.
  - The docstring says breaker state is per instance by design (spec §6.6). Each Cloud Run instance learns a bad source on its own, so the worst case is one wasted call per instance per cooldown.

- [ ] **Step 1: Write the failing tests.** Add a `_Sleeper(name, seconds, tier, products=())` stub next to `_Stub`.

```python
def test_slow_source_times_out_without_blocking():
    slow, fast = _Sleeper("SLOW", 2.0, tier=1), _Stub("FAST", [_p("f1", "Widget", 10, "FAST")], tier=1)
    t0 = time.monotonic()
    out = aggregate("w", sources=[slow, fast], timeout_s=0.2)
    assert time.monotonic() - t0 < 1.0
    assert out["count"] == 1 and "SLOW" in out["timed_out"] and "SLOW" in out["throttled"]
    assert agg._benched("SLOW")

def test_same_tier_sources_run_concurrently():
    a = _Sleeper("A", 0.3, tier=1, products=[_p("a1", "Alpha", 10, "A")])
    b = _Sleeper("B", 0.3, tier=1, products=[_p("b1", "Beta", 20, "B")])
    t0 = time.monotonic()
    assert aggregate("w", sources=[a, b], timeout_s=2.0)["count"] == 2
    assert time.monotonic() - t0 < 0.55

def test_results_carry_provenance_fields():
    p = Product(id="bestbuy-1", sku="1", regular_price=20.0, title="Thing", brand="B",
                category="c", price=15.0, url="", source="BestBuy:sale")
    r = aggregate("w", sources=[_Stub("BestBuy", [p], tier=1)])["results"][0]
    assert (r["sku"], r["regular_price"]) == ("1", 20.0) and r["fetched_at"].endswith("Z")
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_aggregate.py -v`
Expected: FAIL. `aggregate` has no `timeout_s`.

- [ ] **Step 3: Implement** the concurrent tier loop, the lock, the provenance fields and the docstring.

- [ ] **Step 4: Run the tests and the full offline suite**

Run: `./.venv/bin/python -m pytest tests/test_aggregate.py tests/test_chaos.py -v && ./.venv/bin/python -m pytest -q`
Expected: all pass. `test_chaos.py` passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/aggregate.py tests/test_aggregate.py
git commit -m "feat(aggregate): concurrent sources per tier with a per-source timeout; per-instance breaker documented"
```

---

### Task 4: Storage obeys the policy: job role, provenance columns, guards

**Files:**
- Create: `dealfinder/migrations/0003_job_role.sql`, `dealfinder/migrations/0004_offer_provenance.sql`
- Modify: `dealfinder/db.py`, `dealfinder/pgstore.py` (`upsert`), `dealfinder/userstore.py` (`add_watch`)
- Test: `tests/test_migrate.py`, `tests/test_db.py`, `tests/test_pgstore.py`, `tests/test_userstore.py`

**Interfaces:**
- Consumes: Plan 1's `db.scoped`, `db.get_pool`, `pgstore.upsert(products, embeddings | None, tenant, url)`, `userstore.add_watch`, the `db` and `offers` fixtures. `licensing.may_store`, `may_embed` (Task 1).
- Produces:
  - `0003_job_role.sql`: role `dealfinder_job` (`NOLOGIN NOSUPERUSER NOBYPASSRLS`, created only if missing), `GRANT dealfinder_job TO CURRENT_USER`, schema usage, DML on `offers`, `watchlist`, `saved_searches`, and on each of the three a policy `job_all FOR ALL TO dealfinder_job USING (true) WITH CHECK (true)`.
  - `0004_offer_provenance.sql`: `offers` gains `sku text` and `regular_price double precision`. Indexes `offers_source_fetched` on `offers (source, fetched_at)` and `watchlist_last_checked` on `watchlist (last_checked_at)`.
  - `db.job_scope(*, url: str | None = None) -> ContextManager[psycopg.Cursor]`, exactly as the contracts file defines it.
  - `pgstore.upsert` keeps Plan 1's signature. It skips rows failing `may_store` and returns the rows written. It stores `sku` and `regular_price`. `fetched_at` comes from the row's ISO value, else `now()`. On conflict it updates `title`, `price`, `regular_price`, `url`, `image_url`, `sku` and `fetched_at`, and keeps the stored embedding when the new one is `None`. It forces the embedding to `None` when `may_embed` fails.
  - `userstore.add_watch` raises `LookupError` when the stored offer's source fails `may_store`. Only a row from before this plan can hit that.

- [ ] **Step 1: Write the failing DB tests**

```python
# tests/test_migrate.py
def test_job_role_cannot_bypass_rls(db):
    with psycopg.connect(db) as c:
        assert c.execute("select rolsuper, rolbypassrls from pg_roles where rolname='dealfinder_job'").fetchone() == (False, False)

def test_every_rls_table_has_a_job_policy(db):
    with psycopg.connect(db) as c:
        missing = c.execute("""select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'dealfinder' and c.relrowsecurity and not exists (select 1 from pg_policy p
            where p.polrelid = c.oid and 'dealfinder_job'::regrole = any(p.polroles))""").fetchall()
    assert missing == []

# tests/test_db.py
def test_job_scope_sees_every_users_rows(db, offers):
    userstore.add_watch("user-alice", "public", "off-1", None, url=db)
    userstore.add_watch("user-bob", "public", "off-2", None, url=db)
    with db_mod.job_scope(url=db) as cur:
        users = {r["user_id"] for r in cur.execute(
            "select user_id from dealfinder.watchlist where user_id in ('user-alice','user-bob')")}
    assert users == {"user-alice", "user-bob"}

def test_job_scope_does_not_leak_role(db):
    with db_mod.job_scope(url=db) as cur:
        cur.execute("select 1")
    with db_mod.get_pool(db).connection() as c:
        assert c.execute("select current_user as u").fetchone()["u"] != "dealfinder_job"

# tests/test_pgstore.py
def test_upsert_never_stores_ebay_rows(db):
    n = pgstore.upsert([{"id": "ebay-1", "title": "x", "source": "eBay:Used", "price": 5.0}], None, url=db)
    with psycopg.connect(db) as c:
        assert (n, c.execute("select count(*) from dealfinder.offers where id='ebay-1'").fetchone()[0]) == (0, 0)

def test_upsert_refreshes_fetched_at_and_keeps_provenance(db):
    row = {"id": "bestbuy-77", "title": "TV", "source": "BestBuy", "price": 300.0, "sku": "77"}
    pgstore.upsert([{**row, "fetched_at": "2026-10-20T00:00:00Z"}], None, url=db)
    pgstore.upsert([{**row, "regular_price": 400.0, "fetched_at": "2026-10-21T00:00:00Z"}], None, url=db)
    with psycopg.connect(db) as c:
        got = c.execute("select sku, regular_price, fetched_at from dealfinder.offers where id='bestbuy-77'").fetchone()
    assert (got[0], got[1], got[2].isoformat()) == ("77", 400.0, "2026-10-21T00:00:00+00:00")

# tests/test_userstore.py
def test_watch_rejects_a_legacy_unstorablerow(db, offers):
    with psycopg.connect(db) as c:   # superuser insert, bypassing the upsert guard
        c.execute("""insert into dealfinder.offers (tenant_id, id, title, source, price)
                     values ('public', 'ebay-legacy', 'Old', 'eBay:Used', 9)""")
    with pytest.raises(LookupError):
        userstore.add_watch("user-alice", "public", "ebay-legacy", None, url=db)
```

Every test deletes its rows. Extend the `offers` fixture's teardown to cover `bestbuy-77` and `ebay-legacy`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `docker-compose up -d db && DATABASE_URL=postgresql://dealfinder:dealfinder@127.0.0.1:5434/dealfinder ./.venv/bin/python -m pytest tests/test_migrate.py tests/test_db.py tests/test_pgstore.py tests/test_userstore.py -k "job or ebay or provenance or legacy" -v`
Expected: FAIL. Role `dealfinder_job` does not exist.

- [ ] **Step 3: Implement** the migrations, `job_scope` and the two guards. Run `python -m dealfinder.migrate`.

- [ ] **Step 4: Run the tests and see them pass**

Run: the command from Step 2, then `./.venv/bin/python -m pytest -q` offline and with `DATABASE_URL`. Expected: all pass in both modes.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/migrations/0003_job_role.sql dealfinder/migrations/0004_offer_provenance.sql dealfinder/db.py dealfinder/pgstore.py dealfinder/userstore.py tests/test_migrate.py tests/test_db.py tests/test_pgstore.py tests/test_userstore.py
git commit -m "feat(db): dealfinder_job role and offer provenance; storage refuses rows the license forbids"
```

---

### Task 5: One scorer under the policy, `/ranked` on it, cached embeddings

**Files:**
- Create: `dealfinder/shop.py`
- Modify: `dealfinder/embed.py` (add `embed_texts_cached`)
- Modify: `dealfinder/serve.py`: move `_peer_fair_prices` (`:102-128`) and `_deal_reason` (`:131-146`) into `shop.py`, put `/ranked` (`:149-228`) on `shop.score_offers`, embed the `/semantic` query (`:341`) through the cache, and give `_remember_offers` cached embeddings
- Test: `tests/test_shop.py`, `tests/test_embed.py`, `tests/test_serve.py:54-104`

**Interfaces:**
- Consumes: `licensing.*` (Task 1), `aggregate` provenance fields (Task 3), the `upsert` guards (Task 4).
- Produces:
  - `embed.embed_texts_cached(texts: list[str]) -> np.ndarray`. Per-text cache keyed by SHA-256, at most 4,096 entries, each expiring after `EMBED_CACHE_TTL_S = 6 * 3600`. Misses embed in one batch. Thread-safe. The clock is `embed._now()`.
  - `shop._embed_texts(texts) -> list`, the test patch point, calling `embed_texts_cached`.
  - `shop.peer_fair_prices(offers) -> dict[int, float]` and `shop.deal_reason(verdict, m, rf, fair, basis) -> str` move unchanged, copy included, so quoted lesson strings stay true.
  - `shop.offer_slug(title: str, sku: str | None) -> str | None`. `None` without a SKU. Otherwise NFKD-fold to ASCII, lowercase, collapse each run of non-alphanumerics to one `-`, cut to at most 60 chars at a `-` boundary, and append `-bestbuy-<sku>`.
  - `shop.score_offers(offers: list[dict], median: float) -> list[dict]`. It drops rows failing `may_comingle`. A row failing `may_verdict` stays, with `verdict`, `fair`, `residual_frac`, `basis` and `pct_under_median` all `None` and the reason `"Not rated: this store's terms don't allow price ratings."` The peer estimate runs only over rows passing `may_verdict` and `may_embed`. Rows come back in the contract's `results[]` shape (with `sku`, `slug`, `regular_price`), sorted by today's `_value` rule, not truncated.
  - `GET /ranked` keeps today's keys (`query`, `count`, `median_price`, `sources_live`, `residual_threshold`, `modeled`, `estimated`, `results`). Its median is over rows passing `may_verdict`. It then calls `_remember_offers`.
  - `serve._remember_offers(results, tenant)` keeps Plan 1's signature. It now passes `shop._embed_texts(titles)` for rows passing `may_embed`. Those are cache hits after scoring.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_shop.py  (offline; `row(id, title, price, source, **kw)` is a plain helper in tests/conftest.py
# that builds an aggregate result dict, shared by test_shop.py and test_serve.py)
def test_peer_fair_prices_flags_the_within_cluster_outlier(monkeypatch):
    ...  # moved from test_serve.py, patching shop._embed_texts

def test_score_offers_drops_rows_that_may_not_be_mixed():
    rows = [row("bestbuy-1", "Sony WH-1000XM5", 50.0, "BestBuy"), row("ebay-1", "Sony WH-1000XM5", 40.0, "eBay:Used")]
    assert [r["id"] for r in shop.score_offers(rows, median=60.0)] == ["bestbuy-1"]

def test_regular_price_never_moves_a_signal(monkeypatch):
    monkeypatch.setattr(shop, "_embed_texts", lambda t: [[1.0, 0.0] for _ in t])
    base = [row(f"bestbuy-{i}", f"Guitar {i}", p, "BestBuy") for i, p in enumerate([60.0, 65.0, 70.0])]
    keys = ("verdict", "fair", "residual_frac", "pct_under_median", "reason")
    plain = shop.score_offers(base, median=65.0)
    inflated = shop.score_offers([{**r, "regular_price": 500.0} for r in base], median=65.0)
    assert [{k: r[k] for k in keys} for r in plain] == [{k: r[k] for k in keys} for r in inflated]
    assert not any(w in r["reason"].lower() for r in inflated for w in ("was", "regular"))

@pytest.mark.parametrize("title, sku, slug", [
    ("Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black", "6505727",
     "sony-wh-1000xm5-wireless-noise-canceling-headphones-black-bestbuy-6505727"),
    ('Ünïcode / TV 65"', "1", "unicode-tv-65-bestbuy-1"),
    ("x", None, None)])
def test_offer_slug(title, sku, slug):
    assert shop.offer_slug(title, sku) == slug

def test_offer_slug_caps_the_title_part():
    s = shop.offer_slug("word " * 40, "9")
    assert len(s.removesuffix("-bestbuy-9")) <= 60 and not s.startswith("-")

# tests/test_embed.py
def test_embed_texts_cached_embeds_each_text_once(monkeypatch):
    # a fake model appends each text it embeds to `seen`
    embed.embed_texts_cached(["a", "b"]); embed.embed_texts_cached(["b", "c"])
    assert seen == ["a", "b", "c"]
    monkeypatch.setattr(embed, "_now", lambda: start + embed.EMBED_CACHE_TTL_S + 1)
    embed.embed_texts_cached(["a"])
    assert seen[-1] == "a"
```

In `test_ranked_scores_any_search_via_the_layered_estimator`, set every fake row's `source` to `"BestBuy"`, patch `shop._embed_texts` instead of `serve._embed_texts`, and keep every assertion. Delete the moved peer test from `test_serve.py`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_shop.py tests/test_embed.py tests/test_serve.py -k "peer or score or regular or slug or cached or ranked" -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'dealfinder.shop'`.

- [ ] **Step 3: Implement** `shop.py`, `embed_texts_cached` and the `serve.py` moves.

- [ ] **Step 4: Run the tests and the full offline suite**

Run: the command from Step 2, then `./.venv/bin/python -m pytest -q`.
Expected: all pass. The lesson-pinned tests in `test_rag.py`, `test_search.py` and `test_part01.py` pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/shop.py dealfinder/embed.py dealfinder/serve.py tests/test_shop.py tests/test_embed.py tests/test_serve.py
git commit -m "feat(shop): one license-aware scorer behind /ranked; cached title and query embeddings"
```

---

### Task 6: The shopper `/search`, the eBay box and attribution

**Files:**
- Modify: `dealfinder/shop.py` (add `ebay_box`, `shop_search`), `dealfinder/serve.py:86-99` (`/search` is replaced)
- Test: `tests/test_shop.py`, `tests/test_serve.py`

**Interfaces:**
- Consumes: `score_offers`, `offer_slug` (Task 5), `EBAY` (Task 2), `aggregate` (Task 3), Plan 1's `current_principal` and `_remember_offers`.
- Produces:
  - `shop.ebay_box(q: str, limit: int = 6) -> dict`, the contract's `ebay` object:
    - `enabled` only when `EBAY.available()` and either `not EBAY.is_sandbox()` or env `DEALFINDER_EBAY_ALLOW_SANDBOX == "1"`. Sandbox data is fake, so it never shows by default.
    - `items`: at most `limit`, in eBay's own order, never re-sorted. Fields `id`, `title`, `price`, `currency`, `url`, `condition` (the text after `eBay:`), `image_url`.
    - `note` is exactly `"Listings from eBay. Not compared or rated."`
    - In-process cache keyed by `q.strip().lower()`, `EBAY_CACHE_TTL_S = 900`, at most 256 keys, clock `shop._now()`. Nothing else holds eBay rows. Any exception gives `items: []`.
  - `shop.shop_search(q: str, k: int = 12) -> dict`, the contract's `/search` shape. `aggregate(q)` and `ebay_box(q)` run concurrently in a two-thread executor. `median_price` is the median `price` over rows passing `may_verdict`, rounded to 2, or `0.0` with none. `results` is `score_offers(...)[:k]`. `attribution` lists the unique non-null `policy.attribution` of the sources in `results`, first-seen order. `fetched_at` is `_utc_iso(now)`. `mode` is `"live"` until Task 7.
  - `GET /search`: `q` stripped to 1-200 chars, `k` 1-24 (default 12), else 422. It returns `shop_search(q, k)` and then calls `_remember_offers(result["results"], who.tenant_id)`. `Cache-Control` is `public, max-age=300` with no `Authorization` header, else `private, no-store`. The old raw-aggregate body and its `persisted` and `tenant` keys are gone.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_serve.py  (offline)
def test_ebay_never_reaches_results_median_peers_or_db(monkeypatch):
    bb = [row(f"bestbuy-{i}", f"Headphones {i}", p, "BestBuy", sku=str(i)) for i, p in enumerate([100.0, 200.0, 300.0])]
    stray = row("ebay-7", "EBAY ONLY TITLE", 1.0, "eBay:Used")
    monkeypatch.setattr(shop, "aggregate", lambda q: {"results": bb + [stray], "sources_live": ["BestBuy"]})
    monkeypatch.setattr(shop, "ebay_box", lambda q, limit=6: {"enabled": True, "note": "n", "items": [
        {"id": "ebay-9", "title": "t", "price": 5.0, "currency": "USD", "url": "u", "condition": "Used", "image_url": None}]})
    embedded, stored = [], []
    monkeypatch.setattr(shop, "_embed_texts", lambda t: embedded.extend(t) or [[1.0, 0.0] for _ in t])
    monkeypatch.setattr(serve, "_DB", True)
    monkeypatch.setattr(pgstore, "upsert", lambda rows, emb, tenant="public", url=None: stored.append(rows) or 0)
    body = client.get("/search", params={"q": "headphones"}).json()
    assert {r["source"] for r in body["results"]} == {"BestBuy"} and body["median_price"] == 200.0
    assert "EBAY ONLY TITLE" not in embedded
    assert not any(r["id"].startswith("ebay") for rows in stored for r in rows)
    assert body["ebay"]["items"][0]["id"] == "ebay-9" and "verdict" not in body["ebay"]["items"][0]

def test_search_response_matches_the_contract(monkeypatch):
    # same stubs, Best Buy rows only; then the same call with aggregate returning []
    assert set(body) == {"query", "mode", "count", "median_price", "fetched_at", "results", "ebay", "attribution"}
    assert {"id", "sku", "slug", "title", "brand", "source", "price", "regular_price", "url", "image_url",
            "verdict", "pct_under_median", "fair", "residual_frac", "basis", "reason"} <= set(body["results"][0])
    assert body["attribution"] == [licensing.POLICIES["BestBuy"].attribution]
    assert empty_body["attribution"] == []

@pytest.mark.parametrize("params", [{"q": ""}, {"q": "x" * 201}, {"q": "ok", "k": 0}, {"q": "ok", "k": 25}])
def test_search_validates_input(params):
    assert client.get("/search", params=params).status_code == 422

def test_anonymous_search_is_edge_cacheable_and_signed_in_is_private(monkeypatch, mint):
    assert client.get("/search", params={"q": "tv"}).headers["cache-control"] == "public, max-age=300"
    signed = client.get("/search", params={"q": "tv"}, headers=bearer(mint("u-1")))
    assert signed.headers["cache-control"] == "private, no-store"

# tests/test_shop.py
def test_ebay_box_hidden_without_keys():
    assert shop.ebay_box("x") == {"enabled": False, "note": "Listings from eBay. Not compared or rated.", "items": []}

def test_ebay_box_hides_sandbox_data(monkeypatch):
    monkeypatch.setenv("EBAY_APP_ID", "x-SBX-y"); monkeypatch.setenv("EBAY_CERT_ID", "c")
    assert shop.ebay_box("x")["enabled"] is False

def test_ebay_box_caches_at_most_15_minutes(monkeypatch):
    # stub shop.EBAY: available() True, is_sandbox() False, search() appends to `calls`
    shop.ebay_box("TV"); shop.ebay_box(" tv ")
    assert len(calls) == 1
    monkeypatch.setattr(shop, "_now", lambda: start + 901)
    shop.ebay_box("tv")
    assert len(calls) == 2
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_serve.py tests/test_shop.py -k "ebay or contract or validates or cacheable" -v`
Expected: FAIL. `/search` still returns the raw aggregate.

- [ ] **Step 3: Implement** `ebay_box`, `shop_search` and the new `/search`.

- [ ] **Step 4: Run the tests and the full offline suite**

Run: the command from Step 2, then `./.venv/bin/python -m pytest -q`.
Expected: all pass. Move any older test that relied on the raw `/search` to `/ranked`, or delete it when `/ranked` already covers it. Record which.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/shop.py dealfinder/serve.py tests/test_shop.py tests/test_serve.py
git commit -m "feat(search): shopper /search with Best Buy verdicts, a separate unrated eBay box and attribution"
```

---

### Task 7: "Check a deal" mode

**Files:**
- Modify: `dealfinder/shop.py`, `dealfinder/serve.py` (new `GET /check`)
- Test: `tests/test_shop.py`, `tests/test_serve.py`

**Interfaces:**
- Consumes: `score_offers`, `shop_search` (Tasks 5-6). From `dealscore`: `residual_fraction`, `DEAL_MEDIAN_FRAC` (0.15), `SUSPICIOUS_RESIDUAL_FRAC` (0.70). `extract.guess_category`, `rag._category_models`, `tools.load_catalog`, `features.featurize`.
- Produces:
  - `shop.verdict_mode() -> str`. Env `DEALFINDER_VERDICT_MODE`, unset means `"live"`. `"live"` and `"check"` pass through. Any other value returns `"check"` and logs one warning on `logging.getLogger("dealfinder")`.
  - In `check` mode, `score_offers` sets `verdict`, `fair`, `residual_frac`, `basis` and `pct_under_median` to `None`, calls no embedder, and sets every reason to `"Ratings are off for store listings. Use Check a deal to rate a price you found."` `shop_search` returns `mode: "check"` and `median_price: None`. `/ranked` follows through `score_offers`.
  - `shop._fair_for(title: str) -> tuple[str | None, float | None]`, the patch point: the category and the per-category model's fair price. The models train on the snapshot only and are cached. No network call, no live row.
  - `shop.check_deal(title: str, price: float) -> dict` returns `{"title", "price", "category", "fair", "residual_frac", "verdict", "reason", "basis"}`, with `basis = "model"` when rated. The rule for one price with no market median uses `rf = residual_fraction(price, fair)` and the imported `dealscore` constants:

    | Condition | `verdict` | `reason` |
    |---|---|---|
    | `rf >= SUSPICIOUS_RESIDUAL_FRAC` | `suspicious` | `"{N}% below our fair price for this model (~${fair:.0f}). That is too far below to be real. It may be used, an accessory, or a mislisting."` |
    | `rf >= DEAL_MEDIAN_FRAC` | `deal` | `"{N}% below our fair price for this model (~${fair:.0f})."` |
    | `rf <= -DEAL_MEDIAN_FRAC` | `overpriced` | `"{N}% above our fair price for this model (~${fair:.0f})."` |
    | otherwise | `fair` | `"Within 15% of our fair price for this model (~${fair:.0f})."` |
    | no category model | `None` | `"We can't estimate a fair price for this kind of product yet."` |

    `N = round(abs(rf) * 100)`.
  - `GET /check?title=&price=`: `title` stripped to 3-200 chars, `0 < price <= 50000`, else 422. Works in both modes.

- [ ] **Step 1: Write the failing tests**

```python
def test_check_mode_nulls_every_signal(monkeypatch):
    monkeypatch.setenv("DEALFINDER_VERDICT_MODE", "check")
    embedded = []
    monkeypatch.setattr(shop, "_embed_texts", lambda t: embedded.extend(t) or [[1.0, 0.0] for _ in t])
    # stub both shop.aggregate (/search) and serve.aggregate (/ranked) with three Best Buy rows, as in Task 6
    body = client.get("/search", params={"q": "headphones"}).json()
    assert body["mode"] == "check" and body["median_price"] is None and embedded == []
    nulls = ("verdict", "fair", "residual_frac", "basis", "pct_under_median")
    assert all(r[k] is None for r in body["results"] for k in nulls)
    assert all(r["verdict"] is None for r in client.get("/ranked", params={"q": "headphones"}).json()["results"])

@pytest.mark.parametrize("value", ["Live ", "verdicts", "on"])
def test_unknown_mode_fails_closed(monkeypatch, value):
    monkeypatch.setenv("DEALFINDER_VERDICT_MODE", value)
    assert shop.verdict_mode() == "check"

@pytest.mark.parametrize("price, verdict", [(25.0, "suspicious"), (30.0, "suspicious"), (80.0, "deal"), (85.0, "deal"),
                                            (90.0, "fair"), (114.0, "fair"), (115.0, "overpriced"), (120.0, "overpriced")])
def test_check_rule(monkeypatch, price, verdict):
    monkeypatch.setattr(shop, "_fair_for", lambda t: ("audio", 100.0))
    assert shop.check_deal("Sony WH-1000XM5", price)["verdict"] == verdict

def test_check_reason_copy_and_unknown_category(monkeypatch):
    monkeypatch.setattr(shop, "_fair_for", lambda t: ("audio", 100.0))
    assert shop.check_deal("Sony WH-1000XM5", 80.0)["reason"] == "20% below our fair price for this model (~$100)."
    monkeypatch.setattr(shop, "_fair_for", lambda t: (None, None))
    r = shop.check_deal("Mystery widget", 10.0)
    assert (r["verdict"], r["basis"], r["reason"]) == (None, None, "We can't estimate a fair price for this kind of product yet.")

def test_check_uses_no_live_source(monkeypatch):
    monkeypatch.setattr(shop, "aggregate", lambda *a, **k: pytest.fail("no live search"))
    monkeypatch.setattr(shop.EBAY, "search", lambda *a, **k: pytest.fail("no eBay"))
    assert client.get("/check", params={"title": "Sony WH-1000XM5", "price": 199}).status_code == 200

@pytest.mark.parametrize("params", [{"title": "ab", "price": 10}, {"title": "TV set", "price": 0},
                                    {"title": "TV set", "price": -1}, {"title": "TV set", "price": 50001}])
def test_check_validation(params):
    assert client.get("/check", params=params).status_code == 422
```

Then pin one real result. With `DEALFINDER_VERDICT_MODE` unset, run `./.venv/bin/python -c "from dealfinder.shop import check_deal; print(check_deal('Sony WH-1000XM5 Wireless Noise Canceling Headphones', 199.0))"`. Paste the printed `category`, `fair` (to 2 places) and `verdict` into `test_check_on_a_real_title`. Never type those numbers by hand (standing real-output rule).

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_shop.py tests/test_serve.py -k "check or mode" -v`
Expected: FAIL. `verdict_mode` and `check_deal` are not defined.

- [ ] **Step 3: Implement** `verdict_mode`, the check-mode branches, `_fair_for`, `check_deal` and `/check`.

- [ ] **Step 4: Run the tests and the full offline suite**

Run: the command from Step 2, then `./.venv/bin/python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/shop.py dealfinder/serve.py tests/test_shop.py tests/test_serve.py
git commit -m "feat(check): one env var moves verdicts to a snapshot-model 'check a deal' mode; unknown modes fail closed"
```

---

### Task 8: Retention before 72 hours

**Files:**
- Create: `dealfinder/retention.py`
- Modify: `RUNBOOK.md` (a "Data retention" section)
- Test: `tests/test_retention.py`

**Interfaces:**
- Consumes: `db.job_scope` (Task 4), `licensing.POLICIES`.
- Produces:
  - `RETENTION_MARGIN_S = 13 * 3600`. Plan 3's `dealfinder-pages` job purges every 12 hours. A row is deleted once older than `max_age_s - RETENTION_MARGIN_S`, so a Best Buy row fetched just after a run is still gone before 72 hours. For Best Buy the cut-off is 59 hours.
  - `purge_expired(now: datetime | None = None, url: str | None = None, *, margin_s: int = RETENTION_MARGIN_S) -> dict[str, int]` returns `{"offers": n, "watchlist": n}`. In one `db.job_scope` transaction, for both `offers` (by `fetched_at`) and `watchlist` (by `last_checked_at`), it deletes:
    - every row whose source key has no policy or `store=False`, at any age
    - every row older than `max_age_s - margin_s` for its key

    The key in SQL is `split_part(source, ':', 1)`. `now` defaults to `datetime.now(timezone.utc)`.
  - **A watch whose item stopped refreshing is deleted**, because its title and price are Best Buy content. Plan 5's daily re-price job refreshes `last_checked_at` through `lookup_skus`. A watch passes the cut-off only if Best Buy dropped the SKU, or after more than two days of failed lookups. A failed lookup (`RuntimeError`) must never update `last_checked_at`. Warning the user before deletion is Plan 5's job.
  - `main(argv: list[str] | None = None) -> int` behind `python -m dealfinder.retention`. It prints the result as one JSON line and returns 0, or 1 on a database error, which Plan 3's job runner reports as `fail`.

- [ ] **Step 1: Write the failing DB tests**

```python
NOW = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)

def test_purge_removes_rows_past_policy_age(db):
    # job_scope inserts: offers bb-fresh (BestBuy, fetched NOW-58h) and bb-old (BestBuy, fetched NOW-60h);
    # watchlist: user-alice on bb-fresh (last_checked NOW-58h), user-bob on bb-old (last_checked NOW-60h)
    assert retention.purge_expired(now=NOW, url=db) == {"offers": 1, "watchlist": 1}
    assert offer_ids(db) & {"bb-fresh", "bb-old"} == {"bb-fresh"}
    assert watch_owners(db) & {"user-alice", "user-bob"} == {"user-alice"}
    assert retention.purge_expired(now=NOW, url=db) == {"offers": 0, "watchlist": 0}

def test_purge_deletes_unstorable_rows_of_any_age(db):
    # superuser inserts: an eBay row and a "Walmart" row, both fetched NOW-1min
    assert retention.purge_expired(now=NOW, url=db)["offers"] == 2

def test_purge_cli_prints_counts(db, capsys, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db)
    assert retention.main([]) == 0
    assert set(json.loads(capsys.readouterr().out)) == {"offers", "watchlist"}
```

`offer_ids` and `watch_owners` are test helpers that read through `db.job_scope`. Each test deletes its rows and uses ids no other test uses.

- [ ] **Step 2: Run the tests and see them fail**

Run: `DATABASE_URL=postgresql://dealfinder:dealfinder@127.0.0.1:5434/dealfinder ./.venv/bin/python -m pytest tests/test_retention.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'dealfinder.retention'`.

- [ ] **Step 3: Implement** `retention.py`. Add the RUNBOOK section: what is purged, the 59-hour cut-off and why, and the manual command.

- [ ] **Step 4: Run the tests and see them pass**

Run: same as Step 2, then the full suite offline and with the DB. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/retention.py RUNBOOK.md tests/test_retention.py
git commit -m "feat(retention): purge Best Buy rows before 72 h and every unstorable row in a job-role transaction"
```

---

### Task 9: Strip image URLs from the teaching snapshot

**Files:**
- Create: `scripts/strip_snapshot_images.py`
- Modify: `data/snapshots/electronics-2026-07.json` (195 of 270 rows carry `image_url` today), `data/build_snapshot.py:119`
- Modify: `dealfinder/snapshot.py:9-13` (docstring row shape), `:38-47` (`load_snapshot`), `:77` (`to_products`)
- Test: `tests/test_snapshot.py:6-14`

**Interfaces:**
- Produces:
  - `strip_images(path: Path) -> int`, the number of rows changed. Idempotent. It removes every item's `image_url` key and rewrites the file with its existing indent and key order, so the diff touches only `image_url` lines.
  - `load_snapshot` drops any `image_url` key it finds, which guards a future snapshot. `to_products` sets `image_url=None`.
  - `data/build_snapshot.py` no longer writes `image_url`.

- [ ] **Step 1: Write the failing tests**

```python
SNAP = Path(__file__).resolve().parent.parent / "data" / "snapshots" / "electronics-2026-07.json"

def test_snapshot_file_has_no_image_urls():
    assert "image_url" not in SNAP.read_text()

def test_snapshot_rows_and_products_carry_no_images():
    assert all("image_url" not in r for r in load_snapshot())
    assert all(p.image_url is None for p in load_products())

def test_snapshot_builder_never_writes_image_urls():
    assert "image_url" not in (SNAP.parent.parent / "build_snapshot.py").read_text()
```

In `test_snapshot_loads_270_real_items`, drop `"image_url"` from the required keys.

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_snapshot.py -v`
Expected: FAIL. The file contains `image_url`.

- [ ] **Step 3: Implement** the script and the loader changes. Run `./.venv/bin/python scripts/strip_snapshot_images.py data/snapshots/electronics-2026-07.json`.
Expected: `stripped image_url from 195 rows`. A second run prints `stripped image_url from 0 rows`.

- [ ] **Step 4: Prove nothing else moved**

Run: `git diff -U0 data/snapshots/ | grep '^[-+] ' | grep -v image_url | wc -l`
Expected: `0`.
Run: `./.venv/bin/python -m pytest -q && ./.venv/bin/python -m dealfinder.run_evals`
Expected: all pass, and the eval gate prints the same numbers as a run on the parent commit.

- [ ] **Step 5: Commit**

```bash
git add scripts/strip_snapshot_images.py data/snapshots/electronics-2026-07.json data/build_snapshot.py dealfinder/snapshot.py tests/test_snapshot.py
git commit -m "chore(snapshot): drop image_url from the teaching snapshot; never load or rebuild it"
```

---

### Task 10: Docs, live check, pull request

**Files:**
- Modify: `COST.md:20`. The "Live sources" row claims a snapshot fallback for `/search`, which research §1 found false.
- Modify: `README.md` (configuration: `DEALFINDER_SOURCES`, `DEALFINDER_VERDICT_MODE`, `DEALFINDER_SOURCE_TIMEOUT_S`, `DEALFINDER_EBAY_ALLOW_SANDBOX`, the eBay box, and the license rules in one short table)
- Modify: `.env.example` (add those four variables, remove `EBAY_CAMPAIGN_ID`)

- [ ] **Step 1: Fix the docs.** The COST.md row should say: sources need their free keys, results can be empty without them, and production runs Best Buy only. Leave the course step table in `README.md` (the `step-36` row) alone. Plan 7 owns it.

- [ ] **Step 2: Live check with the real Best Buy key** (standing rule: demo it in the real app)

1. Run `docker-compose up -d db && ./.venv/bin/python -m dealfinder.migrate`.
2. Run `DEALFINDER_SOURCES=BestBuy ./.venv/bin/uvicorn dealfinder.serve:app --port 8000`. The app reads `BESTBUY_API_KEY` from `.env` itself.
3. Run `curl -s localhost:8000/sources`. Expected: `"BestBuy": true`. If it is `false`, stop, quote the output and go to Owner setup item 1.
4. Run `curl -s 'localhost:8000/search?q=noise+cancelling+headphones' | python -m json.tool | head -60`. Expected: every `results[].source` starts with `BestBuy`, `attribution` holds the Best Buy object, and `ebay.enabled` matches whether production eBay keys exist.
5. Open the Nocturne lab page, search "headphones", and take a chrome-devtools screenshot. Verdict badges appear on Best Buy rows only.
6. Restart with `DEALFINDER_VERDICT_MODE=check`. Every `/search` verdict is `null`, and `curl -s 'localhost:8000/check?title=Sony+WH-1000XM5&price=199'` returns a verdict.
7. Run `./.venv/bin/python -m dealfinder.retention`. Expected: one JSON line with counts.

- [ ] **Step 3: Full suite in both modes, plus lint**

Run: `./.venv/bin/python -m pytest -q`, the same with `DATABASE_URL` set, then `ruff check .`.
Expected: all pass, and ruff is clean.

- [ ] **Step 4: Commit and open the PR**

```bash
git add COST.md README.md .env.example
git commit -m "docs: launch sources, verdict mode and license rules; drop the false snapshot-fallback claim"
git push -u origin feat/launch-p2-data && gh pr create --fill
```

Merging the PR and applying `0003` and `0004` to the shared Supabase project each need the owner's go: "reply 'you do it'".

---

## Changes made during execution

The final review changed four interfaces later plans consume. The contracts file has the current values:
- The retention margin is 25 h, a 47 h Best Buy cut-off, so one failed purge run still keeps rows under 72 h.
  Task 8's 58 h / 60 h examples became 46 h / 48 h.
- `/search` gains `degraded`. A degraded anonymous response is never edge-cached.
- `lookup_skus` raises `RuntimeError` with no key instead of returning `{}`.
- In production, `enabled_sources` raises unless `DEALFINDER_SOURCES` names only launch sources.

## Owner setup

Each item is tried first without the owner. Ask only after quoting the failure.

1. **Best Buy API key.** Task 10 Step 2.3 shows whether the companion `.env` already holds a working key. Ask only if `/sources` reports `"BestBuy": false` or the first search returns 403. Without a key the live check cannot run, but every offline test still passes.
2. **eBay production keys and Browse API production access.** Launch does not block on this (spec §6.2). Without it, `ebay.enabled` is `false` and the box is hidden. Check `curl /sources` and `EbaySource().is_sandbox()` first.
3. **Production migration** of `0003` and `0004` to `cct-demos`, after "reply 'you do it'". Apply with `python -m dealfinder.migrate` and `MIGRATION_DATABASE_URL` from the owner's env file, never a pasted secret.
