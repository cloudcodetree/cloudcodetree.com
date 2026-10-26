# DealFinder Plan 4: Shopper Front End and the Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `deals.cloudcodetree.com` a public React shopper page on the Nocturne look, and fold both course UIs into one lab at `/lab`.

**Architecture:** The React + Vite app in `frontend/` becomes the shopper front end. It builds to `frontend/dist`, which the deals Worker serves as static assets (Plan 3). It calls the same-origin `/api/*` routes and renders only what the backend decides: verdicts, reasons and attribution come from the contract `/search` and `/check` shapes, never from browser-side thresholds. The two backend-served HTML pages (`index.html`, `redesign.html`) merge into one lab under `dealfinder/static/lab/`, served at `/lab` with an API base that works both directly on `:8000` and behind the Worker.

**Tech Stack:** React 18.3.1, Vite 5.4.8, TypeScript 5.6, react-router-dom 6.28.0, supabase-js 2.45.4 (already a dependency), marked 12.0.2 (content pages), Playwright 1.61 with @axe-core/playwright 4.10.0, FastAPI, pytest.

**Spec:** `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md` §6.3, §6.8, §7.1b (site repo, branch `docs/dealfinder-launch`).
**Contracts:** `docs/superpowers/plans/2026-10-26-dealfinder-launch-contracts.md`. Every route, field and module name below comes from it.
**Plan 1:** `docs/superpowers/plans/2026-10-25-dealfinder-p1-identity-and-data.md` (sign-in, watchlist, saved searches, `/config.json`).

**Repo and branch:** `~/Development/tutorial-dealfinder`, branch `feat/launch-p4-frontend`, cut from `origin/main` after Plan 3 merges. If Plan 3 is not merged yet, stack on its branch. Line numbers below are from `origin/main` at `20b3fd5`. Plans 1-3 shift them, so locate code by the function or element named.

## Plan sequence (this is Plan 4)

1. Identity and data foundation.
2. Live data and verdict compliance.
3. Hosting.
4. **Shopper front end and the lab** ← this plan.
5. Alerts, observability, privacy pages, launch-gate rewrite.
6. Course lesson-build pipeline.
7. Course re-grounding and new lessons.
8. Soft launch, owner walkthrough, release.

## Global Constraints

- The browser never computes a verdict. A badge renders only from `results[].verdict`. A `null` verdict renders no badge. `DealBadge.badgeFor` and its `deal_pct` thresholds are deleted.
- Search, check, "how we rank" and privacy work signed out. Sign-in is asked for only when the shopper clicks Watch or Save (spec §5: no sign-up wall).
- The "Also on eBay" box is its own labeled section after the results. Its items carry no badge, no score, no "% under" text and no position number, and they keep the API's order. They never enter the main results list. The box is absent when `ebay.enabled` is `false`.
- Every view that shows Best Buy data shows the Best Buy logo and a link to `https://www.bestbuy.com`. That is `/` with results, `/watchlist`, and `/check` when its response carries an `attribution` entry.
- `regular_price` is display-only. It is shown struck through, with a screen-reader text equivalent, only when it is higher than `price`. No "save $X" or "% off" text is ever derived from it.
- Results keep the server's order. The front end never re-sorts them.
- The shopper front end makes no third-party requests except Supabase Auth and product images from each result's own `image_url`. No web fonts, analytics or CDN scripts. It sets no cookies.
- Any model-written prose shown in the shopper front end is wrapped in `<AiLabel>`. None exists at the end of this plan.
- API base is the same-origin `/api`. Vite's dev proxy strips `/api` exactly like the Worker.
- Text and badge colors meet WCAG AA 4.5:1. axe reports zero WCAG 2.1 A/AA violations on every route, at desktop width and at 375 px.
- New dependencies are pinned exactly: `react-router-dom@6.28.0`, `marked@12.0.2`, `@axe-core/playwright@4.10.0`.
- Do not touch the 37 lessons or the step tags. Lesson links in the lab stay off until course release (Plan 8).
- Merging to `main` deploys (Plan 3). It needs an explicit owner go, asked as "reply 'you do it'".

## Review Focus

1. **The search call fails: network error, a 5xx, or a 429 from the zone rate-limit rule.** Expected: a plain message and a Retry button, and old results are not shown as current. Pinned in Task 4, `search error and rate-limit states`.
2. **eBay data never looks rated or ranked.** Expected: zero `[data-badge]` and no "% under" text inside the eBay box, eBay items absent from the results list, and no box when `ebay.enabled` is false. Pinned in Task 4, `ebay box is separate and unrated`.
3. **A `null` verdict, from check mode or a value-only row.** Expected: no badge and no client-derived label. When `/config.json` or a search response says `check`, the page leads with the check form. Pinned in Task 4, `null verdict renders no badge`, and Task 5, `check mode leads with the form`.
4. **Sign-in is down (503 `auth unavailable`) or the session expired (401).** Expected: Watch and Save show a clear message, and search keeps working. Pinned in Task 6, `auth outage keeps search working` and `expired session asks to sign in again`.
5. **A 375 px phone with a 120-character unbroken product title.** Expected: no horizontal scroll, and the struck regular price is announced as text. Pinned in Task 8, `no horizontal scroll at 375 px`, and Task 4, `regular price has a text equivalent`.

## Owner setup

- **Best Buy logo.** Best Buy's API terms require its logo on every page that uses its data (research §3). First try the route that needs nothing from the owner: fetch `https://developer.bestbuy.com/legal` and the developer documentation pages it links, and look for a public logo download and the brand rules. If both are public, download the file unmodified. If the file sits behind the developer login, ask the owner once: "reply with the logo file from your Best Buy developer account, or 'skip' to launch with text attribution until it arrives". Save it as `frontend/public/brand/bestbuy-logo.svg` (or `.png`) with no edits. Record in `frontend/public/brand/README.md`: source URL, download date, SHA-256, and the brand rules quoted word for word. Plan 8's launch checklist checks the rendered logo against those quoted rules.
- **Supabase allowlist.** Plan 3 Task 12 already adds `https://deals.cloudcodetree.com/**`. Plan 4 adds only the Vite dev origin `http://127.0.0.1:5173/**`. Use Plan 1's `node scripts/supabase-allowlist.mjs --add 'http://127.0.0.1:5173/**' --dry-run` in the site repo, confirm the after list keeps every existing entry, then ask "reply 'you do it'" before running it for real.

---

### Task 1: One lab at `/lab`

