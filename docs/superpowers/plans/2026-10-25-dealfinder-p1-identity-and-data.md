# DealFinder Plan 1 — Identity and Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DealFinder's spoofable dev identity with verified Supabase sign-in, move its data into a versioned `dealfinder` schema on the shared Supabase project, and make the watchlist and saved searches real and private.

**Architecture:** The FastAPI backend verifies Supabase-issued ES256 JWTs against the project's JWKS and never trusts identity headers. All DealFinder tables live in the `dealfinder` schema, created by numbered SQL migrations that a CLI applies (never at import). Every scoped query runs inside one transaction that sets `SET LOCAL ROLE dealfinder_app`, `SET LOCAL search_path` and transaction-local `app.user_id` / `app.tenant_id`, so Postgres RLS enforces privacy and nothing leaks across pooled connections.

**Tech Stack:** Python 3.11, FastAPI, psycopg 3 + psycopg-pool, PyJWT[crypto] (ES256 via JWKS), Postgres 16 + pgvector (local `pgvector/pgvector:0.7.0-pg16`; Supabase in production), pytest, supabase-js 2.45.4 (lab page only).

**Spec:** `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md` (site repo, branch `docs/dealfinder-launch`). Evidence: `docs/superpowers/plans/2026-10-25-dealfinder-launch-research.md` §1.

**Repo and branch:** product code lives in `~/Development/tutorial-dealfinder` (GitHub `cloudcodetree/tutorial-dealfinder`). Branch `feat/launch-p1-identity` from `origin/main` (HEAD `20b3fd5`). Task 7's allowlist script lives in the site repo (`~/Development/cloudcodetree.com`), branch `feat/supabase-allowlist` from `origin/main`.

## Plan sequence (this is Plan 1)

