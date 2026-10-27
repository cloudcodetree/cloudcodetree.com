# DealFinder Plan 5: Alerts, Observability, Privacy and the Launch Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price-drop and saved-search emails that really arrive, error tracking and cost-aware request logs with no query text, alerts that reach the owner, a privacy-safe `/ask`, real account export and delete, honest legal pages, and a launch gate where every box names its proof.

**Architecture:** A daily Cloud Run job (`python -m dealfinder.jobs alerts`) re-prices every watched Best Buy SKU, writes one digest email per user through Resend with an idempotency key, and records each alerted item in `dealfinder.alert_log` so nothing is sent twice. Sentry and a JSON request-log middleware cover the backend, and Sentry covers the React front end. Both scrub query strings. A Cron Trigger on the deals Worker probes the static site, R2 pages and the API every 10 minutes and pings Healthchecks.io, which emails the owner, the same as the two job checks. `/ask` runs on Cloudflare Workers AI, whose terms say prompts are never used for training.

**Tech Stack:** Python 3.11, FastAPI, psycopg 3, httpx + respx, `sentry-sdk[fastapi]>=2.72`, `@sentry/react@11.7.0`, Resend REST API, Healthchecks.io v3 API, Cloudflare Workers AI REST API, TypeScript Worker (`edge/`, vitest), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md` §6.5 (alerts), §6.6 (`/ask`, cost), §6.7, §6.8, G2, G5.
**Contracts:** `docs/superpowers/plans/2026-10-26-dealfinder-launch-contracts.md`. Every name used here comes from it or is defined below.
**Plan 1:** `docs/superpowers/plans/2026-10-25-dealfinder-p1-identity-and-data.md`.

**Repo and branch:** `~/Development/tutorial-dealfinder`, branch `feat/launch-p5-ops` from `origin/main` after Plan 4 merges (else stacked on Plan 4's branch). Task 11's DNS records go in the site repo, branch `feat/deals-resend-dns`.

## Plan sequence (this is Plan 5)

1. Identity and data. 2. Live data and verdicts. 3. Hosting. 4. Shopper front end. **5. Alerts, observability, privacy, launch gate ← this plan.** 6. Course build pipeline. 7. Course re-grounding. 8. Launch.

## Global Constraints

- $0. Verified free limits this plan must stay inside:
  - Resend Free: 3,000 emails a month and "limited to 100 emails per day" (https://resend.com/pricing). The job's cap is `ALERT_DAILY_CAP=90`.
  - Sentry Developer: 5k errors, 1 user, 30-day lookback, tracing included (https://sentry.io/pricing/).
  - Healthchecks.io Hobbyist: 20 checks, 100 log entries per check (https://healthchecks.io/pricing/). This plan uses 3.
  - Workers AI: 10,000 Neurons a day free, and "further operations will fail with an error" past it (https://developers.cloudflare.com/workers-ai/platform/pricing/). The allocation is per account, so it is shared with cloudcodetree.com's search embeddings.
  - Cloudflare Cron Triggers: 5 per account on Free. The site uses 1. This plan adds 1.
- No GCP alerting policies or uptime checks. Google's pricing page lists a per-condition monthly charge for alerting (https://cloud.google.com/monitoring/pricing). Uptime runs on the Worker cron plus Healthchecks.
- No query text anywhere: not in a stored row, a log line, a Sentry event, a cache key or a Cloud Run request log. This extends Plan 1's rule.
- In production (`settings.is_production()`) the only LLM provider is Workers AI. OpenRouter is refused there, because free models may log prompts (research §5).
- Every alert email carries `List-Unsubscribe: <url>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails), Best Buy attribution, and the stale-price note. At most one email per user per run.
- Best Buy content in `alert_log.payload` follows the 72-hour rule. Only a hash survives longer.
- Deleting DealFinder data never deletes the shared Supabase sign-in account. The UI and the privacy page say so.
- Only essential cookies. DealFinder sets none. Cloudflare's security cookies `__cf_bm` and `cf_clearance` are the only allowed names.
- Scheduling is Cloud Scheduler or a Worker Cron Trigger. No `schedule:` trigger in any GitHub workflow. No third Cloud Scheduler job: the free allowance is 3 per billing account, and Plan 3 uses 2.
- Client IPs are never logged. The Worker sets `CF-Connecting-IP` and Plan 3's limiter reads it in memory only. The privacy policy says the same.
- Secrets live only in Secret Manager `dealfinder-env`, written by Plan 3's `deploy/secrets.py`, which keeps one active version, or in Worker secrets. Production changes need "reply 'you do it'".
- Plan 3 already ships `dealfinder/jobs.py`, `dealfinder/healthcheck.py` and the `dealfinder-alerts` Scheduler job, created paused. This plan registers `alerts` and never recreates those.
- Plan 1's rules still hold: `db.scoped` / `db.job_scope` only, transaction-local settings, offline suite green without `DATABASE_URL`, Ruff `E4, E7, E9, F`, no lesson or tag edits.

## Review Focus