**Files:**
- Create: `dealfinder/static/lab/index.html`, `dealfinder/static/lab/lab.css`, `dealfinder/static/lab/lab.js`, `dealfinder/static/lab/lessons.json`
- Delete: `dealfinder/static/redesign.html`, `dealfinder/static/index.html`
- Modify: `dealfinder/serve.py` (`redesign()` at `:231-237`, `home()` at `:1179-1181`, new `lab` and `lab_asset`)
- Modify: `pyproject.toml:29-30` (package-data)
- Test: `tests/test_lab.py` (new), `tests/test_serve.py:106-109` (replace `test_redesign_route_serves_the_nocturne_page`)

**Interfaces:**
- Consumes: Plan 1 Task 7's sign-in code inside `redesign.html` (`authHeaders()`, `/config.json`). Plan 3's edge guard, which rejects a wrong `X-DealFinder-Edge` value before this route runs.
- Produces:
  - `GET /lab` and `GET /lab/` return the lab HTML with `<meta name="api-base" content="…">`. The content is `/api` when the request carries an `X-DealFinder-Edge` header and empty otherwise.
  - `GET /lab/{name}` serves only `LAB_ASSETS = {"lab.css": "text/css", "lab.js": "text/javascript", "lessons.json": "application/json"}`. Anything else is 404.
  - `GET /redesign` and backend `GET /` answer 301 with `Location: /lab`.
  - `lab.js` reads the meta once into `const API` and prefixes every `fetch` and `EventSource` URL with it.
  - Deep links and a ready flag, for Plan 6's screenshot manifests: on load `lab.js` reads `?mode=<id>&q=<query>` with `URLSearchParams(location.search)`. It opens that mode, fills its query input, and runs it. When a mode finishes rendering, its `[data-mode="<id>"]` container gets `data-ready="true"`. Switching modes clears the flag on the old container.
  - `lessons.json` maps every lab mode to `{"part": int | null, "slug": str | null, "live": false}`. A panel's "Part N" kicker becomes a link to `https://cloudcodetree.com/tutorials/<slug>/` only when `live` is true.
  - `LAB_MODES` (the test constant): `deals, stream, watchlist, semantic, ask, context, review, dataset, pipeline, models, tracking, evals, mlops, safety, compliance, inference, ops, auth, billing, suggestions`.

The lab absorbs `index.html`'s course modes (`index.html:49-66`). Most already exist in the Nocturne rail (`redesign.html:158-196`). Three gaps get closed:

| `index.html` mode | Lab mode | Endpoint | Gap to close |
|---|---|---|---|
| `live` | `stream` (new, "Find" group) | `/search/stream` | New mode. Paints each source's SSE `results` frame as it lands, then the `done` summary (`index.html:860-880`). |
| `ask` | `ask` | `/ask`, `/ask_agentic` | Add an "agentic" toggle that switches the endpoint. |
| `review` | `review` | `/review?trap=` | Add the "inject a writer fooled by the $46 Bose trap" checkbox (`index.html:68-69`). |
| `meaning`, `window` | `semantic`, `context` | `/semantic`, `/context` | Renamed only. |
| the other 13 | same names | same endpoints | None. |

The `/sources` status line (`index.html:886`) moves into the lab's meta line.

- [ ] **Step 1: Write the failing tests** in `tests/test_lab.py`

```python
STATIC = Path(serve.__file__).parent / "static"
LAB_MODES = {"deals", "stream", "watchlist", "semantic", "ask", "context", "review", "dataset",
             "pipeline", "models", "tracking", "evals", "mlops", "safety", "compliance",
             "inference", "ops", "auth", "billing", "suggestions"}
COURSE_ENDPOINTS = ["/ranked", "/search/stream", "/watchlist", "/semantic", "/ask_agentic", "/context",
                    "/review", "/dataset", "/pipeline", "/models", "/tracking", "/evals", "/mlops",
                    "/safety", "/compliance", "/inference", "/ops", "/auth", "/billing", "/suggestions",
                    "/sources", "/config.json"]

def test_lab_holds_every_course_mode():
    assert set(re.findall(r'data-mode="([a-z]+)"', client.get("/lab").text)) == LAB_MODES

def test_lab_calls_every_course_endpoint():
    js = client.get("/lab/lab.js").text
    assert [ep for ep in COURSE_ENDPOINTS if ep not in js] == []

def test_lab_requests_all_go_through_the_api_base():
    js = client.get("/lab/lab.js").text
    assert not re.search(r"""(fetch|EventSource)\(\s*[`'"]/""", js)

def test_lab_api_base_direct_and_behind_the_edge():
    assert '<meta name="api-base" content="">' in client.get("/lab").text
    assert '<meta name="api-base" content="/api">' in client.get("/lab", headers={"X-DealFinder-Edge": "x"}).text

def test_old_entry_points_redirect_to_lab():
    for path in ("/", "/redesign"):
        r = client.get(path, follow_redirects=False)
        assert (r.status_code, r.headers["location"]) == (301, "/lab")

def test_course_pages_are_retired():
    assert not (STATIC / "index.html").exists() and not (STATIC / "redesign.html").exists()

def test_lab_supports_deep_links_and_a_ready_flag():
    js = client.get("/lab/lab.js").text
    assert "URLSearchParams(location.search)" in js
    assert re.search(r"dataset\.ready\s*=\s*['\"]true['\"]", js)

def test_lab_assets_are_allowlisted():
    assert client.get("/lab/lab.css").headers["content-type"].startswith("text/css")
    assert client.get("/lab/%2e%2e%2fserve.py").status_code == 404
    assert client.get("/lab/notes.txt").status_code == 404

def test_every_lab_mode_has_a_lesson_entry():
    lessons = client.get("/lab/lessons.json").json()
    assert set(lessons) == LAB_MODES
    assert all(set(v) == {"part", "slug", "live"} and v["live"] is False for v in lessons.values())
```

Move Plan 1's `test_lab_has_no_dev_identity` to read `lab/index.html` and `lab/lab.js` instead of `redesign.html`, with the same assertions. Delete `test_redesign_route_serves_the_nocturne_page`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_lab.py -v`
Expected: FAIL. `GET /lab` returns 404.

- [ ] **Step 3: Implement**

- Split `redesign.html` into `lab/index.html` (markup), `lab/lab.css` (the `<style>` block, `:root` tokens first) and `lab/lab.js` (the script), with no visual change.
- Add the `stream` mode, the agentic toggle, the trap checkbox and the `/sources` line per the table.
- Fill `lessons.json` from the current kickers: `context` 16, `review` 17, `dataset` 19, `pipeline` 20, `models` 21, `tracking` 22, `evals` 23, `mlops` 24, `safety` 25, `inference` 27, `ops` 30, `auth` 32, `suggestions` 33, `billing` 34, `compliance` 35, with `slug` `dealfinder-part-NN`. The other five modes get `null` part and slug. Plan 7 sets the final numbers.
- `serve.lab(request: Request) -> HTMLResponse` and `serve.lab_asset(name: str) -> Response`. Inject the meta by replacing the placeholder `<meta name="api-base" content="">` once.
- Package-data becomes `dealfinder = ["static/lab/*", "templates/*"]`. Keep `templates/*` if Plan 3 already added it.