1. **Identity and data foundation** ← this plan.
2. Live data and verdict compliance: Best Buy source + attribution + 72-hour purge, eBay box without verdicts, "check a deal" mode, concurrent sources, snapshot `image_url` strip, response caching.
3. Hosting: Cloud Run service and jobs, Cloud Scheduler, Secret Manager, the `deals.cloudcodetree.com` Worker, static deal pages, budget caps, `COST.md` + `cost_check.py` for the cloud.
4. Shopper front end (React + Nocturne tokens), the lab at `/lab`, accessibility CI.
5. Alerts (re-price job + Resend), observability (Sentry, logs, dead-man's switch), privacy pages, launch-gate rewrite in `ROADMAP.md`.
6. Course lesson-build pipeline: generated step commits, anchor includes, captured outputs, CI per step, screenshot manifests.
7. Course re-grounding + three new lessons (split by course phase).
8. Soft launch, owner walkthrough, release, Show HN.

## Global Constraints

- Identity comes only from a verified JWT. No request header (`X-User-Id`, `X-Tenant-Id`) may set a user or tenant (spec §6.5).
- JWT verification: JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, issuer `{SUPABASE_URL}/auth/v1`, audience `authenticated`, algorithms `ES256` and `RS256` only. A missing `SUPABASE_URL` or an unreachable JWKS fails closed with 503 `auth unavailable`.
- Shared project rules (spec §6.5): every DealFinder table is in schema `dealfinder`, never `public`. Migrations never touch other schemas' tables.
- The app role `dealfinder_app` is `NOSUPERUSER NOBYPASSRLS`. Every RLS table uses `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- RLS keys on `app.user_id`, which the backend sets to the verified JWT `sub`. That is the same id Supabase's `auth.uid()` returns, which is what spec §6.5 means by "key on auth.uid()". The backend connects through the pooler, not PostgREST, so `auth.uid()` itself is never set.
- Scope settings are transaction-local only (`SET LOCAL`, `set_config(..., true)`). Session-level `set_config(..., false)` is forbidden from now on.
- Migrations run only via `python -m dealfinder.migrate`, never at import or app startup.
- The offline suite stays green with no `DATABASE_URL` (DB tests skip). CI runs the DB tests for real against a pgvector service.
- $0 and modest-laptop guarantees hold (ROADMAP principle 6). No new paid service and no new heavy dependency.
- The shopper's anonymous search never requires sign-in (spec §5 anti-goal: no sign-up wall).
- No query text from anonymous searches is stored.
- Ruff rules stay `E4, E7, E9, F`.
- Do not touch the 37 lessons or step tags in this plan. Course re-grounding is Plans 6-7.
- Production changes need an explicit owner go: a prod migration, a merge to `main`, or a Supabase auth config change. Ask in the form "reply 'you do it'".

## Review Focus

1. **A pooled connection reused by the next request must carry no previous user's role or `app.user_id`.** Expected: a fresh checkout reports the login role and an empty `app.user_id`. Pinned in Task 4, `test_pooled_connection_does_not_leak_scope`.
2. **Algorithm confusion: an HS256 token signed with arbitrary bytes, or `alg: none`, must be 401, never accepted.** Pinned in Task 2, `test_hs256_token_is_rejected` and `test_alg_none_is_rejected`.
3. **If Supabase's JWKS is unreachable, signed-in routes must answer 503, not 500 and not 200; anonymous search keeps working.** Pinned in Task 2, `test_jwks_unreachable_fails_closed`, and Task 3, `test_search_still_works_when_auth_is_down`.
4. **A client must not be able to set a watched item's price, and must not be able to watch an offer that isn't in its own tenant's catalog.** Pinned in Task 5, `test_client_price_is_rejected` and `test_watch_offer_from_other_tenant_is_not_found`.
5. **Saved-search abuse: an empty query, a 201-character query, a negative max price, or a 51st saved search.** Expected: 422, 422, 422 and 409. Pinned in Task 6, `test_saved_search_validation` and `test_saved_search_cap`.

---

### Task 1: Versioned migrations and the `dealfinder` schema

**Files:**
- Create: `dealfinder/migrate.py`
- Create: `dealfinder/migrations/0001_dealfinder_schema.sql`
- Modify: `dealfinder/serve.py:33-42` (remove import-time DDL)
- Modify: `pyproject.toml` (package-data for `migrations/*.sql`)
- Modify: `.github/workflows/ci.yml` (pgvector service + migrate step)
- Modify: `README.md` (database section)
- Modify: `tests/conftest.py` (shared `db` fixture)
- Test: `tests/test_migrate.py`

**Interfaces:**
- Produces:
  - Test fixture `db` in `tests/conftest.py`. It returns the `DATABASE_URL` string after `migrate.apply(url)`, and skips the test when the variable is unset or the database is unreachable. Every DB test in this plan uses it.
  - `migrate.MIGRATIONS_DIR: Path`
  - `migrate.apply(url: str | None = None) -> list[str]` returns the filenames applied this run.
  - `migrate.pending(url: str | None = None) -> list[str]`
  - `migrate.schema_ready(url: str | None = None) -> bool`
  - `python -m dealfinder.migrate` prints each applied file, or `up to date`.
  - All three functions use `url or os.getenv("MIGRATION_DATABASE_URL") or os.getenv("DATABASE_URL")`.
  - The applied log is the table `dealfinder.schema_migrations(filename text primary key, applied_at timestamptz not null default now())`.
- Schema produced by `0001`:
  - `dealfinder.offers`: `tenant_id text not null default 'public'`, `id text`, `title text not null`, `brand text`, `source text not null`, `price double precision not null`, `currency text default 'USD'`, `url text`, `image_url text`, `embedding vector(384)` (nullable), `fetched_at timestamptz not null default now()`. Primary key `(tenant_id, id)`, an HNSW cosine index on `embedding`, RLS policy `tenant_isolation` on `current_setting('app.tenant_id', true)`.
  - `dealfinder.watchlist`: `user_id text not null`, `tenant_id text not null default 'public'`, `offer_id text not null`, `title text not null`, `url text`, `image_url text`, `source text`, `target_price double precision`, `last_price double precision not null`, `last_checked_at timestamptz not null`, `created_at timestamptz not null default now()`. Primary key `(user_id, offer_id)`, RLS policy `watchlist_owner` on `current_setting('app.user_id', true)`.
  - Role `dealfinder_app`: `NOLOGIN NOSUPERUSER NOBYPASSRLS`, created only if missing. `GRANT dealfinder_app TO CURRENT_USER`, `GRANT USAGE ON SCHEMA dealfinder`, and DML grants on both tables. Production login and password are Plan 3, never in SQL.
  - The file starts with `CREATE SCHEMA IF NOT EXISTS dealfinder; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions; SET LOCAL search_path = dealfinder, extensions, public;`. That makes the unqualified `vector` type resolve both locally and on Supabase.

- [ ] **Step 1: Write the failing tests** in `tests/test_migrate.py`, using the `db` fixture.

```python
def test_apply_is_idempotent(db):
    url = db
    migrate.apply(url)                      # first run may or may not apply
    assert migrate.apply(url) == []         # second run applies nothing
    assert migrate.pending(url) == []
    assert migrate.schema_ready(url) is True

def test_tables_live_in_dealfinder_schema(db):
    url = db
    with psycopg.connect(url) as c:
        names = {r[0] for r in c.execute(
            "select table_name from information_schema.tables where table_schema='dealfinder'")}
    assert {"offers", "watchlist", "schema_migrations"} <= names

def test_app_role_cannot_bypass_rls(db):
    url = db
    with psycopg.connect(url) as c:
        row = c.execute("select rolsuper, rolbypassrls from pg_roles where rolname='dealfinder_app'").fetchone()
    assert row == (False, False)

def test_rls_is_forced_on_every_table(db):
    url = db
    with psycopg.connect(url) as c:
        rows = c.execute("""select relname, relrowsecurity, relforcerowsecurity from pg_class
            join pg_namespace n on n.oid = relnamespace
            where nspname='dealfinder' and relname in ('offers','watchlist')""").fetchall()
    assert sorted(rows) == [("offers", True, True), ("watchlist", True, True)]
```

Add two offline tests in the same file. Do not reload `serve`, because other test modules hold its `app`.

```python
def test_db_ready_never_migrates(monkeypatch):
    from dealfinder import serve
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:9/none")
    monkeypatch.setattr(migrate, "apply", lambda *a, **k: pytest.fail("serve must not migrate"))
    monkeypatch.setattr(migrate, "schema_ready", lambda *a, **k: False)
    assert serve._db_ready() is False

def test_serve_source_has_no_migration_calls():
    src = Path(serve.__file__).read_text()
    assert "migrate.apply" not in src and "pgstore.migrate" not in src and "userstore.migrate" not in src
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `docker-compose up -d db && DATABASE_URL=postgresql://dealfinder:dealfinder@127.0.0.1:5434/dealfinder ./.venv/bin/python -m pytest tests/test_migrate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'dealfinder.migrate'`.

- [ ] **Step 3: Implement `dealfinder/migrate.py` and `0001_dealfinder_schema.sql`**

- `apply` runs each pending file in sorted order. Each file runs in its own transaction, together with its `schema_migrations` insert. Reuse the logic of the site's `scripts/db-migrate.mjs`.
- `schema_ready` returns `False` instead of raising when the database is unreachable or the log table is missing.
- The `__main__` block calls `apply()` and prints the result.
- In `serve.py`, replace lines 33-42 with `_DB = _db_ready()`. `_db_ready()` returns `False` without `DATABASE_URL`. Otherwise it returns `migrate.schema_ready()`, logging a warning through `logging.getLogger("dealfinder")` when `False`.

- [ ] **Step 4: Run the tests and see them pass**

Run: same command as Step 2.
Expected: 6 passed.

- [ ] **Step 5: Add the pgvector service to CI**

Edit `.github/workflows/ci.yml` `test` job:
- `services.db`: image `pgvector/pgvector:0.7.0-pg16`, env `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB=dealfinder`, ports `5432:5432`, health-cmd `pg_isready`.
- Job env `DATABASE_URL: postgresql://dealfinder:dealfinder@localhost:5432/dealfinder`.
- A step `python -m dealfinder.migrate` before `pytest -q`.

Then update `README.md` "Running with a database" to `python -m dealfinder.migrate` and add `migrations/*.sql` to `[tool.setuptools.package-data]`.

- [ ] **Step 6: Run the full suite offline and with the DB**

Run: `./.venv/bin/python -m pytest -q`, then the same with `DATABASE_URL` set.
Expected:
- Offline: all pass, DB tests skipped.
- With DB: `test_migrate.py` passes. `test_pgstore.py` and `test_userstore.py` may fail until Tasks 4 and 5. Record which ones.

- [ ] **Step 7: Commit**

```bash
git add dealfinder/migrate.py dealfinder/migrations/0001_dealfinder_schema.sql dealfinder/serve.py pyproject.toml .github/workflows/ci.yml README.md tests/test_migrate.py
git commit -m "feat(db): versioned migrations into a dealfinder schema; no DDL at import"
```

---

### Task 2: Verify Supabase JWTs with JWKS (ES256)

**Files:**
- Modify: `dealfinder/auth.py` (replace the HS256 secret path entirely)
- Modify: `pyproject.toml` (`pyjwt[crypto]>=2.8`)
- Modify: `tests/conftest.py` (a `mint` fixture)
- Test: `tests/test_auth.py` (rewrite)

**Interfaces:**
- Produces:
  - `auth.verify_token(token: str) -> dict` returns verified claims. It raises `HTTPException(401, "token expired")`, `HTTPException(401, "invalid token")`, or `HTTPException(503, "auth unavailable")`.
  - `auth.set_jwks_for_testing(jwks: dict | None) -> None`, where `None` restores network fetching.
  - `auth.jwks_url() -> str`
  - `auth.User` and `auth._role_from_claims` keep their current shapes.
  - `auth.require_user` and `auth.require_role` keep their signatures.
- Removed: `_jwt_secret`, `_decode`, the `SUPABASE_JWT_SECRET` env var.
- Test fixture `mint` in `conftest.py`: `mint(sub: str = "user-123", *, exp_delta: int = 3600, iss: str | None = None, aud: str = "authenticated", kid: str = "test-kid", **claims) -> str`.
  - It signs ES256 with a P-256 key generated per test session.
  - It sets `SUPABASE_URL=https://demo-ref.supabase.co` and registers that key's public JWK via `set_jwks_for_testing`.
  - It resets on teardown.
- Test helper `bearer(token: str) -> dict` in `tests/conftest.py` returns `{"Authorization": f"Bearer {token}"}`.

- [ ] **Step 1: Write the failing tests** in `tests/test_auth.py`. Keep the tiny app with `/me` and `/pro`.

```python
def test_valid_token_returns_user(mint):
    r = client.get("/me", headers=bearer(mint("user-123", email="a@b.com", app_metadata={"plan": "pro"})))
    assert r.status_code == 200 and r.json() == {"id": "user-123", "email": "a@b.com", "role": "pro"}

def test_expired_token(mint):
    r = client.get("/me", headers=bearer(mint(exp_delta=-10)))
    assert (r.status_code, r.json()["detail"]) == (401, "token expired")

def test_wrong_issuer(mint):
    assert client.get("/me", headers=bearer(mint(iss="https://evil.supabase.co/auth/v1"))).status_code == 401

def test_wrong_audience(mint):
    assert client.get("/me", headers=bearer(mint(aud="anon"))).status_code == 401

def test_unknown_kid(mint):
    assert client.get("/me", headers=bearer(mint(kid="other-kid"))).status_code == 401

def test_hs256_token_is_rejected(mint):
    forged = jwt.encode({"sub": "x", "aud": "authenticated", "iss": "https://demo-ref.supabase.co/auth/v1",
                         "exp": int(time.time()) + 60}, "any-secret", algorithm="HS256")
    assert client.get("/me", headers=bearer(forged)).status_code == 401

def test_alg_none_is_rejected(mint):
    unsigned = jwt.encode({"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60}, None, algorithm="none")
    assert client.get("/me", headers=bearer(unsigned)).status_code == 401

def test_jwks_unreachable_fails_closed(mint, monkeypatch):
    token = mint()
    auth.set_jwks_for_testing(None)
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:9")
    r = client.get("/me", headers=bearer(token))
    assert (r.status_code, r.json()["detail"]) == (503, "auth unavailable")

def test_missing_supabase_url_fails_closed(mint, monkeypatch):
    token = mint()
    monkeypatch.delenv("SUPABASE_URL")
    assert client.get("/me", headers=bearer(token)).status_code == 503

def test_role_gate_forbids_other_plans(mint):
    assert client.get("/pro", headers=bearer(mint(app_metadata={"plan": "free"}))).status_code == 403
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_auth.py -v`
Expected: FAIL. The `mint` fixture or `set_jwks_for_testing` is not defined.

- [ ] **Step 3: Implement `verify_token`**

- Use `jwt.PyJWKClient(jwks_url(), cache_keys=True, lifespan=600)`, cached per URL, or a `jwt.PyJWKSet` when a test JWKS is set.
- Call `jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated", issuer=f"{SUPABASE_URL}/auth/v1")`.
- `jwt.PyJWKClientConnectionError` and a missing `SUPABASE_URL` map to 503. `ExpiredSignatureError` maps to 401 `token expired`. Every other `jwt.InvalidTokenError` or `PyJWKClientError` maps to 401 `invalid token`.
- Update the module docstring: Part 32's HS256 secret pattern is replaced by JWKS. The course lesson is re-grounded in Plan 7.

- [ ] **Step 4: Run the tests and see them pass**

Run: same as Step 2.
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/auth.py pyproject.toml tests/conftest.py tests/test_auth.py
git commit -m "feat(auth): verify Supabase ES256 JWTs via JWKS; drop the HS256 shared secret"
```

---

### Task 3: Remove header-based identity

**Files:**
- Modify: `dealfinder/tenancy.py` (`current_principal` takes no headers)
- Modify: `dealfinder/serve.py` (the `/me` route uses `auth.require_user` unchanged; `/ranked` gains a principal)
- Test: `tests/test_tenancy.py` (rewrite to use `mint`)

**Interfaces:**
- Consumes: `auth.verify_token` (Task 2).
- Produces:
  - `tenancy.current_principal(creds: HTTPAuthorizationCredentials | None = Depends(_optional_bearer)) -> Principal`. No token gives `Principal("public", None, "anonymous")`. A valid token gives the tenant from `_tenant_from_claims` or `"public"`, user `sub`, and role `auth._role_from_claims`. A bad token gives 401, and an auth outage gives 503.
  - `tenancy.require_account` is unchanged.
  - `serve.ranked(q: str, k: int = 12, who: Principal = Depends(current_principal))`

- [ ] **Step 1: Write the failing tests**

```python
def test_no_token_is_public_anonymous():
    assert client.get("/whoami").json() == {"tenant": "public", "user": None, "role": "anonymous"}

def test_identity_headers_are_ignored():
    r = client.get("/whoami", headers={"X-User-Id": "alice", "X-Tenant-Id": "acme"})
    assert r.json() == {"tenant": "public", "user": None, "role": "anonymous"}

def test_token_tenant_claim_scopes(mint):
    r = client.get("/whoami", headers=bearer(mint("u-1", app_metadata={"tenant": "acme", "plan": "pro"})))
    assert r.json() == {"tenant": "acme", "user": "u-1", "role": "pro"}

def test_account_needs_a_token(mint):
    assert client.get("/account").status_code == 401
    assert client.get("/account", headers=bearer(mint("u-2"))).json() == {"user": "u-2"}

def test_real_app_watchlist_rejects_header_identity():
    from dealfinder.serve import app as real
    assert TestClient(real).get("/watchlist", headers={"X-User-Id": "alice"}).status_code == 401

def test_search_still_works_when_auth_is_down(monkeypatch, stub_sources):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    from dealfinder.serve import app as real
    assert TestClient(real).get("/ranked", params={"q": "headphones"}).status_code == 200
```

`stub_sources` must stop `/ranked` from reaching the network. Reuse however the existing `/ranked` test in `tests/test_serve.py` stubs the sources. If that test has no fixture, lift its stubbing into a `conftest.py` fixture named `stub_sources`.

Keep the existing `test_tenant_from_claims_reads_common_shapes`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_tenancy.py -v`
Expected: FAIL. `test_identity_headers_are_ignored` returns `user: alice`.

- [ ] **Step 3: Remove the `x_tenant_id` and `x_user_id` parameters** from `current_principal`. Route token checks through `auth.verify_token`. Rewrite the module docstring's resolution order to list two sources: the token, then `public`. Add `who` to `/ranked`.

- [ ] **Step 4: Run the tests and the full offline suite**

Run: `./.venv/bin/python -m pytest tests/test_tenancy.py -v && ./.venv/bin/python -m pytest -q`
Expected: the tenancy tests pass, and the full offline suite passes.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/tenancy.py dealfinder/serve.py tests/test_tenancy.py
git commit -m "fix(security): identity only from a verified token; X-User-Id/X-Tenant-Id ignored"
```

---

### Task 4: Pooled, transaction-scoped connections; readiness; one embedding model

**Files:**
- Create: `dealfinder/db.py`
- Modify: `dealfinder/pgstore.py`. Move it onto `db.scoped` and `dealfinder.offers`, make embeddings optional, and drop the query text.
- Modify: `dealfinder/dedup.py:17-27` (reuse the embed model)
- Modify: `dealfinder/serve.py`. `/search` stops passing `query=`, `/healthz` becomes liveness only, and `/readyz` is new.
- Modify: `pyproject.toml` (`psycopg-pool>=3.2`)
- Test: `tests/test_db.py`, `tests/test_pgstore.py`, `tests/test_embed.py`, `tests/test_serve.py`

**Interfaces:**
- Consumes: `migrate.apply`, `migrate.schema_ready` and the `db` fixture (Task 1).
- Produces:
  - `db.get_pool(url: str | None = None) -> psycopg_pool.ConnectionPool` is cached per URL. It uses `min_size=1`, `max_size=int(os.getenv("DB_POOL_MAX", "5"))`, and kwargs `row_factory=dict_row, prepare_threshold=None, connect_timeout=8`. `prepare_threshold=None` is required for the Supabase transaction pooler.
  - `db.scoped(*, user_id: str | None = None, tenant_id: str = "public", url: str | None = None) -> ContextManager[psycopg.Cursor]` opens one transaction and runs:
    - `SET LOCAL ROLE dealfinder_app`
    - `SET LOCAL search_path = dealfinder, extensions, public`
    - `set_config('app.tenant_id', tenant_id, true)`
    - `set_config('app.user_id', user_id or '', true)`

    It commits on a clean exit and rolls back on an exception.
  - `db.ping(url: str | None = None) -> bool`
  - `pgstore.upsert(products: list[dict], embeddings: list | None, tenant: str = "public", url: str | None = None) -> int`. On conflict it keeps the stored embedding when the new one is `None`. The `query` parameter is removed. Update every caller, including `serve.py:94` and `tests/test_pgstore.py`.
  - `pgstore.semantic_search(...)` and `pgstore.count(...)` keep their signatures, read `dealfinder.offers`, and `semantic_search` filters `embedding IS NOT NULL`.
  - `pgstore.migrate(url)` becomes a thin wrapper calling `migrate.apply(url)`. Delete `DDL`, `TENANCY_DDL` and `connect`.
  - `GET /healthz` returns 200 `{"status": "ok"}` always, as the liveness check. `GET /readyz` returns:
    - 200 `{"db": "disabled"}` without `DATABASE_URL`
    - 200 `{"db": "ok", "schema": "current"}`
    - 503 `{"db": "down"}`
    - 503 `{"db": "ok", "schema": "pending"}`
  - `dedup._get_model` returns `embed._get_model()`, so one model loads per process. `dedup._embed` keeps its float32 cast.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_db.py  (DB; `from dealfinder import db as db_mod`)
def test_pooled_connection_does_not_leak_scope(db):
    with db_mod.scoped(user_id="user-alice", tenant_id="acme", url=db) as cur:
        cur.execute("select 1")
    with db_mod.get_pool(db).connection() as c:
        row = c.execute("""select current_user as u, current_setting('app.user_id', true) as uid,
                           current_setting('app.tenant_id', true) as tid""").fetchone()
    assert row["uid"] in (None, "") and row["tid"] in (None, "") and row["u"] != "dealfinder_app"

def test_scoped_rolls_back_on_error(db):
    with pytest.raises(RuntimeError):
        with db_mod.scoped(user_id="user-erin", url=db) as cur:
            cur.execute("""insert into dealfinder.watchlist (user_id, offer_id, title, last_price, last_checked_at)
                           values ('user-erin', 'x', 't', 1, now())""")
            raise RuntimeError
    with db_mod.scoped(user_id="user-erin", url=db) as cur:
        assert cur.execute("select count(*) as n from dealfinder.watchlist").fetchone()["n"] == 0

def test_scoped_sees_only_its_tenant(db):
    with db_mod.scoped(tenant_id="tenant-a", url=db) as cur:
        assert cur.execute("select current_setting('app.tenant_id', true) as t").fetchone()["t"] == "tenant-a"

# tests/test_pgstore.py  (DB; update the two existing tests to the new upsert signature, then add)
def test_rows_without_embeddings_are_skipped_by_semantic_search(db):
    vec = [1.0] + [0.0] * (pgstore.EMBED_DIM - 1)
    pgstore.upsert([{"id": "emb-yes", "title": "Has vector", "source": "S", "price": 10}], [vec], url=db)
    pgstore.upsert([{"id": "emb-no", "title": "No vector", "source": "S", "price": 10}], None, url=db)
    assert "No vector" not in {r["title"] for r in pgstore.semantic_search(vec, k=50, url=db)}

def test_offers_store_no_query_text(db):
    with psycopg.connect(db) as c:
        cols = {r[0] for r in c.execute("""select column_name from information_schema.columns
                where table_schema='dealfinder' and table_name='offers'""")}
    assert "query" not in cols

# tests/test_embed.py  (offline)
def test_one_embedding_model_per_process(monkeypatch):
    made = []
    class Fake:
        def __init__(self, *a, **k): made.append(1)
        def embed(self, texts): return [[0.0] * 384 for _ in texts]
    monkeypatch.setattr("fastembed.TextEmbedding", Fake)
    monkeypatch.setattr(embed, "_model", None)
    embed._get_model(); dedup._embed(["a", "b"])
    assert len(made) == 1

# tests/test_serve.py  (offline)
def test_readyz_without_db(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert client.get("/readyz").json() == {"db": "disabled"}

def test_readyz_db_down(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:9/none")
    monkeypatch.setattr(db_mod, "ping", lambda *a, **k: False)
    r = client.get("/readyz")
    assert (r.status_code, r.json()) == (503, {"db": "down"})

def test_healthz_is_liveness_only():
    assert client.get("/healthz").json() == {"status": "ok"}
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `DATABASE_URL=postgresql://dealfinder:dealfinder@127.0.0.1:5434/dealfinder ./.venv/bin/python -m pytest tests/test_db.py tests/test_pgstore.py tests/test_embed.py tests/test_serve.py -k "leak or rolls or tenant or embeddings or query_text or model_per or readyz or liveness" -v`
Expected: FAIL. `dealfinder.db` is not defined.

- [ ] **Step 3: Implement** `db.py`, the `pgstore` port, the `dedup` reuse, and the two routes.

- [ ] **Step 4: Run the full suite offline and with the DB**

Run: `./.venv/bin/python -m pytest -q`, then the same with `DATABASE_URL` set.
Expected:
- Offline: all pass.
- With DB: everything passes except `tests/test_userstore.py`, which Task 5 rewrites. Record the counts.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/db.py dealfinder/pgstore.py dealfinder/dedup.py dealfinder/serve.py pyproject.toml tests/test_db.py tests/test_pgstore.py tests/test_embed.py tests/test_serve.py
git commit -m "feat(db): pooled transaction-scoped RLS, no stored query text, /readyz, one embedding model"
```

---

### Task 5: Watchlist with server-side prices

**Files:**
- Modify: `dealfinder/userstore.py` (rewrite onto `db.scoped`; delete `WATCHLIST_DDL` and the `connect` import)
- Modify: `dealfinder/serve.py:239-282` (`WatchIn` and the routes), plus `/ranked` remembers offers
- Test: `tests/test_userstore.py` (rewrite), `tests/test_serve.py`

**Interfaces:**
- Consumes:
  - `db.scoped` and `pgstore.upsert(products, embeddings | None, tenant, url)` (Task 4)
  - `current_principal` and `require_account` (Task 3)
  - `mint`, `bearer` and `db` fixtures (Tasks 1-2)
- Produces:
  - `userstore.add_watch(user_id: str, tenant_id: str, offer_id: str, target_price: float | None, url: str | None = None) -> dict`. It copies `title`, `url`, `image_url`, `source`, `price` (as `last_price`) and `fetched_at` (as `last_checked_at`) from the offer in that tenant's `dealfinder.offers`, in the same transaction. It raises `LookupError` when the offer is absent, and `LimitExceeded` at 200 items.
  - `userstore.list_watch(user_id: str, url: str | None = None) -> list[dict]` returns rows with `offer_id` and `hit`, newest first.
  - `userstore.remove_watch(user_id: str, offer_id: str, url: str | None = None) -> int`
  - `class userstore.LimitExceeded(Exception)`
  - `userstore.migrate(url)` becomes a thin wrapper calling `migrate.apply(url)`.
  - Routes:
    - `POST /watchlist` takes a `WatchIn` body: `offer_id: str`, `target_price: float | None = Field(default=None, gt=0)`, with `model_config = ConfigDict(extra="forbid")`. It answers 201 with the row, 404 `offer not found — search for it first`, or 409 `watchlist limit reached (200)`.
    - `GET /watchlist` returns `{"count": int, "items": [...]}`.
    - `DELETE /watchlist/{offer_id}` returns 404 `not on your watchlist`.
  - `serve._remember_offers(results: list[dict], tenant: str) -> None` is best-effort and swallows errors. It calls `pgstore.upsert(results, None, tenant=tenant)` when `_DB`. `/ranked` calls it with `who.tenant_id`, so a deal shown by `/ranked` can be watched.

- [ ] **Step 1: Write the failing DB tests** in `tests/test_userstore.py`.

A fixture `offers(db)` upserts these offers with `embeddings=None`, and its teardown deletes every row the module's tests created:
- `off-1`: title "Anker Soundcore Q20i", price 44.99, tenant `public`
- `off-2`: title "Bose QuietComfort 45", price 46.00, tenant `public`
- `acme-1`: tenant `acme`

```python
def test_watch_uses_server_price(db, offers):
    row = userstore.add_watch("user-alice", "public", "off-1", target_price=40.0, url=db)
    assert row["last_price"] == 44.99 and row["title"] == "Anker Soundcore Q20i"

def test_watch_unknown_offer(db, offers):
    with pytest.raises(LookupError):
        userstore.add_watch("user-alice", "public", "nope", None, url=db)

def test_watch_offer_from_other_tenant_is_not_found(db, offers):
    with pytest.raises(LookupError):
        userstore.add_watch("user-alice", "public", "acme-1", None, url=db)

def test_watchlist_is_private_per_user(db, offers):
    userstore.add_watch("user-alice", "public", "off-1", 40.0, url=db)
    userstore.add_watch("user-bob", "public", "off-2", 50.0, url=db)
    assert {r["offer_id"] for r in userstore.list_watch("user-alice", url=db)} == {"off-1"}
    assert {r["offer_id"] for r in userstore.list_watch("user-bob", url=db)} == {"off-2"}
    assert userstore.remove_watch("user-bob", "off-1", url=db) == 0

def test_hit_flag(db, offers):
    userstore.add_watch("user-carol", "public", "off-2", target_price=50.0, url=db)
    assert userstore.list_watch("user-carol", url=db)[0]["hit"] is True
```

- [ ] **Step 2: Write the failing offline route tests** in `tests/test_serve.py`. Monkeypatch `serve._DB = True` and the `userstore` functions. `raise_(exc)` is a two-line test helper that raises its argument.

```python
def test_client_price_is_rejected(mint):
    r = client.post("/watchlist", json={"offer_id": "off-1", "target_price": 40, "last_price": 1},
                    headers=bearer(mint("u-1")))
    assert r.status_code == 422

def test_watch_unknown_offer_is_404(mint, monkeypatch):
    monkeypatch.setattr(userstore, "add_watch", lambda *a, **k: raise_(LookupError()))
    r = client.post("/watchlist", json={"offer_id": "nope"}, headers=bearer(mint("u-1")))
    assert (r.status_code, r.json()["detail"]) == (404, "offer not found — search for it first")

def test_watch_cap_is_409(mint, monkeypatch):
    monkeypatch.setattr(userstore, "add_watch", lambda *a, **k: raise_(userstore.LimitExceeded()))
    r = client.post("/watchlist", json={"offer_id": "off-1"}, headers=bearer(mint("u-1")))
    assert (r.status_code, r.json()["detail"]) == (409, "watchlist limit reached (200)")

def test_target_price_must_be_positive(mint):
    r = client.post("/watchlist", json={"offer_id": "off-1", "target_price": 0}, headers=bearer(mint("u-1")))
    assert r.status_code == 422
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `DATABASE_URL=... ./.venv/bin/python -m pytest tests/test_userstore.py tests/test_serve.py -k "watch or price" -v`
Expected: FAIL. `add_watch` has the old signature, and the extra field is accepted.

- [ ] **Step 4: Implement** the `userstore` rewrite, `WatchIn`, the routes and `_remember_offers`. Count the user's rows and insert in the same scoped transaction, so the cap can't be raced past.

- [ ] **Step 5: Run the tests and see them pass**

Run: the same command as Step 3, then `./.venv/bin/python -m pytest -q` offline and with the DB.
Expected: all pass in both modes.

- [ ] **Step 6: Commit**

```bash
git add dealfinder/userstore.py dealfinder/serve.py tests/test_userstore.py tests/test_serve.py
git commit -m "feat(watchlist): prices come from the server's offer catalog, never the client"
```

---

### Task 6: Saved searches

**Files:**
- Create: `dealfinder/migrations/0002_saved_searches.sql`
- Modify: `dealfinder/userstore.py`
- Modify: `dealfinder/serve.py` (three routes)
- Test: `tests/test_userstore.py`, `tests/test_serve.py`

**Interfaces:**
- Consumes: `db.scoped` (Task 4), `require_account` (Task 3), `userstore.LimitExceeded` (Task 5).
- Produces:
  - Table `dealfinder.saved_searches(id uuid primary key default gen_random_uuid(), user_id text not null, query text not null check (char_length(query) between 1 and 200), max_price double precision check (max_price is null or max_price > 0), created_at timestamptz not null default now())`, with forced RLS policy `saved_search_owner` on `current_setting('app.user_id', true)` and DML grants to `dealfinder_app`.
  - `userstore.add_saved_search(user_id: str, query: str, max_price: float | None, url: str | None = None) -> dict`. It raises `LimitExceeded` at 50.
  - `userstore.list_saved_searches(user_id: str, url: str | None = None) -> list[dict]`, newest first.
  - `userstore.remove_saved_search(user_id: str, search_id: str, url: str | None = None) -> int`
  - Routes:
    - `POST /saved-searches` takes a body with `query: str` (stripped, 1-200 chars) and `max_price: float | None` (`gt=0`), extra fields forbidden. It answers 201, or 409 `saved-search limit reached (50)`.
    - `GET /saved-searches` returns `{"count": int, "items": [...]}`.
    - `DELETE /saved-searches/{search_id}` returns 404 `saved search not found`. A malformed UUID is also 404, never 500.

- [ ] **Step 1: Write the failing tests**

```python
# DB
def test_saved_searches_private_per_user(db):
    a = userstore.add_saved_search("user-alice", "noise cancelling headphones", 150.0, url=db)
    userstore.add_saved_search("user-bob", "mechanical keyboard", None, url=db)
    assert [s["query"] for s in userstore.list_saved_searches("user-alice", url=db)] == ["noise cancelling headphones"]
    assert userstore.remove_saved_search("user-bob", str(a["id"]), url=db) == 0

def test_saved_search_cap(db):
    for i in range(50):
        userstore.add_saved_search("user-dave", f"q{i}", None, url=db)
    with pytest.raises(userstore.LimitExceeded):
        userstore.add_saved_search("user-dave", "one too many", None, url=db)

# offline routes
@pytest.mark.parametrize("body", [{"query": ""}, {"query": "x" * 201}, {"query": "ok", "max_price": -1},
                                  {"query": "ok", "extra": 1}])
def test_saved_search_validation(mint, body):
    assert client.post("/saved-searches", json=body, headers=bearer(mint("u-1"))).status_code == 422

def test_saved_search_cap_is_409(mint, monkeypatch):
    monkeypatch.setattr(userstore, "add_saved_search", lambda *a, **k: raise_(userstore.LimitExceeded()))
    r = client.post("/saved-searches", json={"query": "ok"}, headers=bearer(mint("u-1")))
    assert (r.status_code, r.json()["detail"]) == (409, "saved-search limit reached (50)")

def test_delete_malformed_id_is_404(mint):
    assert client.delete("/saved-searches/not-a-uuid", headers=bearer(mint("u-1"))).status_code == 404
```

Every DB test cleans up its own rows.

- [ ] **Step 2: Run the tests and see them fail**

Run: `DATABASE_URL=... ./.venv/bin/python -m pytest tests/test_userstore.py tests/test_serve.py -k saved -v`
Expected: FAIL. `add_saved_search` is not defined.

- [ ] **Step 3: Implement** the migration, the store functions and the routes. Count and insert in one scoped transaction.

- [ ] **Step 4: Run the tests and see them pass**

Run: `python -m dealfinder.migrate`, then the command from Step 2, then the full suite in both modes.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/migrations/0002_saved_searches.sql dealfinder/userstore.py dealfinder/serve.py tests/test_userstore.py tests/test_serve.py
git commit -m "feat(accounts): private saved searches with validation and a 50-item cap"
```

---

### Task 7: Real sign-in on the lab page

**Files:**
- Modify: `dealfinder/serve.py` (new `GET /config.json`)
- Modify: `dealfinder/static/redesign.html:153,306-320,475-478,621-638`
- Test: `tests/test_serve.py`
- Site repo: Create `scripts/supabase-allowlist.mjs` + `scripts/supabase-allowlist.test.mjs`

**Interfaces:**
- Consumes: the `require_account` routes from Tasks 5-6, and the `mint` and `bearer` fixtures from Task 2.
- Produces:
  - `GET /config.json` returns `{"supabaseUrl": str | null, "supabasePublishableKey": str | null, "providers": ["google", "github"]}` from env `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, and nothing else.
  - The lab loads `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js`.
  - Sign-in offers a magic link, Google and GitHub, using `signInWithOtp` / `signInWithOAuth` with `redirectTo: location.origin + location.pathname`.
  - `authHeaders()` returns `{Authorization: 'Bearer ' + session.access_token}`, or `{}` when signed out.
  - With null config, the button reads "Sign-in not configured" and is disabled.
  - Site repo:
    - `mergeAllowList(current: string, add: string[]) -> string` is exported. It is a comma-joined, de-duplicated union that keeps order.
    - The CLI is `node scripts/supabase-allowlist.mjs --add <pattern> [--add …] [--dry-run]`. It GETs `/v1/projects/{ref}/config/auth`, prints the before and after lists, and PATCHes only `uri_allow_list`.
    - It reads its token from the env file the same way `scripts/configure-auth.mjs` does.
    - Do not use `configure-auth.mjs` here. It overwrites the whole list and `site_url`.

- [ ] **Step 1: Write the failing tests**

```python
def test_config_json_exposes_only_public_settings(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://tgcysgioncdmtzcfknix.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("DATABASE_URL", "postgresql://secret-user:secret-pass@db/x")
    r = client.get("/config.json")
    assert set(r.json()) == {"supabaseUrl", "supabasePublishableKey", "providers"}
    assert "secret-pass" not in r.text

def test_lab_has_no_dev_identity():
    html = (Path(serve.__file__).parent / "static" / "redesign.html").read_text()
    assert "X-User-Id" not in html and "prompt(" not in html
    assert "@supabase/supabase-js@2.45.4" in html
```

```js
// site repo: scripts/supabase-allowlist.test.mjs
import { describe, expect, it } from 'vitest';
import { mergeAllowList } from './supabase-allowlist.mjs';
describe('mergeAllowList', () => {
  it('appends new patterns once, keeps order', () => {
    expect(mergeAllowList('https://a/**,https://b/**', ['https://b/**', 'http://127.0.0.1:8000/**']))
      .toBe('https://a/**,https://b/**,http://127.0.0.1:8000/**');
  });
  it('handles an empty current list', () => {
    expect(mergeAllowList('', ['https://deals.cloudcodetree.com/**'])).toBe('https://deals.cloudcodetree.com/**');
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_serve.py -k "config_json or dev_identity" -v` and, in the site repo, `pnpm exec vitest run scripts/supabase-allowlist.test.mjs`.
Expected: FAIL. The route is missing, `prompt(` is present, and the module is not found.

- [ ] **Step 3: Implement** `/config.json`, the lab sign-in, and the site script.

- [ ] **Step 4: Run the tests and see them pass**

Run: same as Step 2.
Expected: pass.

- [ ] **Step 5: Preview the allowlist change (read-only), then get owner approval**

Run in the site repo: `node scripts/supabase-allowlist.mjs --add 'http://127.0.0.1:8000/**' --dry-run`
Expected: before and after lists printed. The after list equals the before list plus `http://127.0.0.1:8000/**`.
Then ask the owner: "reply 'you do it' to add `http://127.0.0.1:8000/**` to the shared Supabase auth allowlist". Run without `--dry-run` only after that reply.

- [ ] **Step 6: Verify live in the browser** (standing rule: demo it in the real app)

1. Run `docker-compose up -d db && python -m dealfinder.migrate`.
2. Start the app: `SUPABASE_URL=https://tgcysgioncdmtzcfknix.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key from the site's wrangler.jsonc> ./.venv/bin/uvicorn dealfinder.serve:app --port 8000`.
3. Open `http://127.0.0.1:8000/redesign` and sign in with a magic link.
4. Search "headphones" and watch one deal. The watchlist shows it with the server's price.
5. Screenshot with chrome-devtools.
6. In a fresh incognito window, `GET /watchlist` with `X-User-Id: <your id>` returns 401.

- [ ] **Step 7: Commit both repos, open both PRs**

```bash
# companion
git add dealfinder/serve.py dealfinder/static/redesign.html tests/test_serve.py
git commit -m "feat(lab): real Supabase sign-in; /config.json exposes only public settings"
git push -u origin feat/launch-p1-identity && gh pr create --fill
# site repo
git add scripts/supabase-allowlist.mjs scripts/supabase-allowlist.test.mjs
git commit -m "feat(scripts): additive Supabase auth allowlist edits with --dry-run"
git push -u origin feat/supabase-allowlist && gh pr create --fill
```

Merging either PR needs the owner's explicit go.