1. **A send that fails after the batch is recorded must not lose or duplicate the email.** An unknown error keeps the batch pending, and the next run resends it with the same `Idempotency-Key` (Resend dedups for 24 h, https://resend.com/docs/dashboard/emails/idempotency-keys). A definite non-send (quota, 4xx) drops the batch so the next run re-derives it. Pinned in Task 5, `test_crash_between_insert_and_send_resends_once` and `test_quota_exhausted_drops_batch_for_rederive`.
2. **The daily cap defers, never drops.** 95 users due with a cap of 90 send 90 today and 5 on the next run. Pinned in Task 5, `test_daily_cap_defers_not_drops`.
3. **A search query appears in no log line and no Sentry event.** Pinned in Task 7, `test_request_log_has_no_query_text` and `test_sentry_scrubs_query_string`.
4. **An unsubscribe link cannot be edited to unsubscribe someone else, and GET never changes state.** Pinned in Task 3, `test_unsubscribe_token_cannot_be_retargeted` and `test_get_does_not_unsubscribe`.
5. **A user who unsubscribed, or deleted their data, gets no email, and delete touches no other user.** Pinned in Task 5, `test_unsubscribed_user_gets_no_email`, and Task 9, `test_delete_account_removes_only_own_rows`.

## Owner setup

Each item says what an agent tries first. Ask the owner only for what fails, and quote the failure.

| Item | Agent tries first | Needs the owner |
|---|---|---|
| Resend account + API key | nothing: account creation has no API | create the account, add a sending key to `.env` as `RESEND_API_KEY` |
| Resend domain `deals.cloudcodetree.com` | `scripts/resend_domain.py create` (Task 11) calls `POST /domains` and writes the returned records to the site's `infra/resend.tf` | "you do it" for `tofu apply` (DNS is production) |
| Sentry org + projects | after a token exists, `scripts/sentry_setup.py` creates `dealfinder-api` and `dealfinder-web` and prints DSNs | create the account and an auth token with `project:write` |
| Healthchecks checks | after a key exists, `scripts/healthchecks_setup.py` creates 3 checks (Task 10) | create the account and a read-write project API key |
| Workers AI token (`CLOUDFLARE_AI_TOKEN`) | mint a token scoped to Workers AI Read only, via `POST /user/tokens` with the site's existing token. That needs the API Tokens Write permission | create the scoped token by hand, only if that call fails. Quote the error. Never reuse the site's broader CI token |
| Privacy contact address | none | pick the address the privacy page lists (open question) |

---

### Task 1: Migration 0005, profile capture, watch baselines

**Files:**
- Create: `dealfinder/migrations/0005_profiles_and_alerts.sql`
- Modify: `dealfinder/tenancy.py` (`Principal` gains `email`), `dealfinder/userstore.py`, `dealfinder/serve.py` (`POST /watchlist`, `POST /saved-searches`, `GET /me` call `touch_profile`)
- Test: `tests/test_migrate.py`, `tests/test_userstore.py`, `tests/test_serve.py`

**Interfaces:**
- Consumes: `db.scoped`, `db.job_scope`, the `db` / `mint` / `bearer` fixtures, `userstore.add_watch`.
- Produces:
  - `dealfinder.profiles(user_id text primary key, email text not null check (position('@' in email) > 1), alerts_enabled boolean not null default true, unsubscribed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.
  - `dealfinder.alert_log(id bigserial primary key, user_id text not null, batch_id uuid not null, kind text not null check (kind in ('price_drop','saved_search')), dedupe_hash text not null, payload jsonb, status text not null default 'pending' check (status in ('pending','sent','failed')), provider_id text, attempts int not null default 0, created_at timestamptz not null default now(), sent_at timestamptz, unique (user_id, dedupe_hash))`, plus an index on `(status, created_at)`.
  - `alter table dealfinder.watchlist add column baseline_price double precision`, backfilled from `last_price`.
  - Both new tables: `ENABLE` + `FORCE ROW LEVEL SECURITY`, owner policies `profile_owner` / `alert_log_owner` on `current_setting('app.user_id', true)`, job policies `TO dealfinder_job USING (true)`, DML grants to both roles. 0003's job policies do not cover tables created later, so 0005 adds its own.
  - `tenancy.Principal.email: str | None = None`, filled from the verified `email` claim. `/whoami` output is unchanged.
  - `userstore.touch_profile(user_id: str, email: str, url: str | None = None) -> None` (upsert, bumps `updated_at` only when the email changed).
  - `userstore.get_profile(user_id: str, url: str | None = None) -> dict | None`
  - `userstore.set_alerts_enabled(user_id: str, enabled: bool, url: str | None = None) -> bool`. Returns `False` when no profile exists. Sets `unsubscribed_at` on disable and clears it on enable.
  - `userstore.add_watch` also sets `baseline_price = last_price`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_migrate.py (DB)
def test_alert_tables_force_rls(db):
    with psycopg.connect(db) as c:
        rows = c.execute("""select relname, relrowsecurity, relforcerowsecurity from pg_class
            join pg_namespace n on n.oid = relnamespace
            where nspname='dealfinder' and relname in ('profiles','alert_log')""").fetchall()
    assert sorted(rows) == [("alert_log", True, True), ("profiles", True, True)]

# tests/test_userstore.py (DB)
def test_touch_profile_upserts_email(db):
    userstore.touch_profile("user-alice", "a@example.com", url=db)
    userstore.touch_profile("user-alice", "new@example.com", url=db)
    assert userstore.get_profile("user-alice", url=db)["email"] == "new@example.com"

def test_profiles_are_private_but_jobs_see_all(db):
    userstore.touch_profile("user-alice", "a@example.com", url=db)
    userstore.touch_profile("user-bob", "b@example.com", url=db)
    with db_mod.scoped(user_id="user-alice", url=db) as cur:
        assert cur.execute("select count(*) as n from dealfinder.profiles").fetchone()["n"] == 1
    with db_mod.job_scope(url=db) as cur:
        assert cur.execute("select count(*) as n from dealfinder.profiles").fetchone()["n"] >= 2

def test_add_watch_sets_baseline(db, offers):
    assert userstore.add_watch("user-alice", "public", "off-1", None, url=db)["baseline_price"] == 44.99

# tests/test_serve.py (offline)
def test_watch_post_captures_email(mint, monkeypatch):
    seen = []
    monkeypatch.setattr(userstore, "touch_profile", lambda uid, email, **k: seen.append((uid, email)))
    monkeypatch.setattr(userstore, "add_watch", lambda *a, **k: {"offer_id": "off-1"})
    client.post("/watchlist", json={"offer_id": "off-1"}, headers=bearer(mint("u-1", email="u1@example.com")))
    assert seen == [("u-1", "u1@example.com")]

def test_token_without_email_skips_profile(mint, monkeypatch):
    monkeypatch.setattr(userstore, "touch_profile", lambda *a, **k: pytest.fail("no email, no profile"))
    monkeypatch.setattr(userstore, "add_watch", lambda *a, **k: {"offer_id": "off-1"})
    assert client.post("/watchlist", json={"offer_id": "off-1"}, headers=bearer(mint("u-1"))).status_code == 201
```

- [ ] **Step 2: Run and see them fail**

Run: `DATABASE_URL=postgresql://dealfinder:dealfinder@127.0.0.1:5434/dealfinder ./.venv/bin/python -m pytest tests/test_migrate.py tests/test_userstore.py tests/test_serve.py -k "alert_tables or profile or baseline or email" -v`
Expected: FAIL. The tables and `touch_profile` do not exist.

- [ ] **Step 3: Implement** the migration, `Principal.email`, the three store functions, and the `touch_profile` calls. A profile write failure is logged and never fails the request.

- [ ] **Step 4: Run and see them pass**

Run: `python -m dealfinder.migrate`, then Step 2's command, then `./.venv/bin/python -m pytest -q` offline and with the DB.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add dealfinder/migrations/0005_profiles_and_alerts.sql dealfinder/tenancy.py dealfinder/userstore.py dealfinder/serve.py tests/test_migrate.py tests/test_userstore.py tests/test_serve.py
git commit -m "feat(alerts): profiles from the verified email claim, alert log, watch baselines"
```

---

### Task 2: `notify.py`, the Resend sender

**Files:**
- Create: `dealfinder/notify.py`
- Test: `tests/test_notify.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Email: to: str; subject: str; html: str; text: str; unsubscribe_url: str; idempotency_key: str`
  - `class SendResult(NamedTuple): provider_id: str | None; status: str`, where status is `sent | rate_limited | quota_exhausted | rejected | error`.
  - `class Notifier(Protocol): def send(self, email: Email) -> SendResult: ...`
  - `class ResendNotifier(api_key: str | None = None, sender: str | None = None, client: httpx.Client | None = None)`. `send` POSTs `https://api.resend.com/emails` with `Authorization: Bearer`, `Idempotency-Key: <email.idempotency_key>`, and body `{from, to: [to], subject, html, text, headers: {"List-Unsubscribe": "<url>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}}`. The headers are built from `unsubscribe_url`, so no email can lack them.
  - Status mapping: 200 gives `sent` with `id`. 429 with `name` `daily_quota_exceeded` or `monthly_quota_exceeded` gives `quota_exhausted`, and `rate_limit_exceeded` gives `rate_limited` (https://resend.com/docs/api-reference/errors). Any other 4xx gives `rejected`. 5xx or a network error gives `error`. It never raises.
  - `class ConsoleNotifier` records `.sent: list[Email]` and returns `SendResult("console-<n>", "sent")`.
  - `notifier_from_env() -> Notifier`: Resend when `RESEND_API_KEY` is set. Console otherwise, except in production, where it raises `RuntimeError("RESEND_API_KEY missing")` so the job fails loudly.
  - `DEFAULT_FROM = "DealFinder <alerts@deals.cloudcodetree.com>"`, overridable by env `ALERT_FROM`.
- `worker.py`'s `Notifier` stays as the offline teaching core of Part 33. Production alerts need batching and idempotency, which its one-notification protocol cannot express, so `alerts.py` uses `notify.Notifier`.

- [ ] **Step 1: Write the failing tests**

```python
EMAIL = Email(to="a@example.com", subject="s", html="<p>h</p>", text="h",
              unsubscribe_url="https://deals.cloudcodetree.com/api/unsubscribe?t=tok",
              idempotency_key="dealfinder-alerts/b-1")

@respx.mock
def test_resend_sends_with_idempotency_and_unsubscribe_headers():
    route = respx.post("https://api.resend.com/emails").mock(return_value=httpx.Response(200, json={"id": "em_1"}))
    assert ResendNotifier(api_key="re_test").send(EMAIL) == SendResult("em_1", "sent")
    req = route.calls[0].request
    body = json.loads(req.content)
    assert req.headers["Idempotency-Key"] == "dealfinder-alerts/b-1"
    assert body["headers"] == {"List-Unsubscribe": "<https://deals.cloudcodetree.com/api/unsubscribe?t=tok>",
                               "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}

@pytest.mark.parametrize("name,status", [("daily_quota_exceeded", "quota_exhausted"),
    ("monthly_quota_exceeded", "quota_exhausted"), ("rate_limit_exceeded", "rate_limited")])
@respx.mock
def test_resend_429_kinds(name, status):
    respx.post("https://api.resend.com/emails").mock(return_value=httpx.Response(429, json={"name": name}))
    assert ResendNotifier(api_key="re_test").send(EMAIL).status == status

@respx.mock
def test_network_error_is_reported_not_raised():
    respx.post("https://api.resend.com/emails").mock(side_effect=httpx.ConnectError("down"))
    assert ResendNotifier(api_key="re_test").send(EMAIL) == SendResult(None, "error")

def test_production_refuses_console(monkeypatch):
    monkeypatch.setenv("DEALFINDER_ENV", "production")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="RESEND_API_KEY missing"):
        notifier_from_env()
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_notify.py -v`. Expected: FAIL, `No module named 'dealfinder.notify'`.
- [ ] **Step 3: Implement `dealfinder/notify.py`** with httpx only. No Resend SDK.
- [ ] **Step 4: Run and see them pass.** Same command. Expected: 6 passed.
- [ ] **Step 5: Commit**

```bash
git add dealfinder/notify.py tests/test_notify.py
git commit -m "feat(alerts): Resend notifier with idempotency keys and one-click unsubscribe headers"
```

---

### Task 3: Signed unsubscribe links and routes

**Files:**
- Create: `dealfinder/unsubscribe.py`
- Modify: `dealfinder/serve.py` (`GET /unsubscribe`, `POST /unsubscribe`, `PATCH /account`)
- Test: `tests/test_unsubscribe.py`

**Interfaces:**
- Consumes: `userstore.set_alerts_enabled` (Task 1), `require_account`.
- Produces:
  - `unsubscribe.make_token(user_id: str) -> str`, format `<base64url(user_id)>.<base64url(HMAC-SHA256(UNSUBSCRIBE_SECRET, "unsub:v1:" + user_id))>`. No expiry, because links in old emails must keep working. Raises `RuntimeError` when the secret is unset.
  - `unsubscribe.read_token(token: str) -> str | None`. Constant-time compare. `None` for any malformed token or missing secret.
  - `unsubscribe.unsubscribe_url(user_id: str) -> str` gives `f"{PUBLIC_ORIGIN}/api/unsubscribe?t={token}"`, where `PUBLIC_ORIGIN` is env `DEALFINDER_PUBLIC_ORIGIN`, default `https://deals.cloudcodetree.com`.
  - `GET /unsubscribe?t=` returns 200 HTML with a confirm form that POSTs to the same URL. It never changes state. A bad token gives 400 "This unsubscribe link is not valid."
  - `POST /unsubscribe?t=` accepts an empty body or `List-Unsubscribe=One-Click`, calls `set_alerts_enabled(uid, False)`, and returns 200 "You will get no more DealFinder emails." It returns 200 even when no profile exists, so the route reveals nothing.
  - `PATCH /account` with body `{"alerts_enabled": bool}` (extra fields forbidden) behind `require_account` returns `{"alerts_enabled": bool}`. It is the only way back on.

- [ ] **Step 1: Write the failing tests** (`UNSUBSCRIBE_SECRET=test-secret` via an autouse fixture)

```python
def test_token_round_trip():
    assert read_token(make_token("user-alice")) == "user-alice"

def test_unsubscribe_token_cannot_be_retargeted():
    _, sig = make_token("user-alice").split(".")
    forged = base64.urlsafe_b64encode(b"user-bob").decode().rstrip("=") + "." + sig
    assert read_token(forged) is None

def test_missing_secret_fails_closed(monkeypatch):
    tok = make_token("user-alice")
    monkeypatch.delenv("UNSUBSCRIBE_SECRET")
    assert read_token(tok) is None
    with pytest.raises(RuntimeError):
        make_token("user-alice")

def test_get_does_not_unsubscribe(monkeypatch):
    monkeypatch.setattr(userstore, "set_alerts_enabled", lambda *a, **k: pytest.fail("GET changed state"))
    r = client.get("/unsubscribe", params={"t": make_token("user-alice")})
    assert r.status_code == 200 and "<form" in r.text

def test_one_click_post_unsubscribes_and_repeats_cleanly(monkeypatch):
    calls = []
    monkeypatch.setattr(userstore, "set_alerts_enabled", lambda uid, on, **k: calls.append((uid, on)) or False)
    t = make_token("user-alice")
    for _ in range(2):
        assert client.post("/unsubscribe", params={"t": t}, data={"List-Unsubscribe": "One-Click"}).status_code == 200
    assert calls == [("user-alice", False), ("user-alice", False)]

@pytest.mark.parametrize("method", ["get", "post"])
def test_bad_token_is_400(method):
    assert getattr(client, method)("/unsubscribe", params={"t": "junk"}).status_code == 400
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_unsubscribe.py -v`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** the module and the three routes. Escape nothing user-controlled into the HTML except through `html.escape`.
- [ ] **Step 4: Run and see them pass.** Same command. Expected: 7 passed.
- [ ] **Step 5: Commit**

```bash
git add dealfinder/unsubscribe.py dealfinder/serve.py tests/test_unsubscribe.py
git commit -m "feat(alerts): signed unsubscribe links, RFC 8058 one-click POST, re-enable via PATCH /account"
```

---

### Task 4: The alert rule and the email

**Files:**
- Create: `dealfinder/alert_email.py`
- Test: `tests/test_alert_email.py`

**Interfaces:**
- Produces:
  - `DROP_FRAC = 0.05`
  - `should_alert(baseline: float, new: float, target: float | None, *, mode: str = "live") -> bool`. With a target, alert when `new <= target and new < baseline`. Without one, in `live` mode, alert when `new <= round(baseline * (1 - DROP_FRAC), 2)`. In `check` mode (Plan 2's `shop.verdict_mode()`), only the user's own target counts, so no target means no alert. The baseline is our own observed price when watching began or at the last alert, never the seller's "was" price.
  - `@dataclass(frozen=True) class AlertItem: kind: str; title: str; price: float; url: str; baseline: float | None; target: float | None; query: str | None`
  - `render_alert_email(to: str, items: list[AlertItem], *, unsubscribe_url: str, checked_at: datetime, idempotency_key: str, mode: str = "live") -> Email`
  - Subject: `Price drop: {title} is now ${price:.2f}` for one price-drop item, `DealFinder: {n} price alerts` otherwise.
  - Body, html and text alike: each item with its price. A drop says "down from ${baseline:.2f} when you started watching" in `live` mode, and "at or below your target of ${target:.2f}" in `check` mode, with no other comparison. The body also carries `WATCH_REMOVAL_NOTE = "If Best Buy stops listing an item for about 2.5 days, we remove it from your watchlist."` (Plan 2's purge drops rows unchecked for 47 h). Then the attribution "Prices from Best Buy" linking `https://www.bestbuy.com`, the stale note `STALE_PRICE_NOTE = "Prices change, so check the store before you buy."` with the checked time in UTC, a "Why you got this" line, the manage link `https://deals.cloudcodetree.com/watchlist`, and the unsubscribe link.
  - Rendering is pure and deterministic. A retry must produce the same payload, because Resend rejects a reused key with a different body.

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize("baseline,new,target,expected", [
    (100.0, 95.0, None, True), (100.0, 95.01, None, False),
    (100.0, 99.0, 99.5, True), (100.0, 99.6, 99.5, False), (100.0, 100.0, 120.0, False)])
def test_should_alert(baseline, new, target, expected):
    assert should_alert(baseline, new, target) is expected

def test_email_escapes_and_carries_required_lines():
    item = AlertItem("price_drop", "<b>TV</b>", 199.99, "https://www.bestbuy.com/x", 249.99, None, None)
    e = render_alert_email("a@example.com", [item], unsubscribe_url=U, checked_at=T, idempotency_key="k")
    assert "&lt;b&gt;TV&lt;/b&gt;" in e.html and "<b>TV</b>" not in e.html
    for line in ("Prices from Best Buy", STALE_PRICE_NOTE, WATCH_REMOVAL_NOTE, "down from $249.99", U):
        assert line in e.text
    assert e.subject == "Price drop: <b>TV</b> is now $199.99"

@pytest.mark.parametrize("target,expected", [(None, False), (99.5, True)])
def test_check_mode_counts_only_the_target(target, expected):
    assert should_alert(100.0, 90.0, target, mode="check") is expected

def test_check_mode_email_has_no_comparison_wording():
    item = AlertItem("price_drop", "TV", 89.0, "https://www.bestbuy.com/x", 100.0, 90.0, None)
    e = render_alert_email("a@example.com", [item], unsubscribe_url=U, checked_at=T, idempotency_key="k", mode="check")
    assert "at or below your target of $90.00" in e.text and "down from" not in e.text and "deal" not in e.text.lower()

def test_render_is_deterministic():
    args = ("a@example.com", [ITEM_A, ITEM_B])
    kw = dict(unsubscribe_url=U, checked_at=T, idempotency_key="k")
    assert render_alert_email(*args, **kw) == render_alert_email(*args, **kw)

def test_digest_subject_counts_items():
    assert render_alert_email("a@example.com", [ITEM_A, ITEM_B, ITEM_C], unsubscribe_url=U,
                              checked_at=T, idempotency_key="k").subject == "DealFinder: 3 price alerts"
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_alert_email.py -v`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** with `html.escape` and string templates. No template engine dependency.
- [ ] **Step 4: Run and see them pass.** Expected: 12 passed.
- [ ] **Step 5: Commit**

```bash
git add dealfinder/alert_email.py tests/test_alert_email.py
git commit -m "feat(alerts): drop rule on our own observed baseline; deterministic digest email"
```

---

### Task 5: `run_alerts`, the job

**Files:**
- Create: `dealfinder/alerts.py`
- Modify: `dealfinder/jobs.py` (register `alerts`)
- Test: `tests/test_alerts.py`, `tests/test_jobs.py`

**Interfaces:**
- Consumes: `db.job_scope`, `BestBuySource.lookup_skus(skus) -> dict[str, Product]`, `shop.shop_search`, `notify.Notifier`, `notify.notifier_from_env`, `alert_email.*`, `unsubscribe.unsubscribe_url`, Plan 3's job registry and `healthcheck.ping` wrapper.
- Produces:
  - `ALERT_DAILY_CAP = int(os.getenv("ALERT_DAILY_CAP", "90"))`
  - `run_alerts(now: datetime | None = None, notifier: Notifier | None = None, url: str | None = None, *, lookup: Callable[[list[str]], dict[str, Product]] | None = None, search: Callable[[str], dict] | None = None) -> dict`. The keyword-only injection points are additions to the contract's signature.
  - Report keys: `skus, repriced, missing, searches, emails_sent, deferred_users, retried, failed, dropped_batches`.
  - `python -m dealfinder.jobs alerts` runs it. The job exits 1, and Plan 3's wrapper pings `fail`, on an exception or when sends were attempted and none succeeded. Deferral alone is not a failure.
- Algorithm (the order matters, so it is fixed here):
  1. **Retry.** Batches with status `pending` older than 10 min and younger than 23 h are re-rendered from `payload` and resent with key `dealfinder-alerts/<batch_id>`. Pending batches older than 23 h become `failed`, plus a Sentry warning. Resend's dedup window is 24 h.
  2. **Re-price.** Collect distinct watched `offer_id`s whose source passes `licensing.may_store` (Best Buy only, since eBay rows are never stored or watched) and call `lookup` once with their SKUs. `lookup_skus` raises on any failure and never returns a partial result. On a raise, touch no row, re-raise, and let the job ping `fail`. The next run catches up. For each SKU found, update `dealfinder.offers` (`price`, `fetched_at = now`) and every watchlist row for it (`last_price`, `last_checked_at = now`, `title`, `url`). That refresh is what keeps watched rows inside the 72-hour rule. A SKU absent from a successful lookup is counted in `missing` and left alone. Plan 2's purge (`margin_s=13*3600`) removes watch rows unchecked for 59 h, so this daily run must refresh every watched row.
  3. **Candidates.** Price drops: rows where `should_alert(baseline_price, new_price, target_price, mode=shop.verdict_mode())`. Saved searches: call `search(q)` once per distinct query. A match is a result with `price <= max_price` when `max_price` is set, else a result with `verdict == "deal"`. At most 3 matches per saved search.
  4. **Filter.** Drop users with no profile or `alerts_enabled = false`. Drop items whose `dedupe_hash = sha256(f"{kind}|{item_key}|{price_cents}")` already exists for that user. `item_key` is the `offer_id`, or `<search_id>:<offer_id>` for saved searches.
  5. **Send.** The budget is `ALERT_DAILY_CAP` minus the batches sent since 00:00 UTC. Users are taken in `user_id` order until the budget is spent. The rest count as `deferred_users` and get no rows, so the next run derives them again. Per user, insert all item rows as `pending` with one `batch_id` and commit. Then render, send, and record the result:
     - `sent`: mark the rows sent, store `provider_id`, and set `baseline_price = price` on each alerted watch row.
     - `quota_exhausted`, `rate_limited`, `rejected`: delete the batch's rows (nothing was sent) and count `dropped_batches`. `quota_exhausted` also stops the run.
     - `error`: leave the rows pending for step 1 next run.
- A missed run needs no special case. Every run derives its work from current state.

- [ ] **Step 1: Write the failing DB tests.** Fixture `alert_world(db)`: profile `user-alice` / `a@example.com`, offer `bestbuy-6505727` at 249.99, a watch with `baseline_price` 249.99 and no target, cleaned up on teardown. `fake_lookup(prices)` returns `Product`s for those SKUs. `T0 = datetime(2026, 11, 2, 13, 30, tzinfo=UTC)`.

```python
def test_price_drop_emails_once(db, alert_world):
    n = ConsoleNotifier()
    r1 = alerts.run_alerts(now=T0, notifier=n, url=db, lookup=fake_lookup({"6505727": 229.99}), search=no_search)
    r2 = alerts.run_alerts(now=T0 + timedelta(hours=1), notifier=n, url=db,
                           lookup=fake_lookup({"6505727": 229.99}), search=no_search)
    assert (r1["emails_sent"], r2["emails_sent"], len(n.sent)) == (1, 0, 1)

def test_successful_run_refreshes_every_watched_row(db, alert_world):
    userstore.add_watch("user-bob", "public", "bestbuy-6505727", None, url=db)
    alerts.run_alerts(now=T0, notifier=ConsoleNotifier(), url=db, lookup=fake_lookup({"6505727": 249.99}), search=no_search)
    rows = all_watch_rows(db)   # via job_scope
    assert len(rows) == 2 and all(r["last_checked_at"] == T0 and r["last_price"] == 249.99 for r in rows)

def test_failed_lookup_leaves_rows_unchanged(db, alert_world):
    before = all_watch_rows(db)
    def boom(skus): raise RuntimeError("Best Buy 503")
    with pytest.raises(RuntimeError):
        alerts.run_alerts(now=T0, notifier=ConsoleNotifier(), url=db, lookup=boom, search=no_search)
    assert all_watch_rows(db) == before

def test_check_mode_drop_needs_a_target(db, alert_world, monkeypatch):
    monkeypatch.setenv("DEALFINDER_VERDICT_MODE", "check")
    n = ConsoleNotifier()
    alerts.run_alerts(now=T0, notifier=n, url=db, lookup=fake_lookup({"6505727": 199.99}), search=no_search)
    assert n.sent == []          # alert_world's watch has no target

def test_missed_run_catches_up(db, alert_world):
    n = ConsoleNotifier()
    alerts.run_alerts(now=T0 + timedelta(days=2), notifier=n, url=db,
                      lookup=fake_lookup({"6505727": 199.99}), search=no_search)
    assert len(n.sent) == 1 and "$199.99" in n.sent[0].subject

def test_unsubscribed_user_gets_no_email(db, alert_world):
    userstore.set_alerts_enabled("user-alice", False, url=db)
    n = ConsoleNotifier()
    alerts.run_alerts(now=T0, notifier=n, url=db, lookup=fake_lookup({"6505727": 199.99}), search=no_search)
    assert n.sent == []

def test_crash_between_insert_and_send_resends_once(db, alert_world):
    flaky = ScriptedNotifier(["error", "sent"])     # first send: unknown failure
    alerts.run_alerts(now=T0, notifier=flaky, url=db, lookup=fake_lookup({"6505727": 199.99}), search=no_search)
    r = alerts.run_alerts(now=T0 + timedelta(minutes=15), notifier=flaky, url=db,
                          lookup=fake_lookup({"6505727": 199.99}), search=no_search)
    assert r["retried"] == 1 and r["emails_sent"] == 1
    assert flaky.keys[0] == flaky.keys[1]           # same Idempotency-Key both times
    assert flaky.payloads[0] == flaky.payloads[1]   # same body, so Resend dedups

def test_quota_exhausted_drops_batch_for_rederive(db, alert_world):
    r = alerts.run_alerts(now=T0, notifier=ScriptedNotifier(["quota_exhausted"]), url=db,
                          lookup=fake_lookup({"6505727": 199.99}), search=no_search)
    assert r["dropped_batches"] == 1 and alert_rows(db, "user-alice") == []

def test_daily_cap_defers_not_drops(db, many_users, monkeypatch):   # 95 users, each with a due drop
    monkeypatch.setattr(alerts, "ALERT_DAILY_CAP", 90)
    n = ConsoleNotifier()
    r1 = alerts.run_alerts(now=T0, notifier=n, url=db, lookup=many_users.lookup, search=no_search)
    r2 = alerts.run_alerts(now=T0 + timedelta(days=1), notifier=n, url=db, lookup=many_users.lookup, search=no_search)
    assert (r1["emails_sent"], r1["deferred_users"], r2["emails_sent"]) == (90, 5, 5)

def test_one_email_per_user_per_run(db, alert_world, saved_search_world):
    n = ConsoleNotifier()
    alerts.run_alerts(now=T0, notifier=n, url=db, lookup=fake_lookup({"6505727": 199.99}),
                      search=fake_search([{"id": "bestbuy-111", "price": 89.0, "verdict": "deal", "title": "Speaker"}]))
    assert len(n.sent) == 1 and n.sent[0].subject == "DealFinder: 2 price alerts"

def test_saved_search_without_max_price_needs_a_deal_verdict(db, saved_search_world):
    n = ConsoleNotifier()
    alerts.run_alerts(now=T0, notifier=n, url=db, lookup=fake_lookup({}),
                      search=fake_search([{"id": "bestbuy-111", "price": 89.0, "verdict": "fair", "title": "Speaker"}]))
    assert n.sent == []

# tests/test_jobs.py (offline)
def test_alerts_job_is_registered(monkeypatch):
    monkeypatch.setattr(alerts, "run_alerts", lambda **k: {"emails_sent": 0})
    assert jobs.main(["alerts"]) == 0

def test_alerts_job_fails_when_lookup_raises(monkeypatch):
    pings = []
    monkeypatch.setattr(healthcheck, "ping", lambda check, status="ok": pings.append((check, status)))
    monkeypatch.setattr(alerts, "run_alerts", lambda **k: (_ for _ in ()).throw(RuntimeError("Best Buy 503")))
    assert jobs.main(["alerts"]) == 1 and pings[-1] == ("alerts", "fail")
```

`ScriptedNotifier` is a test helper that returns the scripted statuses in order and records `keys` and `payloads`.

- [ ] **Step 2: Run and see them fail.** Run: `DATABASE_URL=... ./.venv/bin/python -m pytest tests/test_alerts.py tests/test_jobs.py -k "alert" -v`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement `alerts.py`** per the algorithm above, and register `alerts` in Plan 3's job registry. Sent-today counting uses `sent_at >= date_trunc('day', now)` in UTC.
- [ ] **Step 4: Run and see them pass.** Same command, then the full suite in both modes. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add dealfinder/alerts.py dealfinder/jobs.py tests/test_alerts.py tests/test_jobs.py
git commit -m "feat(alerts): daily re-price + digest emails, idempotent, capped, catches up after a missed run"
```

---

### Task 6: Alert history retention

**Files:**
- Modify: `dealfinder/retention.py` (Plan 2)
- Test: `tests/test_retention.py`

**Interfaces:**
- Produces: `purge_expired` also nulls `alert_log.payload` (Best Buy content) older than the same cutoff Plan 2 uses for offers, `72 h - margin_s`, and deletes `alert_log` rows older than 90 days. Its report gains the keys `alert_payloads` and `alert_log`.

- [ ] **Step 1: Write the failing test**

```python
def test_alert_payloads_expire_but_dedupe_survives(db, alert_world):
    alerts.run_alerts(now=T0, notifier=ConsoleNotifier(), url=db, lookup=fake_lookup({"6505727": 199.99}), search=no_search)
    report = retention.purge_expired(now=T0 + timedelta(hours=73), url=db)
    row = alert_rows(db, "user-alice")[0]
    assert report["alert_payloads"] == 1 and row["payload"] is None and row["dedupe_hash"]
    assert retention.purge_expired(now=T0 + timedelta(days=91), url=db)["alert_log"] == 1
```

- [ ] **Step 2: Run and see it fail.** Run: `DATABASE_URL=... ./.venv/bin/python -m pytest tests/test_retention.py -k alert -v`. Expected: FAIL, `KeyError: 'alert_payloads'`.
- [ ] **Step 3: Implement** both statements inside `purge_expired`'s existing `job_scope` transaction.
- [ ] **Step 4: Run and see it pass.** Expected: pass, and the rest of `test_retention.py` still passes.
- [ ] **Step 5: Commit**

```bash
git add dealfinder/retention.py tests/test_retention.py
git commit -m "feat(retention): alert payloads follow the 72-hour rule; history kept 90 days"
```

---

### Task 7: Error tracking and cost-aware request logs

**Files:**
- Create: `dealfinder/observability.py`, `frontend/src/lib/sentry.ts`
- Modify: `dealfinder/serve.py` (call `init_sentry()`, add the middleware), `dealfinder/llm.py` (report usage), `pyproject.toml` (`sentry-sdk[fastapi]>=2.72`), `frontend/package.json` (`@sentry/react` exact `11.7.0`), `frontend/src/main.tsx`
- Test: `tests/test_observability.py`, `frontend/e2e/sentry.spec.ts`

**Interfaces:**
- Produces:
  - `init_sentry() -> None`. No-op without `SENTRY_DSN`. Otherwise `send_default_pii=False`, `traces_sample_rate=0.05`, `environment=DEALFINDER_ENV`, `before_send=scrub_event`, `before_breadcrumb=scrub_breadcrumb`.
  - `scrub_event(event: dict, hint: dict) -> dict`. It removes `request.query_string`, `request.cookies`, `request.data`, the `Authorization` and `Cookie` headers, cuts `?…` off `request.url` and every breadcrumb `data.url`, and drops `extra` keys named `q` or `query`.
  - `cost_scope() -> ContextManager[Cost]`, plus `add_llm_usage(provider: str, model: str, usage: dict | None) -> None` and `add_source_call(source: str) -> None`. `Cost` holds `usd, llm_calls, tokens_in, tokens_out, neurons, source_calls: dict[str, int], cost_basis`.
  - Workers AI tokens come from the response's `usage`. Neurons are those tokens times Cloudflare's published per-model rate, pinned as `WORKERS_AI_NEURONS_PER_M = {"@cf/meta/llama-3.1-8b-instruct-fp8-fast": (4119, 34868)}` with the pricing URL beside it. `usd = 0.0` with `cost_basis = "workers-ai-free"`. When `usage` is absent, tokens and neurons stay `null`. Nothing is estimated. OpenRouter (dev only) takes `usage.cost` from its response. `ops.PRICES` is never used for request cost.
  - `RequestLogMiddleware`: one JSON line per request on stdout with exactly `LOG_FIELDS = {"severity", "message", "route", "method", "status", "latency_ms", "cache", "cost", "revision"}`. `route` is the route template (`/search`, `/watchlist/{offer_id}`), never the raw URL. `revision` is env `K_REVISION`. No query string, no user id, and no client IP: `CF-Connecting-IP` is read by the limiter and never written anywhere. The handler looks up `sys.stdout` at emit time, so Cloud Run and `capsys` both see the lines.
  - `CallRateGuard.add(key: str, n: int = 1) -> None`. Per-instance daily counts against `DAILY_CAPS = {"BestBuy": 50_000, "workers-ai-neurons": 10_000, "resend": 100}`, each divided by env `DEALFINDER_MAX_INSTANCES` (default 2). Crossing 80% sends one `sentry_sdk.capture_message(f"call-rate: {key} at 80% of its daily cap", level="warning")` per key per UTC day. Sentry emails the owner on a new issue.
  - Front end: `initSentry()` reads build-time `VITE_SENTRY_DSN`, sets `sendDefaultPii: false`, and its `beforeSend` / `beforeBreadcrumb` strip query strings. A missing DSN means no Sentry.

- [ ] **Step 1: Write the failing tests**

```python
def test_request_log_has_no_query_text(capsys, stub_sources):
    client.get("/search", params={"q": "secret headphones 123"})
    lines = [json.loads(l) for l in capsys.readouterr().out.splitlines() if l.startswith("{")]
    rec = next(r for r in lines if r["message"] == "request")
    assert "secret" not in json.dumps(lines) and rec["route"] == "/search" and set(rec) == LOG_FIELDS

def test_request_log_has_no_client_ip(capsys, stub_sources):
    client.get("/search", params={"q": "tv"}, headers={"CF-Connecting-IP": "198.51.100.7"})
    assert "198.51.100.7" not in capsys.readouterr().out

def test_request_log_carries_latency_and_cost(capsys, stub_sources):
    client.get("/search", params={"q": "tv"})
    rec = last_request_line(capsys)
    assert rec["latency_ms"] >= 0 and set(rec["cost"]) >= {"usd", "llm_calls", "neurons", "source_calls"}

def test_llm_usage_comes_from_the_response():
    with cost_scope() as c:
        add_llm_usage("workers-ai", "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
                      {"prompt_tokens": 812, "completion_tokens": 96})
    assert (c.tokens_in, c.tokens_out, c.usd, c.cost_basis) == (812, 96, 0.0, "workers-ai-free")
    assert c.neurons == pytest.approx(812 * 4119 / 1e6 + 96 * 34868 / 1e6)

def test_missing_usage_is_null_not_guessed():
    with cost_scope() as c:
        add_llm_usage("workers-ai", "@cf/meta/llama-3.1-8b-instruct-fp8-fast", None)
    assert c.tokens_in is None and c.neurons is None and c.llm_calls == 1

def test_sentry_scrubs_query_string():
    ev = {"request": {"url": "https://x/search?q=secret", "query_string": "q=secret",
                      "headers": {"Authorization": "Bearer t", "Cookie": "a=b"}},
          "breadcrumbs": {"values": [{"data": {"url": "/search?q=secret"}}]}, "extra": {"q": "secret"}}
    out = json.dumps(scrub_event(ev, {}))
    assert "secret" not in out and "Bearer" not in out and "a=b" not in out

def test_call_rate_warning_fires_once(monkeypatch):
    sent = []
    monkeypatch.setattr("sentry_sdk.capture_message", lambda m, **k: sent.append(m))
    g = CallRateGuard(max_instances=1)
    g.add("resend", 80); g.add("resend", 5)
    assert sent == ["call-rate: resend at 80% of its daily cap"]

def test_request_cost_never_reads_the_static_price_table():
    assert "PRICES" not in Path(observability.__file__).read_text()
```

```ts
// frontend/e2e/sentry.spec.ts — build env VITE_SENTRY_DSN=https://public@o0.ingest.us.sentry.io/0
test("a front-end error reaches Sentry without the search text", async ({ page }) => {
  const bodies: string[] = [];
  await page.route("**/api/0/envelope/**", (r) => { bodies.push(r.request().postData() ?? ""); r.fulfill({ status: 200 }); });
  await page.goto("/?q=secret-query");
  await page.evaluate(() => setTimeout(() => { throw new Error("boom"); }));
  await expect.poll(() => bodies.length).toBeGreaterThan(0);
  expect(bodies.join("")).not.toContain("secret-query");
});
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_observability.py -v` and `cd frontend && npx playwright test e2e/sentry.spec.ts`. Expected: FAIL, module missing, no envelope sent.
- [ ] **Step 3: Implement.** Use a pure ASGI middleware so streaming responses log once at completion. If Plan 3 or 4 set a CSP on the Worker, add `https://*.ingest.us.sentry.io` to `connect-src`.
- [ ] **Step 4: Run and see them pass.** Same commands. Expected: all pass, and the full offline suite passes.
- [ ] **Step 5: Commit**

```bash
git add dealfinder/observability.py dealfinder/serve.py dealfinder/llm.py pyproject.toml tests/test_observability.py frontend/package.json frontend/package-lock.json frontend/src/lib/sentry.ts frontend/src/main.tsx frontend/e2e/sentry.spec.ts
git commit -m "feat(obs): Sentry front and back with query scrubbing; JSON request logs with real per-request cost"
```

---

### Task 8: `/ask` on Workers AI, cached, labelled, capped

**Files:**
- Modify: `dealfinder/llm.py:33-64` (provider routing), `dealfinder/cache.py` (add `TTLCache`), `dealfinder/serve.py` (`/ask`)
- Test: `tests/test_llm.py`, `tests/test_serve.py`

**Interfaces:**
- Consumes: `settings.is_production()`, `observability.add_llm_usage`, Plan 3's rate limiter.
- Produces:
  - `llm.provider() -> str | None`: `"workers-ai"` when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` are set, else `"openrouter"` when `OPENROUTER_API_KEY` is set and not production, else `None`. `llm.available()` returns `provider() is not None`.
  - Workers AI call: `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{WORKERS_AI_MODEL}` with `{"messages": [...], "temperature": t}`. Default `WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast"`. The text is `result.response`. `usage` goes to `add_llm_usage`. A 404 or "model not found" sends `capture_message("workers-ai model missing: <id>", level="error")`. `llm.chat`'s signature does not change.
  - Why Workers AI: "Cloudflare does not use Customer Content processed by Workers AI to train AI models," and it keeps no inputs or outputs after the request (https://developers.cloudflare.com/workers-ai/platform/privacy/). Over the free allocation it errors instead of billing, and `rag.answer` already falls back to the deterministic answer on any LLM error.
  - `cache.TTLCache(maxsize: int = 512, ttl_s: float = 900, clock: Callable[[], float] = time.monotonic)` with `get(key) -> Any | None` and `put(key, value) -> None`.
  - `/ask` keys its cache on `sha256(normalized q + "|" + str(k))`, with `ASK_CACHE_TTL_S` defaulting to 900. Prices change, so answers expire.
  - `/ask` returns `ai_written: bool` (equal to `used_llm`) and `provider`. The lab shows "AI-written" on any answer with `ai_written: true`.
  - A per-instance daily cap, env `ASK_LLM_DAILY_MAX` (default 300), sends further asks down the deterministic path. That leaves headroom in the shared 10,000-neuron allocation.

- [ ] **Step 1: Write the failing tests**

```python
MODEL_URL = "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/meta/llama-3.1-8b-instruct-fp8-fast"

@respx.mock
def test_workers_ai_chat_calls_the_pinned_model(cf_env):
    route = respx.post(MODEL_URL).mock(return_value=httpx.Response(200, json={
        "success": True, "result": {"response": "Best value: X at $10.00", "usage": {"prompt_tokens": 9, "completion_tokens": 7}}}))
    assert llm.chat([{"role": "user", "content": "hi"}]).startswith("Best value")
    assert route.calls[0].request.headers["Authorization"] == "Bearer cf_ai"

def test_openrouter_refused_in_production(monkeypatch):
    monkeypatch.setenv("DEALFINDER_ENV", "production")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or")
    monkeypatch.delenv("CLOUDFLARE_AI_TOKEN", raising=False)
    assert llm.available() is False

def test_ask_answers_are_cached_with_ttl(monkeypatch):
    clock = FakeClock(); calls = []
    monkeypatch.setattr(serve, "_ASK_CACHE", TTLCache(ttl_s=900, clock=clock))
    monkeypatch.setattr("dealfinder.rag.answer", lambda q, k=5: calls.append(q) or FAKE_ANSWER)
    client.get("/ask", params={"q": "tv"}); client.get("/ask", params={"q": "  TV "})
    clock.advance(901); client.get("/ask", params={"q": "tv"})
    assert len(calls) == 2

def test_ask_cache_keys_hold_no_query_text(monkeypatch):
    client.get("/ask", params={"q": "secret tv"})
    assert not any("secret" in str(k) for k in serve._ASK_CACHE.keys())

def test_ask_marks_ai_written(monkeypatch):
    monkeypatch.setattr("dealfinder.rag.answer", lambda q, k=5: FAKE_LLM_ANSWER)
    assert client.get("/ask", params={"q": "tv"}).json()["ai_written"] is True

def test_ask_has_the_strictest_limit(stub_sources, monkeypatch):
    monkeypatch.setattr("dealfinder.rag.answer", lambda q, k=5: FAKE_ANSWER)
    def allowed(path, ip):
        for n in range(1000):
            if client.get(path, params={"q": f"tv {n}"}, headers={"CF-Connecting-IP": ip}).status_code == 429:
                return n
        return 1000
    assert allowed("/ask", "198.51.100.1") < allowed("/search", "198.51.100.2")
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_llm.py tests/test_serve.py -k "workers_ai or openrouter or ask" -v`. Expected: FAIL.
- [ ] **Step 3: Probe the real response once** before trusting the shape. Run `python -m dealfinder.llm probe` (a `__main__` that sends one 5-token prompt and prints only the response's top-level keys and `result` keys). Expected: `result.response` exists. Record whether `result.usage` exists in the commit message. If it does not, `add_llm_usage` gets `None` and logs stay honest.
- [ ] **Step 4: Implement** the routing, `TTLCache`, and the `/ask` changes. Plan 3's limiter must cover `/ask_agentic` and `/review` under the `/ask` limit. Add them if it does not.
- [ ] **Step 5: Run and see them pass.** Same command, then the full suite. Expected: all pass.
- [ ] **Step 6: Commit**

```bash
git add dealfinder/llm.py dealfinder/cache.py dealfinder/serve.py tests/test_llm.py tests/test_serve.py
git commit -m "feat(ask): Workers AI (no training on prompts), 15-min TTL cache, AI-written label, daily cap"
```

---

### Task 9: Account export and delete; essential cookies on the live origin

**Files:**
- Modify: `dealfinder/userstore.py`, `dealfinder/serve.py` (`GET /account/export`, `DELETE /account`), `frontend/src/pages/WatchlistPage.tsx` (Plan 4: the two account controls go under the watchlist), `frontend/src/api.ts` (Plan 4: add `exportAccount()` and `deleteAccount()`), `frontend/e2e/fixtures.ts` (Plan 4: `stubApi` gains a `deleteAccount` override for `DELETE /api/account`), `frontend/e2e/account.spec.ts` (Plan 4 created it: add the test below)
- Create: `scripts/cookie_audit.py`
- Test: `tests/test_account.py`

**Interfaces:**
- `userstore.export_user(user_id: str, url: str | None = None) -> dict` returns `{"exported_at", "profile", "watchlist", "saved_searches", "alerts"}` from the real tables in one `db.scoped` transaction.
- `userstore.delete_user(user_id: str, url: str | None = None) -> dict[str, int]` deletes the user's rows in `watchlist`, `saved_searches`, `alert_log` and `profiles`, returns per-table counts, and logs `{"event": "account_delete", "user": sha256(user_id)[:12], "counts": {...}}`. It never touches `auth.users`.
- `GET /account/export` (`require_account`) returns that JSON with `Content-Disposition: attachment; filename="dealfinder-export.json"`. `DELETE /account` returns `{"deleted": {...}, "sign_in_account": "kept"}`.
- UI: "Download my data" and "Delete my DealFinder data". Delete asks for confirmation, then shows exactly "Your DealFinder data is deleted. Your sign-in account is shared with cloudcodetree.com and was not deleted." and signs out locally.
- Plan 4 already tests that the front end sets no cookies, and supabase-js keeps the session in localStorage. This task covers the rest: backend responses here, and the deployed origin through the Worker in `scripts/cookie_audit.py <origin>`. The script GETs `/`, `/how-we-rank`, `/privacy`, `/sitemap.xml`, one `/deal/<slug>` from the sitemap, a missing `/deal/x`, `/api/search?q=tv`, `/api/config.json` and `/lab`. It prints every `Set-Cookie` name and exits 1 on any name outside `ESSENTIAL_COOKIES = {"__cf_bm", "cf_clearance"}`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_account.py (DB). account_world: alice and bob each have a profile, watch, saved search, alert row.
def test_export_returns_every_table(db, account_world):
    out = userstore.export_user("user-alice", url=db)
    assert set(out) == {"exported_at", "profile", "watchlist", "saved_searches", "alerts"}
    assert out["profile"]["email"] == "a@example.com" and len(out["watchlist"]) == 1

def test_delete_account_removes_only_own_rows(db, account_world):
    assert userstore.delete_user("user-alice", url=db) == {"watchlist": 1, "saved_searches": 1, "alert_log": 1, "profiles": 1}
    assert userstore.export_user("user-alice", url=db)["profile"] is None
    assert len(userstore.export_user("user-bob", url=db)["watchlist"]) == 1

# offline
def test_account_routes_need_a_token():
    assert client.get("/account/export").status_code == 401 and client.delete("/account").status_code == 401

def test_export_is_a_download(mint, monkeypatch):
    monkeypatch.setattr(userstore, "export_user", lambda uid, **k: {"profile": None})
    r = client.get("/account/export", headers=bearer(mint("u-1")))
    assert r.headers["content-disposition"] == 'attachment; filename="dealfinder-export.json"'

def test_delete_says_the_sign_in_account_is_kept(mint, monkeypatch):
    monkeypatch.setattr(userstore, "delete_user", lambda uid, **k: {"profiles": 1})
    assert client.delete("/account", headers=bearer(mint("u-1"))).json()["sign_in_account"] == "kept"

@pytest.mark.parametrize("path", ["/healthz", "/readyz", "/config.json", "/search?q=tv", "/lab", "/unsubscribe?t=x"])
def test_no_backend_route_sets_cookies(path, stub_sources):
    assert "set-cookie" not in client.get(path).headers

@respx.mock
def test_cookie_audit_fails_on_a_tracking_cookie():
    respx.get(url__regex=r"https://deals\.example/.*").mock(return_value=httpx.Response(200, headers={"Set-Cookie": "_ga=1"}))
    assert cookie_audit.main(["https://deals.example"]) == 1
```

```ts
// frontend/e2e/account.spec.ts (mocked DELETE /api/account)
test("delete asks first, then says the sign-in account was kept", async ({ page }) => {
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "t" });
  await stubApi(page, { watchlist: { count: 0, items: [] }, deleteAccount: { deleted: {}, sign_in_account: "kept" } });
  await page.goto("/watchlist");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete my DealFinder data" }).click();
  await expect(page.getByText("Your sign-in account is shared with cloudcodetree.com and was not deleted.")).toBeVisible();
});
```

- [ ] **Step 2: Run and see them fail.** Run: `DATABASE_URL=... ./.venv/bin/python -m pytest tests/test_account.py -v` and `cd frontend && npx playwright test e2e/account.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the store functions, the routes, the two UI controls and the audit script. The audit's request list skips `/sitemap.xml`'s deal link when the sitemap is empty and says so.
- [ ] **Step 4: Run and see them pass.** Same commands. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add dealfinder/userstore.py dealfinder/serve.py scripts/cookie_audit.py tests/test_account.py frontend/e2e/account.spec.ts frontend/e2e/fixtures.ts frontend/src/pages/WatchlistPage.tsx frontend/src/api.ts
git commit -m "feat(privacy): real export and delete; the shared sign-in account is kept and the UI says so"
```

---

### Task 10: Uptime probe and the Healthchecks checks

**Files:**
- Create: `edge/src/uptime.ts`, `edge/src/uptime.test.ts`, `scripts/healthchecks_setup.py`
- Modify: `edge/src/index.ts` (`scheduled()`), `edge/wrangler.jsonc` (`"triggers": {"crons": ["*/10 * * * *"]}`, secret `HEALTHCHECK_UPTIME_URL`)
- Test: `tests/test_healthchecks_setup.py`

**Interfaces:**
- Consumes: the Worker's `ASSETS`, `PAGES` and `BACKEND_ORIGIN` bindings and `EDGE_SHARED_SECRET` (Plan 3).
- Produces:
  - `runUptime(env: Env, now: Date): Promise<{ok: boolean, failed: string[]}>` runs three probes:
    - `assets`: `env.ASSETS.fetch("https://deals.cloudcodetree.com/")` is 200 and contains `id="root"`.
    - `pages`: `env.PAGES.head("sitemap.xml")` exists and was uploaded under 26 h ago. The pages job runs every 12 h.
    - `api`: `GET {BACKEND_ORIGIN}/readyz` with the edge header answers 200 within 15 s, which allows a cold start.
  - It pings `HEALTHCHECK_UPTIME_URL` on success, or `<url>/fail` with body `failed: <names>`. It does nothing without the secret.
  - `scripts/healthchecks_setup.py [--dry-run]` reads `HEALTHCHECKS_API_KEY` from `.env` and POSTs `https://healthchecks.io/api/v3/checks/` with `unique: ["name"]`, so it is idempotent. It creates these checks, all with `channels: "*"`, which includes the account's email channel:

    | Check | Timeout | Grace |
    |---|---|---|
    | `dealfinder-pages` | 12 h | 2 h |
    | `dealfinder-alerts` | 24 h | 3 h |
    | `dealfinder-uptime` | 10 min | 20 min |

    It prints the ping URLs only to a file in the scratchpad, never to stdout. Ping URL forms are from https://healthchecks.io/docs/: base URL for success, `/start`, `/fail`.

- [ ] **Step 1: Write the failing tests**

```ts
it("pings ok when all three probes pass", async () => { expect(await runUptime(okEnv, NOW)).toEqual({ ok: true, failed: [] }); expect(pings).toEqual([HC]); });
it("pings /fail naming the backend when /readyz is down", async () => { expect((await runUptime(apiDownEnv, NOW)).failed).toEqual(["api"]); expect(pings).toEqual([HC + "/fail"]); });
it("treats a sitemap older than 26 h as a failure", async () => { expect((await runUptime(staleEnv, NOW)).failed).toEqual(["pages"]); });
it("does nothing without HEALTHCHECK_UPTIME_URL", async () => { await runUptime(noSecretEnv, NOW); expect(pings).toEqual([]); });
```

```python
@respx.mock
def test_setup_creates_three_checks_idempotently(tmp_path):
    route = respx.post("https://healthchecks.io/api/v3/checks/").mock(
        side_effect=lambda req: httpx.Response(201, json={"ping_url": "https://hc-ping.com/" + json.loads(req.content)["name"]}))
    healthchecks_setup.run(api_key="k", out=tmp_path / "pings.json")
    names = [json.loads(c.request.content)["name"] for c in route.calls]
    assert names == ["dealfinder-pages", "dealfinder-alerts", "dealfinder-uptime"]
    assert all(json.loads(c.request.content)["unique"] == ["name"] for c in route.calls)
```

- [ ] **Step 2: Run and see them fail.** Run: `cd edge && npx vitest run src/uptime.test.ts` and `./.venv/bin/python -m pytest tests/test_healthchecks_setup.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the commit message, record whether a `scheduled()` subrequest to `https://deals.cloudcodetree.com/` reaches this Worker. If it does, add a fourth probe on the public URL.
- [ ] **Step 4: Run and see them pass.** Expected: 4 + 1 passed.
- [ ] **Step 5: Commit**

```bash
git add edge/src/uptime.ts edge/src/uptime.test.ts edge/src/index.ts edge/wrangler.jsonc scripts/healthchecks_setup.py tests/test_healthchecks_setup.py
git commit -m "feat(obs): 10-minute uptime probe on the edge + idempotent Healthchecks setup"
```

---

### Task 11: Resend domain, secrets runbook, workflow audit, cost rows, log exclusion

**Files:**
- Create: `scripts/resend_domain.py`, `scripts/sentry_setup.py`, `tests/test_workflows.py`, `tests/test_runbook.py`
- Modify: `RUNBOOK.md` (new "Secrets" section), `COST.md`, `pyproject.toml` (dev extra `pyyaml>=6`), the GCP OpenTofu config from Plan 3 (find with `grep -rl google_cloud_run_v2_service --include=*.tf .`)
- Site repo, branch `feat/deals-resend-dns`: Create `infra/resend.tf`

**Interfaces:**
- Produces:
  - `scripts/resend_domain.py create|verify|status`. It reads `RESEND_API_KEY` from `.env`. `create` calls `POST https://api.resend.com/domains` for `deals.cloudcodetree.com` and writes the returned records as `cloudflare_dns_record` resources to `<site>/infra/resend.tf`, with the zone reference used in `infra/dns.tf`. `verify` calls `POST /domains/{id}/verify`. It never prints the key.
  - `scripts/sentry_setup.py` creates projects `dealfinder-api` (platform `python-fastapi`) and `dealfinder-web` (platform `javascript-react`), and confirms each has an issue alert rule that emails the owner. It writes the DSNs to the scratchpad.
  - RUNBOOK "Secrets": one row per key in the contract's `dealfinder-env` list plus `CLOUDFLARE_AI_TOKEN` and the Worker secrets. Columns: key, store, scope, spend cap, how to rotate, how to verify. Rotation means running `python deploy/secrets.py` with the new value (it writes a new `dealfinder-env` version and keeps one active), deploying a new revision of the service and both jobs, then checking `/readyz` and one job run.
  - Spend caps, written down: Resend Free fails past 100 a day. Workers AI Free fails past 10,000 neurons. Sentry Free drops past 5k. Best Buy and eBay have no billing. OpenRouter has no production key. GCP has the $1 budget alert (Plan 3). The call-rate alert is Task 7's `CallRateGuard`.
  - `COST.md` rows for Resend, Sentry, Healthchecks.io, Workers AI and the uptime cron, each with its free limit and its teardown step.
  - OpenTofu: a `google_logging_project_exclusion` for `resource.type="cloud_run_revision" AND log_name:"run.googleapis.com%2Frequests"`. Cloud Run's automatic request log records the full URL, query included. Exclusions are free.

- [ ] **Step 1: Write the failing tests**

```python
def test_no_event_expressions_in_run_steps():
    bad = []
    for wf in Path(".github/workflows").glob("*.yml"):
        for job in (yaml.safe_load(wf.read_text()).get("jobs") or {}).values():
            for step in job.get("steps", []):
                if re.search(r"\$\{\{\s*(github\.event\.|github\.head_ref|inputs\.)", step.get("run", "")):
                    bad.append(f"{wf.name}: {step.get('name') or step['run'][:40]}")
    assert bad == []

def test_no_cron_on_github_actions():
    for wf in Path(".github/workflows").glob("*.yml"):
        assert "schedule" not in (yaml.safe_load(wf.read_text()).get(True) or {}), wf.name   # PyYAML parses `on:` as True

CONTRACT_SECRETS = ["DATABASE_URL", "BESTBUY_API_KEY", "EBAY_APP_ID", "EBAY_CERT_ID", "EDGE_SHARED_SECRET",
    "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_R2_TOKEN", "CLOUDFLARE_AI_TOKEN", "RESEND_API_KEY", "UNSUBSCRIBE_SECRET",
    "SENTRY_DSN", "HEALTHCHECK_PAGES_URL", "HEALTHCHECK_ALERTS_URL", "HEALTHCHECK_UPTIME_URL"]

def test_every_secret_has_a_rotation_row():
    section = Path("RUNBOOK.md").read_text().split("## Secrets", 1)[1]
    assert [k for k in CONTRACT_SECRETS if f"| `{k}` |" not in section] == []

def test_cloud_run_request_logs_are_excluded():
    tf = "".join(p.read_text() for p in Path(".").rglob("*.tf"))
    assert "google_logging_project_exclusion" in tf and "run.googleapis.com%2Frequests" in tf
```

- [ ] **Step 2: Run and see them fail.** Run: `./.venv/bin/python -m pytest tests/test_workflows.py tests/test_runbook.py -v`. Expected: the runbook and exclusion tests FAIL. Fix any workflow the audit flags by moving the expression into `env:`.
- [ ] **Step 3: Implement** the scripts, the RUNBOOK section, the COST rows and the exclusion resource.
- [ ] **Step 4: Run and see them pass.** Run the Step 2 command, then `cd deploy && tofu validate` in Plan 3's config directory. Expected: pass, valid.
- [ ] **Step 5: Preview the DNS change (read-only).** After the owner's Resend key exists, run `python scripts/resend_domain.py create`, then in the site repo `node scripts/tofu.mjs plan`. Expected: only the Resend records as additions. Ask: "reply 'you do it' to apply the Resend DNS records for deals.cloudcodetree.com". Apply and run `verify` only after that reply.
- [ ] **Step 6: Commit both repos**

```bash
git add scripts/resend_domain.py scripts/sentry_setup.py tests/test_workflows.py tests/test_runbook.py RUNBOOK.md COST.md pyproject.toml deploy
git commit -m "docs(ops): secrets runbook, spend caps, workflow env audit, free-tier rows; drop Cloud Run URL logs"
# site repo
git add infra/resend.tf && git commit -m "infra(dns): Resend sending records for deals.cloudcodetree.com"
```

---

### Task 12: The final privacy policy, and the honesty notes

**Files:**
- Modify: `frontend/src/content/privacy.md` (Plan 4's draft, rendered by `frontend/src/pages/ContentPage.tsx` with `marked`). Replace the whole file and remove the "Draft: final policy lands before launch" heading. No new routes.
- Modify only if a heading below is missing: `frontend/src/content/how-we-rank.md`. Plan 4's text is final.
- Create: `frontend/e2e/legal.spec.ts`
- Test: `tests/test_pages.py`

**Interfaces:**
- `privacy.md` H2 headings, in this order. Together they cover each CalOPPA element of Cal. Bus. & Prof. Code §22575(b) (https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-22575/): categories of data and of third parties, the review-and-change process, change notice, effective date, Do Not Track, and other parties' tracking.
  1. "Effective date"
  2. "What we collect": email and sign-in identity, watchlist, saved searches and alert history. Search text is never stored or logged. Your IP address is used in memory to rate-limit requests and is never logged by DealFinder.
  3. "Who processes it": Supabase (database, and the sign-in shared with cloudcodetree.com), Google Cloud (hosting), Cloudflare (edge, deal pages, and Workers AI for the lab's Ask mode, which does not train on prompts), Resend (email), Sentry (scrubbed error reports).
  4. "Reviewing and changing your data": export, delete, unsubscribe, re-enable alerts.
  5. "Deleting your sign-in account": shared with cloudcodetree.com, not removed by deleting DealFinder data, handled through the contact address.
  6. "Do Not Track": no cross-site tracking, so the browser setting changes nothing.
  7. "Tracking by other parties": none, no ads, no analytics.
  8. "Cookies and storage": DealFinder sets no cookies. Cloudflare may set `__cf_bm` or `cf_clearance` for security. The session lives in local storage.
  9. "How long we keep it": Best Buy data at most 72 h, alert history 90 days, account data until you delete it.
  10. "Children": not directed to children under 13.
  11. "Changes to this policy": a new effective date at the top of this page.
  12. "Contact"
- `how-we-rank.md` must contain, under any heading Plan 4 chose, "no paid placement", "eBay", the seller's "was" price never used as a reference, `Prices change, so check the store before you buy.`, and an "AI-written text" section. The shopper page has none, and the lab's Ask answers are labelled. Add only what is missing.
- The same stale-price sentence appears on the shopper results, every deal page and every email (Task 4).
- Plan 4's watchlist page shows `If Best Buy stops listing an item for about 2.5 days, we remove it from your watchlist.` under its heading. That page is `frontend/src/pages/WatchlistPage.tsx`.

- [ ] **Step 1: Write the failing tests**

```ts
const PRIVACY_HEADINGS = ["Effective date", "What we collect", "Who processes it", "Reviewing and changing your data",
  "Deleting your sign-in account", "Do Not Track", "Tracking by other parties", "Cookies and storage",
  "How long we keep it", "Children", "Changes to this policy", "Contact"];
test("privacy is final and covers every required section in order", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("Draft: final policy lands before launch")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(PRIVACY_HEADINGS);
});
test("how-we-rank carries the promises", async ({ page }) => {
  await page.goto("/how-we-rank");
  for (const t of ["no paid placement", "AI-written text", "Prices change, so check the store before you buy."])
    await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
});
test("the watchlist says when a watch is removed", async ({ page }) => {
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "t" });
  await stubApi(page, { watchlist: { count: 0, items: [] } });
  await page.goto("/watchlist");
  await expect(page.getByText("If Best Buy stops listing an item for about 2.5 days, we remove it from your watchlist.")).toBeVisible();
});
```

```python
def test_deal_page_carries_stale_note():
    html = pages.render_deal_page(SAMPLE_ITEM, built_at=T0)
    assert "Prices change, so check the store before you buy." in html and 'href="/privacy"' in html
```

- [ ] **Step 2: Run and see them fail.** Run: `cd frontend && npx playwright test e2e/legal.spec.ts` and `./.venv/bin/python -m pytest tests/test_pages.py -k stale -v`. Expected: FAIL on the Draft heading and any missing note.
- [ ] **Step 3: Write the content** in plain words and short sentences. The contact line comes from the owner's answer to open question 1. Add the note to `pages.py`'s template if it lacks it.
- [ ] **Step 4: Run and see them pass.** Expected: pass, with Plan 4's axe spec still clean on both pages.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/content/privacy.md frontend/src/content/how-we-rank.md frontend/src/pages/WatchlistPage.tsx frontend/e2e/legal.spec.ts dealfinder/pages.py dealfinder/templates tests/test_pages.py
git commit -m "docs(legal): final CalOPPA privacy policy; stale-price and AI-text notes everywhere"
```

---

### Task 13: The launch gate, rewritten with proofs

**Files:**
- Modify: `ROADMAP.md:50-59` (the gate), `ROADMAP.md:76-83` (P1 progress), the P3 heading
- Create: `tests/test_launch_gate.py`

**Interfaces:**
- The gate becomes these six boxes. Wording follows spec G5: affiliate compliance is removed, and the three reworded items are quoted from G5. Each box ends with `Proof:` and one or more `tests/<file>.py::<test>` ids and, where needed, `live: <command>`.

```markdown
## The launch gate (must be TRUE before any public launch)

A box is checked only when every proof it names passes on `main`.

- [ ] Cost-per-query measured and bounded (no LLM on the default path; caching in front). Proof: …
- [ ] Abuse/bot rate-limiting on anonymous endpoints. Proof: … live: 31st `/api/search` in 10 s answers 429
- [ ] Heavy work in scheduled jobs, capped horizontal scaling, no queue at launch. Proof: … live: `gcloud run services describe dealfinder-api --format='value(spec.template.metadata.annotations)'` shows maxScale
- [ ] Observability: per-request latency + cost + error tracking, alerting. Proof: tests/test_observability.py::test_request_log_carries_latency_and_cost … live: Task 14 alert drills
- [ ] Privacy: data-subject export and delete over the real tables; cookie consent required only if a non-essential cookie is ever added, none at launch; secrets in a manager, not `.env`. Proof: tests/test_account.py::test_delete_account_removes_only_own_rows … live: `python scripts/cookie_audit.py https://deals.cloudcodetree.com`
- [ ] Every deployed component's ongoing cost is documented in COST.md with a teardown step; `scripts/cost_check.py` (extended for cloud) reports the live billable footprint. Proof: … live: `python scripts/cost_check.py --cloud`
```

  Fill each `…` with the real test ids from Plans 2-5. Find them with `grep -n "def test_" tests/test_ratelimit*.py tests/test_jobs.py tests/test_settings.py tests/test_cost*.py`.
- P1 progress: check "Real consumer auth", "Saved searches" and "Price-drop alert delivery", each with its proof. P3 Monetization gains "Deferred: revenue skipped (owner decision, 2026-10-25)."

- [ ] **Step 1: Write the failing test**

```python
GATE_ID = re.compile(r"(tests/[\w/]+\.py)::(\w+)")

def test_every_gate_proof_exists():
    gate = Path("ROADMAP.md").read_text().split("## The launch gate", 1)[1].split("\n---", 1)[0]
    ids = GATE_ID.findall(gate)
    assert len(ids) >= 6
    missing = [f"{f}::{t}" for f, t in ids if f"def {t}(" not in Path(f).read_text()]
    assert missing == []

def test_gate_matches_g5():
    gate = Path("ROADMAP.md").read_text().split("## The launch gate", 1)[1].split("\n---", 1)[0]
    assert "Affiliate" not in gate and "no queue at launch" in gate
    assert "required only if a non-essential cookie is ever added" in gate
    assert gate.count("- [") == 6 and all("Proof:" in l for l in gate.splitlines() if l.startswith("- ["))
```

- [ ] **Step 2: Run and see it fail.** Run: `./.venv/bin/python -m pytest tests/test_launch_gate.py -v`. Expected: FAIL, no proofs yet.
- [ ] **Step 3: Rewrite** the gate and the P1 and P3 sections. Leave every gate box unchecked. Plan 8 checks them after the live proofs pass.
- [ ] **Step 4: Run and see it pass.** Expected: 2 passed.
- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md tests/test_launch_gate.py
git commit -m "docs(roadmap): launch gate rewritten per G5; every box names a proof that CI checks exists"
```

---

### Task 14: Live drills (owner-gated), then the PR

Each drill proves an alert reaches the owner's inbox. Run them after the owner setup and Plan 3's deploy. Every production write waits for "you do it".

- [ ] **Step 1: Secrets.** Add `RESEND_API_KEY`, a fresh 32-byte `UNSUBSCRIBE_SECRET`, `SENTRY_DSN`, `CLOUDFLARE_AI_TOKEN`, `HEALTHCHECK_PAGES_URL` and `HEALTHCHECK_ALERTS_URL` to `dealfinder-env` with `python deploy/secrets.py`. Then `wrangler secret put HEALTHCHECK_UPTIME_URL` for `dealfinder-edge`. Rebuild the front end with `VITE_SENTRY_DSN` (the browser DSN is public and stays out of `/config.json`).
- [ ] **Step 2: Email drill.** Sign in on `https://deals.cloudcodetree.com`, watch one Best Buy item with a target above its price, and run `gcloud run jobs execute dealfinder-alerts --wait`. Expected: one email with the attribution, the stale note and a one-click unsubscribe that Gmail shows beside the sender. A second run sends nothing. Screenshot both with chrome-devtools.
- [ ] **Step 3: Unpause the schedule.** Plan 3 created `dealfinder-alerts` paused. After Step 2 passes, ask "reply 'you do it' to resume the daily alerts schedule", then run `gcloud scheduler jobs resume dealfinder-alerts --location <Plan 3's region>`. Expected: `state: ENABLED` in `gcloud scheduler jobs describe`.
- [ ] **Step 4: Sentry drill.** Run a one-off job execution that calls `sentry_sdk.capture_message("drill")`. Expected: an issue email within 5 min, with no query string in the event.
- [ ] **Step 5: Dead-man drill.** Ping `HEALTHCHECK_PAGES_URL` + `/fail` by hand. Expected: a "down" email. Ping success to clear it.
- [ ] **Step 6: Uptime drill.** Deploy a Worker preview with `BACKEND_ORIGIN` pointed at a dead host for 20 min. Expected: "dealfinder-uptime is down" naming `api`. Restore it.
- [ ] **Step 7: Privacy drill.** Run `python scripts/cookie_audit.py https://deals.cloudcodetree.com`. Expected: exit 0. Then export and delete from the UI. Expected: the export holds the drill rows, `GET /api/watchlist` is empty afterwards, and cloudcodetree.com sign-in still works.
- [ ] **Step 8: Open the PRs**

```bash
git push -u origin feat/launch-p5-ops && gh pr create --fill
# site repo
git push -u origin feat/deals-resend-dns && gh pr create --fill
```

Merging either PR needs the owner's explicit go.

## Open questions for the owner

1. Which contact address does the privacy page list? The recommendation is a `privacy@cloudcodetree.com` alias in Google Workspace, so no personal address is published.
2. CAN-SPAM asks commercial email for a postal address. These alerts are user-requested price notices, which may count as transactional, but that is not settled here. The recommendation is to add a mailing address (a PO box works) to the footer, or to confirm they are transactional.