- [ ] **Step 4: Run the tests and the full offline suite**

Run: `./.venv/bin/python -m pytest tests/test_lab.py tests/test_serve.py -v && ./.venv/bin/python -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Check it in the browser**

Run `./.venv/bin/uvicorn dealfinder.serve:app --port 8000`, open `http://127.0.0.1:8000/`. It lands on `/lab`. Click every rail mode once. Each loads or shows its "needs full-ML profile" hint, and none shows a 404 in DevTools' network panel. Screenshot the `stream` mode with chrome-devtools.

- [ ] **Step 6: Commit**

```bash
git add dealfinder/static/lab/ dealfinder/serve.py pyproject.toml tests/test_lab.py tests/test_serve.py
git rm dealfinder/static/redesign.html dealfinder/static/index.html
git commit -m "feat(lab): one Nocturne lab at /lab with every course mode; retire index.html"
```

---

### Task 2: Design tokens, verdict colors and contrast

**Files:**
- Create: `frontend/src/theme/tokens.css`, `frontend/src/theme/base.css`
- Modify: `dealfinder/static/lab/lab.css` (add the verdict tokens), `dealfinder/templates/deal.css` only if a parity test fails
- Test: `tests/test_design_tokens.py` (new)

**Interfaces:**
- Consumes: the lab `:root` block (Task 1), Plan 3's `dealfinder/templates/deal.css`.
- Produces:
  - `tokens.css` holds every variable in the lab's `:root` (`redesign.html:10-21` today) with the same values, plus four verdict pairs: `--verdict-deal-fg/-bg`, `--verdict-fair-fg/-bg`, `--verdict-suspicious-fg/-bg`, `--verdict-overpriced-fg/-bg`. The deal pair builds on `--ok`, and the suspicious pair builds on `--warn`.
  - `base.css` holds the reset, the body font and colors, `.sr-only`, a visible `:focus-visible` ring, and `overflow-wrap: anywhere` on headings and card titles.
  - Font tokens keep `"Inter",system-ui,sans-serif`. Nothing loads Inter from Google Fonts.

- [ ] **Step 1: Write the failing tests**

```python
FRONT = ROOT / "frontend/src/theme/tokens.css"
LAB = ROOT / "dealfinder/static/lab/lab.css"
DEAL = ROOT / "dealfinder/templates/deal.css"

def root_vars(path) -> dict[str, str]:   # parse the first :root{...} block into {"--name": "value"}
    ...

def test_lab_tokens_match_frontend():
    front, lab = root_vars(FRONT), root_vars(LAB)
    assert {k: v for k, v in lab.items() if front.get(k) != v} == {}

def test_deal_page_tokens_match_frontend():
    front, deal = root_vars(FRONT), root_vars(DEAL)
    assert {k: v for k, v in deal.items() if front.get(k) != v} == {}

TEXT_PAIRS = [("--color-text", "--color-bg"), ("--color-text", "--color-surface"),
              ("--color-neutral-400", "--color-bg"), ("--color-neutral-500", "--color-bg"),
              ("--color-neutral-500", "--color-surface"), ("--color-accent", "--color-bg"),
              ("--color-accent", "--color-surface")] + \
             [(f"--verdict-{v}-fg", f"--verdict-{v}-bg") for v in ("deal", "fair", "suspicious", "overpriced")]

@pytest.mark.parametrize("fg,bg", TEXT_PAIRS)
def test_text_pairs_meet_wcag_aa(fg, bg):
    t = root_vars(FRONT)
    assert contrast(t[fg], t[bg]) >= 4.5      # WCAG 2.1 relative-luminance ratio, hex colors only

def test_frontend_loads_no_web_fonts():
    css = "".join(p.read_text() for p in (ROOT / "frontend/src").rglob("*.css"))
    assert "fonts.googleapis.com" not in css and "@font-face" not in css
```

`contrast(a, b)` is a ten-line helper in the test file: sRGB to linear, relative luminance, `(L1 + 0.05) / (L2 + 0.05)`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_design_tokens.py -v`
Expected: FAIL. `frontend/src/theme/tokens.css` does not exist.

- [ ] **Step 3: Implement** `tokens.css`, `base.css` and the verdict tokens in `lab.css`. Pick verdict colors that pass the contrast test. If `deal.css` disagrees with `tokens.css`, change `deal.css` to the `tokens.css` value, never the other way.

- [ ] **Step 4: Run the tests and see them pass**

Run: same as Step 2.
Expected: all pass. `--color-neutral-600` stays out of `TEXT_PAIRS` and is never used for shopper text.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme/tokens.css frontend/src/theme/base.css dealfinder/static/lab/lab.css dealfinder/templates/deal.css tests/test_design_tokens.py
git commit -m "feat(frontend): Nocturne tokens as the source of truth, AA verdict colors, parity tests"
```

---

### Task 3: App shell, API client and mocked-API test harness

**Files:**
- Modify: `frontend/package.json` (add `react-router-dom@6.28.0`, `@axe-core/playwright@4.10.0`, `marked@12.0.2`, scripts), `frontend/package-lock.json`
- Modify: `frontend/vite.config.ts` (proxy), `frontend/playwright.config.ts` (preview server, two projects)
- Modify: `frontend/index.html` (title, description, `lang="en"`)
- Modify: `frontend/.env.example` (drop `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, keep `VITE_API_PROXY_TARGET`)
- Rewrite: `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Create: `frontend/src/components/Layout.tsx`, `frontend/src/pages/NotFound.tsx`
- Rewrite: `frontend/e2e/fixtures.ts`. Create: `frontend/e2e/shell.spec.ts`

**Interfaces:**
- Produces, in `api.ts` (types mirror the contract `/search` shape exactly):
  - `ShopResult`, `EbayItem`, `EbayBox`, `Attribution`, `ShopResponse`, `CheckResponse`, `WatchItem`, `SavedSearch`, `PublicConfig`.
  - `Verdict = "deal" | "fair" | "overpriced" | "suspicious"`.
  - `class ApiError extends Error { status: number; detail: string }`. Its `detail` is the backend's `detail` string, or a fixed message for a network error (`status` 0).
  - `searchDeals(q: string, k?: number, signal?: AbortSignal): Promise<ShopResponse>` calls `GET /api/search?q=&k=`.
  - `checkDeal(title: string, price: number): Promise<CheckResponse>` calls `GET /api/check`.
  - `getConfig(): Promise<PublicConfig | null>`. A failed fetch resolves to `null` and is cached for the page's life.
  - `listWatch(token)`, `addWatch(token, offerId, targetPrice?)`, `removeWatch(token, offerId)`, `listSaved(token)`, `addSaved(token, query, maxPrice?)`, `removeSaved(token, id)`. Each sends `Authorization: Bearer <token>` and throws `ApiError` on non-2xx.
- Routes in `App.tsx`: `/` (`SearchPage`), `/check` (`CheckPage`), `/watchlist`, `/saved`, `/how-we-rank`, `/privacy`, and `*` for `NotFound`. Task 3 mounts placeholder pages, and Tasks 4-7 replace them.
- `Layout` renders the header (brand, nav links, the sign-in slot), `<main id="main">`, a skip link, and the footer. The footer holds links to How we rank, Privacy and "Under the hood" (`/lab`), plus the note "Prices come from the stores and may be out of date. Check the store before you buy. Verdicts are computed by a price model. Any AI-written text here is labeled AI-written."
- Vite proxy: `"/api": { target: API_TARGET, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") }`. The old `/search`, `/me`, `/healthz` entries are removed.
- Playwright: `webServer.command` is `npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`, and `baseURL` is `http://127.0.0.1:4173`. Projects are `desktop` (Desktop Chrome) and `mobile-375` (Chromium, viewport 375×812, `isMobile: true`, `hasTouch: true`).
- `e2e/fixtures.ts` exports:
  - `SHOP_LIVE`: four Best Buy results, one per verdict, not in price order. One has `regular_price` above `price`, one below, one a 120-character unbroken title. Plus two eBay items and a Best Buy attribution entry.
  - `SHOP_NO_EBAY` (`ebay.enabled: false`), `SHOP_CHECK_MODE` (`mode: "check"`, with `verdict`, `fair`, `residual_frac`, `basis`, `pct_under_median` and top-level `median_price` all `null`), `SHOP_EMPTY`, `CHECK_DEAL`, `CHECK_UNKNOWN_CATEGORY` (`verdict: null`).
  - `CONFIG = {supabaseUrl: "https://demo-ref.supabase.co", supabasePublishableKey: "sb_publishable_test", providers: ["google", "github"]}`.
  - `stubApi(page, overrides)` routes `**/api/**` and the mocked Supabase host, aborts every other off-host request, exposes `page.apiCalls(prefix)`, and records unmatched `/api` calls in `page.unexpected`.
  - `signedIn(page, {sub, email, token})` writes a far-future supabase-js session to localStorage key `sb-demo-ref-auth-token` before load.

- [ ] **Step 1: Write the failing tests** in `e2e/shell.spec.ts`

```ts
test("every route renders its heading", async ({ page }) => {
  await stubApi(page, {});
  for (const [path, h1] of [["/", /find a deal/i], ["/check", /check a deal/i], ["/watchlist", /watchlist/i],
                            ["/saved", /saved searches/i], ["/how-we-rank", /how we rank/i], ["/privacy", /privacy/i]]) {
    await page.goto(path as string);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1 as RegExp);
  }
});
test("unknown route shows not found with a way home", async ({ page }) => {
  await stubApi(page, {});
  await page.goto("/nope");
  await expect(page.getByRole("link", { name: /back to search/i })).toHaveAttribute("href", "/");
});
test("footer carries the staleness and model notes on every page", async ({ page }) => {
  await stubApi(page, {});
  await page.goto("/");
  await expect(page.getByRole("contentinfo")).toContainText("may be out of date");
  await expect(page.getByRole("contentinfo")).toContainText("price model");
});
test("config failure does not block search", async ({ page }) => {
  await stubApi(page, { config: { status: 500 }, search: SHOP_LIVE });
  await page.goto("/?q=headphones");
  await expect(page.getByTestId("result-card")).toHaveCount(4);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npm install && npx playwright test e2e/shell.spec.ts --project=desktop`
Expected: FAIL. No route renders the expected headings.

- [ ] **Step 3: Implement** the shell, the API client, the proxy and the Playwright config. Delete `useSearch`, `dealPctFromMedian` and `fetchMe` from `api.ts`. The shopper page does not stream, and the lab owns streaming (Task 1). Delete `e2e/search.spec.ts`'s old `deal_pct` cases, because Task 4 replaces that file.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx playwright test e2e/shell.spec.ts`
Expected: pass in both projects. `ls dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/playwright.config.ts frontend/index.html frontend/.env.example frontend/src/api.ts frontend/src/App.tsx frontend/src/main.tsx frontend/src/components/Layout.tsx frontend/src/pages/NotFound.tsx frontend/e2e/fixtures.ts frontend/e2e/shell.spec.ts
git rm frontend/e2e/search.spec.ts
git commit -m "feat(frontend): router shell, contract API client, /api proxy, mocked-API harness"
```

---

### Task 4: The shopper search page

**Files:**
- Create: `frontend/src/pages/SearchPage.tsx`, `frontend/src/components/VerdictBadge.tsx`, `frontend/src/components/PriceTag.tsx`, `frontend/src/components/EbayBox.tsx`, `frontend/src/components/Attribution.tsx`, `frontend/src/components/AiLabel.tsx`
- Rewrite: `frontend/src/components/ResultCard.tsx`, `frontend/src/components/SearchBar.tsx`
- Delete: `frontend/src/components/DealBadge.tsx`
- Create: `frontend/public/brand/bestbuy-logo.svg` and `frontend/public/brand/README.md` (Owner setup)
- Test: `frontend/e2e/search.spec.ts` (new file), `tests/test_brand_assets.py`

**Interfaces:**
- Consumes: `searchDeals`, `ShopResponse`, fixtures (Task 3), tokens (Task 2).
- Produces:
  - `SearchPage` keeps the query in the URL (`/?q=`). An empty or whitespace query sends no request. A new search aborts the previous one.
  - `SearchBar({ initial: string, busy: boolean, onSearch(q: string): void })`. The input is labeled "Search Best Buy" and limited to 200 characters.
  - `ResultCard({ result: ShopResult, onWatch?: (r: ShopResult) => void })`. It shows the title as a link to `url` (`rel="noopener noreferrer"`, new tab), `PriceTag`, the badge when `verdict` is non-null, the `reason` as plain text, and "Our fair price ~$N" only when `fair` is non-null. Its image uses `loading="lazy"`, fixed `width`/`height` and `alt=""`, because the title sits beside it.
  - `VerdictBadge({ verdict: Verdict })` renders `<span data-badge="DEAL|FAIR|SUSPICIOUS|OVERPRICED" aria-label="Verdict: deal">` with the matching `--verdict-*` tokens. It accepts no `null`. The caller omits it.
  - `PriceTag({ price: number, regularPrice: number | null, currency?: string })`. When `regularPrice > price` it renders `<s aria-hidden="true">` plus `<span class="sr-only">Regular price at Best Buy: $399.99</span>`. It formats with `Intl.NumberFormat("en-US", {style: "currency", currency})`.
  - `EbayBox({ box: EbayBox })` renders `null` when `!box.enabled` or `box.items` is empty. Otherwise it renders `<section aria-labelledby="ebay-h" data-testid="ebay-box">` with the heading "Also on eBay", `box.note`, and each item's title link, price and condition.
  - `Attribution({ entries: Attribution[] })` renders `<a href={url}>` holding `<img src="/brand/bestbuy-logo.svg" alt="Best Buy">` and `text` for `logo === "bestbuy"`. An unknown logo key renders text only. `SearchPage` passes `response.attribution`, and also a Best Buy entry when any result's `source` starts with `BestBuy` but the list lacks one.
  - `AiLabel({ children })` wraps model-written prose with a visible "AI-written" tag.
  - Status line: "N Best Buy results · median $X · prices fetched HH:MM UTC" from `count`, `median_price`, `fetched_at`. When `median_price` is `null` (check mode), the median part is left out: "N Best Buy results · prices fetched HH:MM UTC". A null `pct_under_median` renders nothing, never "0%". Pin both in the check-mode e2e test.
  - Error copy by `ApiError.status`: 429 "Too many searches. Try again in 10 seconds." 0 "Can't reach DealFinder right now." Any other non-2xx "Search failed. Try again." Each comes with a Retry button that reruns the same query.

- [ ] **Step 1: Write the failing tests** in `e2e/search.spec.ts`

```ts
test("renders results in server order with server verdicts", async ({ page }) => {
  await stubApi(page, { search: SHOP_LIVE });
  await page.goto("/?q=headphones");
  await expect(page.getByTestId("result-card").locator("a.title"))
    .toHaveText(SHOP_LIVE.results.map((r) => r.title));
  await expect(page.locator("[data-badge]")).toHaveText(SHOP_LIVE.results.map((r) => r.verdict!.toUpperCase()));
  expect(page.unexpected).toEqual([]);
});
test("null verdict renders no badge", async ({ page }) => {
  await stubApi(page, { search: SHOP_CHECK_MODE });
  await page.goto("/?q=headphones");
  await expect(page.locator("[data-badge]")).toHaveCount(0);
});
test("ebay box is separate and unrated", async ({ page }) => {
  await stubApi(page, { search: SHOP_LIVE });
  await page.goto("/?q=headphones");
  const box = page.getByTestId("ebay-box");
  await expect(box.getByRole("heading", { name: "Also on eBay" })).toBeVisible();
  await expect(box.locator("[data-badge]")).toHaveCount(0);
  await expect(box).not.toContainText(/% (under|off)|fair price/i);
  await expect(page.getByTestId("result-card")).toHaveCount(SHOP_LIVE.results.length);
});
test("ebay box is hidden when eBay is off", async ({ page }) => {
  await stubApi(page, { search: SHOP_NO_EBAY });
  await page.goto("/?q=headphones");
  await expect(page.getByTestId("ebay-box")).toHaveCount(0);
});
test("regular price has a text equivalent", async ({ page }) => {
  await stubApi(page, { search: SHOP_LIVE });
  await page.goto("/?q=headphones");
  const card = page.getByTestId("result-card").filter({ has: page.locator("s") });
  await expect(card).toHaveCount(1);                     // the row with regular_price below price shows none
  await expect(card.locator(".sr-only")).toHaveText(/^Regular price at Best Buy: \$/);
  await expect(page.locator("main")).not.toContainText(/save \$|% off/i);
});
test("best buy attribution with logo on every results view", async ({ page }) => {
  await stubApi(page, { search: SHOP_LIVE });
  await page.goto("/?q=headphones");
  const logo = page.getByRole("img", { name: "Best Buy" });
  await expect(logo).toBeVisible();
  await expect(page.getByRole("link").filter({ has: logo })).toHaveAttribute("href", "https://www.bestbuy.com");
  expect(await logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});
test("search error and rate-limit states", async ({ page }) => {
  for (const [status, text] of [[429, /try again in 10 seconds/i], [502, /search failed/i], [0, /can't reach/i]]) {
    await stubApi(page, { search: { status } });
    await page.goto("/?q=headphones");
    await expect(page.getByRole("alert")).toHaveText(text as RegExp);
    await expect(page.getByTestId("result-card")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  }
});
test("empty query sends nothing and zero results is not an error", async ({ page }) => {
  await stubApi(page, { search: SHOP_EMPTY });
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  expect(page.apiCalls("/api/search")).toBe(0);
  await page.goto("/?q=zzznothing");
  await expect(page.getByText(/no best buy results/i)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
```

Status `0` in `stubApi` means `route.abort()`.

Add `tests/test_brand_assets.py::test_bestbuy_logo_is_unmodified`. It reads the SHA-256 recorded in `frontend/public/brand/README.md` and compares it with the file's hash.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx playwright test e2e/search.spec.ts --project=desktop`
Expected: FAIL. The page has no result cards.

- [ ] **Step 3: Implement** the page and components. If the Best Buy logo is still pending from the owner, mark only the logo test `test.fixme("owner: Best Buy logo pending (Plan 4 Owner setup)")`, render the text attribution, and skip `test_bestbuy_logo_is_unmodified` with the same reason. Never draw a stand-in logo. Plan 8's launch checklist fails while either is skipped.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx playwright test e2e/search.spec.ts && cd .. && ./.venv/bin/python -m pytest tests/test_brand_assets.py -v`
Expected: pass in both projects, or one fixme and one skip with the owner reason.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SearchPage.tsx frontend/src/components/ frontend/public/brand/ frontend/e2e/search.spec.ts tests/test_brand_assets.py
git commit -m "feat(frontend): shopper search on server verdicts; separate unrated eBay box; Best Buy attribution"
```

---

### Task 5: "Check a deal"

**Files:**
- Create: `frontend/src/pages/CheckPage.tsx`, `frontend/src/components/CheckForm.tsx`
- Modify: `frontend/src/pages/SearchPage.tsx` (lead with the check form in check mode)
- Modify: `dealfinder/serve.py` (`/config.json` gains `verdictMode`), `tests/test_serve.py` (Plan 1's `test_config_json_exposes_only_public_settings` key set)
- Test: `frontend/e2e/check.spec.ts`

**Interfaces:**
- Consumes: `checkDeal`, `getConfig`, `VerdictBadge`, `Attribution` (Tasks 3-4). Plan 2's `GET /check` and `shop.verdict_mode()`.
- Produces:
  - `GET /config.json` adds `"verdictMode": shop.verdict_mode()`. This is a contract addition (see the parent's contracts file). The front end treats a missing key as `"live"`.
  - `CheckForm({ onResult(r: CheckResponse): void, initialTitle?: string })` has two labeled fields. "Product name" takes 1 to 200 characters. "Price you see (USD)" is a number with `min="0.01"` and `step="0.01"`. Invalid input shows inline errors and sends nothing. A backend 422 shows "Enter a product name and a price above $0."
  - The result shows the badge only for a non-null verdict, then `reason`, then "Our fair price ~$N" when `fair` is non-null. `Attribution` renders only from a returned `attribution` field. In check mode no Best Buy data is used, so none shows.
  - `SearchPage` with `verdictMode === "check"` on the config, or any response with `mode: "check"`: `CheckForm` renders above the search bar under the heading "Check a deal". Search results still render, with no badges, under "Best Buy results (not rated)".

- [ ] **Step 1: Write the failing tests**

```ts
test("check a deal shows the server verdict and reason", async ({ page }) => {
  await stubApi(page, { check: CHECK_DEAL });
  await page.goto("/check");
  await page.getByLabel("Product name").fill("Sony WH-1000XM5");
  await page.getByLabel("Price you see (USD)").fill("249.99");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.locator("[data-badge]")).toHaveText(CHECK_DEAL.verdict.toUpperCase());
  await expect(page.getByText(CHECK_DEAL.reason)).toBeVisible();
});
test("unknown category shows the reason with no badge", async ({ page }) => {
  await stubApi(page, { check: CHECK_UNKNOWN_CATEGORY });
  await page.goto("/check");
  await page.getByLabel("Product name").fill("Cast iron skillet");
  await page.getByLabel("Price you see (USD)").fill("20");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.locator("[data-badge]")).toHaveCount(0);
  await expect(page.getByText(CHECK_UNKNOWN_CATEGORY.reason)).toBeVisible();
});
test("invalid check input sends nothing", async ({ page }) => {
  await stubApi(page, {});
  await page.goto("/check");
  await page.getByLabel("Price you see (USD)").fill("0");
  await page.getByRole("button", { name: "Check" }).click();
  expect(page.apiCalls("/api/check")).toBe(0);
  await expect(page.getByText(/enter a product name/i)).toBeVisible();
});
test("check mode leads with the form", async ({ page }) => {
  await stubApi(page, { config: { ...CONFIG, verdictMode: "check" }, search: SHOP_CHECK_MODE });
  await page.goto("/?q=headphones");
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings[0]).toBe("Check a deal");
  await expect(page.getByText("Best Buy results (not rated)")).toBeVisible();
});
```

```python
def test_config_json_exposes_only_public_settings(monkeypatch):   # Plan 1's test, key set widened
    ...
    assert set(r.json()) == {"supabaseUrl", "supabasePublishableKey", "providers", "verdictMode"}
    assert r.json()["verdictMode"] in ("live", "check")
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx playwright test e2e/check.spec.ts --project=desktop` and `./.venv/bin/python -m pytest tests/test_serve.py -k config_json -v`
Expected: FAIL. `/check` is a placeholder, and `verdictMode` is missing.

- [ ] **Step 3: Implement** the page, the form, the check-mode layout and the config key.

- [ ] **Step 4: Run the tests and see them pass**

Run: same as Step 2, both projects.
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CheckPage.tsx frontend/src/components/CheckForm.tsx frontend/src/pages/SearchPage.tsx frontend/e2e/check.spec.ts dealfinder/serve.py tests/test_serve.py
git commit -m "feat(frontend): check-a-deal mode; the page leads with it when verdicts are off"
```

---

### Task 6: Sign-in, watchlist and saved searches

**Files:**
- Rewrite: `frontend/src/lib/supabase.ts`, `frontend/src/components/Auth.tsx`
- Create: `frontend/src/lib/auth.tsx`, `frontend/src/components/SignInDialog.tsx`, `frontend/src/components/WatchButton.tsx`, `frontend/src/components/SaveSearch.tsx`, `frontend/src/pages/WatchlistPage.tsx`, `frontend/src/pages/SavedPage.tsx`
- Test: `frontend/e2e/account.spec.ts`

**Interfaces:**
- Consumes: `getConfig` and the account API functions (Task 3). Plan 1's routes and messages: `404 offer not found — search for it first`, `409 watchlist limit reached (200)`, `409 saved-search limit reached (50)`, `404 not on your watchlist`, `404 saved search not found`, and `503 auth unavailable`.
- Produces:
  - `loadSupabase(): Promise<SupabaseClient | null>` creates the client once from `getConfig()`, and returns `null` when the config is null.
  - `AuthProvider` and `useAuth(): { status: "loading" | "signed-out" | "signed-in" | "unavailable"; email: string | null; token: string | null; signInWithProvider(p: "google" | "github"): Promise<void>; signInWithEmail(email: string): Promise<void>; signOut(): Promise<void>; expire(): void }`.
  - Every sign-in call passes `redirectTo` / `emailRedirectTo` as `location.origin + location.pathname`. Provider buttons come from `config.providers`. The magic-link form is always offered when the config is non-null. With a null config, the header button reads "Sign-in not configured" and is disabled.
  - `SignInDialog({ open, reason, onClose })` is a modal `<dialog>`. Focus starts on its first control and stays inside, Escape closes it, and focus returns to the opener. `reason` is the line that explains why, for example "Sign in to watch prices. Search stays free without an account."
  - `WatchButton({ result: ShopResult })` appears on `ResultCard` only, never in the eBay box. Signed out, it opens the dialog. Signed in, it reveals an optional "Alert me below $" field and a Confirm button, then calls `addWatch`. Its states are "Watch", "Watching" and an error line showing the backend `detail`.
  - `SaveSearch({ query })` sits under the search status line. It takes an optional max price and calls `addSaved`.
  - `WatchlistPage`: signed out, an explanation and a Sign in button. Signed in, each item shows title, `last_price`, the optional target, "Price checked N h ago" from `last_checked_at`, a "Below your target" chip when `hit`, and Remove. `Attribution` shows Best Buy whenever any item's `source` starts with `BestBuy`.
  - `SavedPage`: each saved search with its max price, a "Run" link to `/?q=<query>`, and Remove.
  - Error handling: on 401 the client calls `expire()` (local sign-out) and shows "Your session ended. Sign in again." On 503 it shows "Sign-in is down right now. Search still works." 409 and 404 show the backend `detail` verbatim.

- [ ] **Step 1: Write the failing tests** in `e2e/account.spec.ts`

```ts
test("signed out: search works and watch asks to sign in", async ({ page }) => {
  await stubApi(page, { config: CONFIG, search: SHOP_LIVE });
  await page.goto("/?q=headphones");
  await page.getByTestId("result-card").first().getByRole("button", { name: "Watch" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Search stays free without an account");
  await expect(dialog.getByRole("button", { name: /google/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /github/i })).toBeVisible();
  await expect(dialog.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("result-card").first().getByRole("button", { name: "Watch" })).toBeFocused();
});
test("magic link posts the email with this page as the redirect", async ({ page }) => {
  const otp = (await stubApi(page, { config: CONFIG })).supabase("otp");
  await page.goto("/watchlist");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("a@b.com");
  await page.getByRole("button", { name: /email me a sign-in link/i }).click();
  const req = await otp;
  expect(req.postDataJSON().email).toBe("a@b.com");
  expect(new URL(req.url()).searchParams.get("redirect_to")).toBe("http://127.0.0.1:4173/watchlist");
});
test("signed in: watch sends the bearer token and no price", async ({ page }) => {
  const posts = (await stubApi(page, { config: CONFIG, search: SHOP_LIVE, watchlist: { items: [] } })).capture("POST", "/api/watchlist");
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "tok-1" });
  await page.goto("/?q=headphones");
  const card = page.getByTestId("result-card").first();
  await card.getByRole("button", { name: "Watch" }).click();
  await card.getByLabel("Alert me below $").fill("250");
  await card.getByRole("button", { name: "Confirm" }).click();
  const req = await posts;
  expect(req.headers()["authorization"]).toBe("Bearer tok-1");
  expect(req.postDataJSON()).toEqual({ offer_id: SHOP_LIVE.results[0].id, target_price: 250 });
  await expect(card.getByRole("button", { name: "Watching" })).toBeVisible();
});
test("watchlist shows staleness, hit and Best Buy attribution", async ({ page }) => {
  await stubApi(page, { config: CONFIG, watchlist: WATCHLIST_TWO });   // one hit, one not
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "tok-1" });
  await page.goto("/watchlist");
  await expect(page.getByText("Below your target")).toHaveCount(1);
  await expect(page.getByText(/price checked \d+ h ago/i)).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Best Buy" })).toBeVisible();
});
test("limit and not-found messages come from the server", async ({ page }) => {
  // POST /api/watchlist → 409 {detail: "watchlist limit reached (200)"}: the card shows that detail verbatim
});
test("expired session asks to sign in again", async ({ page }) => {
  await stubApi(page, { config: CONFIG, watchlist: { status: 401, detail: "token expired" } });
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "old" });
  await page.goto("/watchlist");
  await expect(page.getByRole("alert")).toHaveText("Your session ended. Sign in again.");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
test("auth outage keeps search working", async ({ page }) => {
  await stubApi(page, { config: CONFIG, search: SHOP_LIVE,
                        savedPost: { status: 503, detail: "auth unavailable" } });
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "tok-1" });
  await page.goto("/?q=headphones");
  await page.getByRole("button", { name: "Save this search" }).click();
  await expect(page.getByRole("alert")).toHaveText("Sign-in is down right now. Search still works.");
  await expect(page.getByTestId("result-card")).toHaveCount(SHOP_LIVE.results.length);
});
test("saved searches list, run and remove", async ({ page }) => {
  const del = (await stubApi(page, { config: CONFIG, saved: SAVED_ONE })).capture("DELETE", "/api/saved-searches/");
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "tok-1" });
  await page.goto("/saved");
  await expect(page.getByRole("link", { name: "Run" })).toHaveAttribute("href", `/?q=${encodeURIComponent(SAVED_ONE.items[0].query)}`);
  await page.getByRole("button", { name: "Remove" }).click();
  expect(new URL((await del).url()).pathname).toBe(`/api/saved-searches/${SAVED_ONE.items[0].id}`);
});
test("sign-in not configured disables the button", async ({ page }) => {
  await stubApi(page, { config: null });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign-in not configured" })).toBeDisabled();
});
```

Add `WATCHLIST_TWO` and `SAVED_ONE` to `fixtures.ts`. `stubApi` resolves to a handle once its routes are registered. `handle.capture(method, pathPrefix)` returns a promise of the first matching request, and `handle.supabase("otp")` does the same for `https://demo-ref.supabase.co/auth/v1/otp`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx playwright test e2e/account.spec.ts --project=desktop`
Expected: FAIL. No Watch button exists.

- [ ] **Step 3: Implement** the auth layer, dialog, buttons and pages. Remove the email+password form and the `/me` call from `Auth.tsx`. Plan 1's spec has no password sign-in.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx playwright test e2e/account.spec.ts`
Expected: pass in both projects.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ frontend/src/components/Auth.tsx frontend/src/components/SignInDialog.tsx frontend/src/components/WatchButton.tsx frontend/src/components/SaveSearch.tsx frontend/src/pages/WatchlistPage.tsx frontend/src/pages/SavedPage.tsx frontend/e2e/account.spec.ts frontend/e2e/fixtures.ts
git commit -m "feat(frontend): Google, GitHub and magic-link sign-in; private watchlist and saved searches"
```

---

### Task 7: "How we rank" and privacy pages

**Files:**
- Create: `frontend/src/content/how-we-rank.md`, `frontend/src/content/privacy.md`, `frontend/src/pages/ContentPage.tsx`
- Test: `frontend/e2e/pages.spec.ts`

**Interfaces:**
- Produces:
  - `ContentPage({ source: string })` renders a Markdown file imported with Vite's `?raw` through `marked.parse`. The files are committed, so no user input reaches the HTML. The first `#` heading becomes the page's `h1` and the document title.
  - Plan 5 finalizes `privacy.md`. Plan 4 ships only statements that are true when Plan 4 lands:

| File | Statements |
|---|---|
| `how-we-rank.md` | Two signals: distance below the median of the Best Buy results for the same search, and distance from our price model's fair price. The layered estimator: the trained model for known categories, else similar offers, else no verdict. Only Best Buy results get verdicts, because of store terms. eBay listings are shown separately and never rated. The store's "regular price" is never used as a reference. Order depends only on value to the shopper. There are no affiliate links and no paid placement. |
| `privacy.md` | Searching needs no account. Signing in stores your email and sign-in identity with Supabase, shared with cloudcodetree.com. Your watchlist and saved searches are stored privately, readable only by your account. The front end sets no cookies, and sign-in keeps its session in your browser's local storage. The heading "Draft: final policy lands before launch" stays until Plan 5 replaces it. |

- [ ] **Step 1: Write the failing tests**

```ts
test("how we rank explains both signals and the eBay rule", async ({ page }) => {
  await stubApi(page, {});
  await page.goto("/how-we-rank");
  for (const phrase of [/median/i, /fair price/i, /eBay listings are shown separately/i, /regular price/i, /no affiliate links/i])
    await expect(page.locator("main")).toContainText(phrase);
});
test("privacy page states only what is true now", async ({ page }) => {
  await stubApi(page, {});
  await page.goto("/privacy");
  await expect(page.locator("main")).toContainText("Searching needs no account");
  await expect(page.locator("main")).toContainText(/sets no cookies/i);
  await expect(page.locator("main")).not.toContainText(/email alerts|Sentry|Resend/i);   // Plan 5 adds these
});
test("shopper pages set no cookies and call no third parties", async ({ page, context }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => { if (r.resourceType() !== "image") hosts.add(new URL(r.url()).host); });
  await stubApi(page, { config: CONFIG, search: SHOP_LIVE, watchlist: WATCHLIST_TWO });
  await signedIn(page, { sub: "u-1", email: "a@b.com", token: "tok-1" });
  for (const path of ["/", "/?q=headphones", "/check", "/watchlist", "/saved", "/how-we-rank", "/privacy"])
    await page.goto(path);
  expect(await context.cookies()).toEqual([]);
  expect([...hosts].filter((h) => !["127.0.0.1:4173", "demo-ref.supabase.co"].includes(h))).toEqual([]);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx playwright test e2e/pages.spec.ts --project=desktop`
Expected: FAIL. The pages are placeholders.

- [ ] **Step 3: Implement** `ContentPage` and the two files with the statements in the table, in plain sentences.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx playwright test e2e/pages.spec.ts`
Expected: pass in both projects.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/content/ frontend/src/pages/ContentPage.tsx frontend/e2e/pages.spec.ts
git commit -m "feat(frontend): how-we-rank and draft privacy pages; no cookies, no third parties"
```

---

### Task 8: Accessibility in CI, the 375 px check, and a live run

**Files:**
- Create: `frontend/e2e/a11y.spec.ts`
- Modify: `frontend/e2e/live.spec.ts` (new shape, still opt-in with `E2E_LIVE=1`)
- Modify: `.github/workflows/ci.yml` (a `frontend` job)
- Modify: `frontend/README.md`

**Interfaces:**
- Consumes: every page and fixture from Tasks 3-7.
- Produces:
  - CI job `frontend`: `actions/setup-node@v4` with Node 22, `npm ci`, `npx playwright install --with-deps chromium`, and `npx playwright test` in `frontend/`. A failed run uploads `frontend/playwright-report` as an artifact. The job runs on every push and pull request beside `test`.
  - `live.spec.ts` drives the real backend through the dev proxy. It asserts every `[data-badge]` is one of the four tokens, the eBay box has none, and every card's source starts with `BestBuy` when `DEALFINDER_SOURCES=BestBuy`.

- [ ] **Step 1: Write the failing tests** in `e2e/a11y.spec.ts`

```ts
const VIEWS: [string, Overrides, boolean][] = [   // path, mocks, signed in
  ["/", {}, false], ["/?q=headphones", { search: SHOP_LIVE }, false], ["/check", { check: CHECK_DEAL }, false],
  ["/watchlist", { watchlist: WATCHLIST_TWO }, true], ["/saved", { saved: SAVED_ONE }, true],
  ["/how-we-rank", {}, false], ["/privacy", {}, false],
];
for (const [path, mocks, auth] of VIEWS) {
  test(`axe: no WCAG A/AA violations on ${path}`, async ({ page }) => {
    await stubApi(page, { config: CONFIG, ...mocks });
    if (auth) await signedIn(page, { sub: "u-1", email: "a@b.com", token: "tok-1" });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
test("no horizontal scroll at 375 px", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile-375");
  await stubApi(page, { config: CONFIG, search: SHOP_LIVE });     // includes the 120-character unbroken title
  for (const path of ["/?q=headphones", "/check", "/how-we-rank"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
```

- [ ] **Step 2: Run the tests and see what fails**

Run: `cd frontend && npx playwright test e2e/a11y.spec.ts`
Expected: some FAIL, listing axe rule ids or the scroll check. Record them.

- [ ] **Step 3: Fix every violation in the components.** Never disable an axe rule and never exclude a node. Then add the CI job and update `live.spec.ts` and `frontend/README.md`. The README covers dev (`npm run dev` with the backend on `:8000`), the `/api` proxy, the build to `dist`, and both test modes.

- [ ] **Step 4: Run the whole front-end suite and the Python suite**

Run: `npx playwright test && cd .. && ./.venv/bin/python -m pytest -q`
Expected: all pass in both projects, apart from the owner-pending logo fixme if it still applies.

- [ ] **Step 5: Demo it live in the browser** (standing rule: every new capability is shown in the real app)

1. Start the backend from Plans 1-3: `docker-compose up -d db && python -m dealfinder.migrate && DEALFINDER_SOURCES=BestBuy ./.venv/bin/uvicorn dealfinder.serve:app --port 8000`, with `BESTBUY_API_KEY`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` set.
2. Run `cd frontend && npm run dev -- --host 127.0.0.1`, then open `http://127.0.0.1:5173/?q=noise%20cancelling%20headphones`.
3. Check: Best Buy results with badges and reasons, the Best Buy logo, the eBay box only if eBay keys are set, and no console errors.
4. Sign in with a magic link, watch one result, and open `/watchlist`.
5. Run `E2E_LIVE=1 npx playwright test e2e/live.spec.ts --project=desktop`.
6. Take chrome-devtools screenshots of `/`, `/check`, `/watchlist` and `/lab`, at 1280 px and 375 px, and attach them to the PR.

- [ ] **Step 6: Commit and open the PR**

```bash
git add frontend/e2e/a11y.spec.ts frontend/e2e/live.spec.ts .github/workflows/ci.yml frontend/README.md
git commit -m "test(frontend): axe WCAG AA and 375 px checks in CI; live spec on the new shape"
git push -u origin feat/launch-p4-frontend && gh pr create --fill
```

Merging needs the owner's explicit go: "reply 'you do it'".
