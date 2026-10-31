# DealFinder: public launch + finishing the "Become a Full-Stack AI Engineer" course

**Date:** 2026-10-25
**Amended:** 2026-10-27. The launch ships without Best Buy (§2). 2026-10-31: staging host until launch (§2).
**Status:** Ready for owner approval
**Research behind every claim here:** `docs/superpowers/plans/2026-10-25-dealfinder-launch-research.md`
**Repos:** product = `github.com/cloudcodetree/tutorial-dealfinder` (local `~/Development/tutorial-dealfinder`, HEAD `20b3fd5`); course = this repo (`app/tutorials/(article)/dealfinder-part-NN/page.draft.mdx`, all 37 held).

---

## 1. Intent

The course teaches someone to become a full-stack AI engineer by building one product, DealFinder. Today the product and the course have drifted apart: the step tags predate the code, ten lessons describe code that does not exist, and the newest product work is untaught. Nothing can be published in that state.

The owner wants two things, in this order:

1. **Get DealFinder to a final, launched state**, so the course's output is known and real.
2. **Finish and polish the course against that final product**, then publish.

**Why it matters (owner's words, paraphrased):** success is the published course plus a live product a recruiter or learner can try. Users and revenue are a bonus. The owner is also job-hunting for Staff/Principal AI-platform roles, so the product is a portfolio piece; it must never be broken or embarrassing when someone opens it.

## 2. Decisions the owner made (do not revisit without asking)

| Topic | Decision |
|---|---|
| Which course | "Become a Full-Stack AI Engineer" (DealFinder). Not the Claude Code "Zero to Hero" course in `tutorial-generator`, which is out of scope. |
| Scope | Finish the consumer-SaaS launch gate in `ROADMAP.md`; the course grows to teach it. |
| Launch type | Real public launch, promoted. |
| Revenue | **Skipped for now.** No affiliate links, disclosure, click tracking or affiliate-network sign-ups. |
| Success | Course + portfolio first. Reliability and accuracy are the bar, not traffic. |
| Budget | **$0 per month** for hosting and APIs. |
| Address | `deals.cloudcodetree.com` |
| Deadline | None. Ships when it meets the bar. |
| What a visitor sees | Shopper front page (search, verdicts, watchlist) plus an **"Under the hood" lab** that shows the pipeline, evals and models live, each panel linking to the lesson that builds it. |
| Live data | **Verdicts only where store terms allow.** At launch that is Best Buy only. eBay listings appear in their own box with no verdict. RapidAPI shopping, Amazon, Shopify stores and iTunes are off. |
| Hosting | **Google Cloud Run free tier, with deal pages served static from Cloudflare.** |
| If Best Buy can't carry verdicts | Verdicts move to a **"check a deal"** mode: the shopper types a product and price and gets the verdict. Best Buy search still runs, without verdicts. |
| Best Buy key (2026-10-27) | **Launch without Best Buy for now.** The key registered on 2026-07-02 is still pending, and Best Buy's contact form is the only route. The launch front page is Check a deal, plus the lab. Live search, deal pages, the watchlist, saved searches and price alerts wait for a key and ship as a follow-up. Plan 2's Best Buy code stays. Production runs with no Best Buy key and `DEALFINDER_VERDICT_MODE=check`. |
| Staging host (2026-10-31) | **Before launch the product runs only on `deals.beta.cloudcodetree.com`**, noindexed, as Worker `dealfinder-edge-staging`. `deals.cloudcodetree.com` has no DNS record until the launch plan adds a production environment. The first deploy had put the unfinished dev UI on the launch hostname, reachable by anyone. |
| Teaching snapshot | **Kept** as the teaching and training data, **minus the image URLs**, which are removed from the committed file and the lab. |
| Supabase | **DealFinder shares the site's `cct-demos` project**: one sign-in across cloudcodetree.com and DealFinder, $0. The free plan's two active slots are taken by `homestead-finder` and `cct-demos`. |
| Payments lesson (P34) | **Stripe in test mode**: real code, committed and tested, never switched on in the live product. |

## 3. Goals

**Product**
- G1. Anyone can search at `deals.cloudcodetree.com` with no sign-up and get Best Buy results with a fair-price verdict, plus an eBay box without one.
- G2. Signed-in users (Google, GitHub, magic link) keep a watchlist and saved searches, and get a price-drop email that really arrives.
- G3. Deal pages are static HTML at Cloudflare, fast and up even when the backend is cold.
- G4. The "Under the hood" lab runs the real pipeline, eval and model views.
- G5. Every launch-gate item in `ROADMAP.md` is real (enforced in the request path and tested), not demo-depth. The current state of each is in research §1. The gate is first rewritten to match this design: affiliate compliance is removed while revenue is skipped; cookie consent becomes "required only if a non-essential cookie is ever added; none at launch"; async/horizontal becomes "heavy work in scheduled jobs, capped horizontal scaling, no queue at launch"; cost documentation covers the cloud components.
- G6. The monthly bill is $0, proven by a full month of GCP and Cloudflare billing reports.

> **Amended 2026-10-27 (§2, Best Buy key).** G1, G2 and G3 wait for a Best Buy key. Until then the launch goal is: anyone can check a price at `deals.cloudcodetree.com` with no sign-up and get a fair-price verdict from the price model, and the lab runs live. G4, G5 and G6 stand.

**Course**
- G7. Every lesson's code, quoted output and screenshots are generated from the companion repo at that lesson's step, and CI fails when they drift.
- G8. Every step tag exists, matches its lesson and passes its tests in CI.
- G9. Zero fabricated code and zero "illustrative" sections. Research §2 lists the known ones.
- G10. The course teaches the launch work, including the final UI, per-user isolation, the watchlist, the layered fair-price estimator, and the store-license constraints that shaped the product.
- G11. The owner walks through every lesson personally before release (standing publish gate).

## 4. Non-goals

- Revenue of any kind (affiliate, ads, paid plans). Part 34 still teaches billing (see §7.4).
- Amazon, Shopify-store or Google Shopping data on the live site.
- Price history beyond what store terms allow (Best Buy data may not be kept past 72 hours).
- Multi-category coverage. Launch is electronics, the course's domain.
- Growth work beyond the launch posts in §6.9.
- The Claude Code "Zero to Hero" course.

## 5. Anti-goals (would make this a failure even if it works)

- Breaking a data license: a verdict on eBay data, mixing eBay listings into other stores' results, or keeping Best Buy data past 72 hours.
- Any bill above $0 that was not approved first.
- A sign-up wall in front of search (Show HN bans this).
- A lesson that quotes code, output or a screenshot that does not come from the real repo.
- Breaking the learner's guarantee: the whole course still runs at $0 on a modest laptop (`COST.md`, `RESOURCES.md`, ROADMAP principle 6).
- Ranking influenced by anything other than value to the shopper.
- A live demo a recruiter opens and finds broken: an empty result, a 500, a stale page.

## 6. Product design

### 6.1 Shape

```
browser ──► deals.cloudcodetree.com  (Cloudflare Worker, zone managed by infra/ OpenTofu)
              ├─ /, /deal/<slug>, /how-we-rank, /privacy  → static HTML + assets (R2 or Workers Static Assets)
              ├─ /api/*  → Cloud Run service (FastAPI), with edge cache + rate limit
              └─ /lab/*  → Cloud Run service (lab UI + inspectors)
Cloud Scheduler ──► Cloud Run job(s): refresh catalog + rebuild static deal pages, re-price watchlists + send alerts, keep-alives
Supabase `cct-demos` (shared with the site): Postgres + pgvector + Auth      Resend (free): email      Sentry (free): errors      Healthchecks.io (free): dead-man's switch
```

### 6.2 Data and verdicts

- **Best Buy** is the only verdict source. Its pricing-analysis ban covers analysis done for other retailers, not for shoppers. The open risk is the "derivative works of the Service or the Content" clause; if Best Buy cannot carry verdicts (no key granted, or the clause is read to cover verdicts), verdicts move to the "check a deal" mode in §2 and live Best Buy results show without verdicts. In that case deal pages carry no verdict and stay `noindex`, so search-engine discovery is weak; that trade-off is accepted. Conditions from its terms (research §3): show Best Buy attribution and logo on every page and screen that uses its data; never share the data with or for other retailers; delete every Best Buy row and every page built from it within 72 hours of fetching. Static deal pages are therefore rebuilt at least every 72 hours, and a page whose item is no longer refreshed is removed, not left stale.
- **eBay** results render in a visually separate "Also on eBay" box with no verdict, no score, no ranking against other stores, and no embedding. They are fetched at request time or cached at most 6 hours. eBay content is never used to train, tune or evaluate any model. Production Browse API access needs eBay approval; launch does not block on it, and the box is hidden if access is not granted.
- **The fair price** comes from the layered estimator that exists today (`/ranked`: trained per-category model → peer estimate → value-only). The model is trained on the frozen 270-item snapshot, which came from RapidAPI and Apify Google Shopping results. That snapshot stays the course's teaching dataset and the model's training data (owner decision). Its `image_url` fields are stripped from the committed file and never shown in the lab; any lesson or test that reads them is updated.
- **Price history** is limited to what the terms allow, so "lowest in 30/90 days" is not shown for Best Buy items. A verdict explains itself in plain words (for example "N% below our fair price for this model", with N from the real estimator), and the seller's "was" price is never trusted as the reference.

### 6.3 Shopper front end

- One public front end, built to static assets and served by the Worker. *Builder's call, see §8:* rebuild the shopper page in the existing React + Vite app (`frontend/`, which Part 31 teaches and which already has the Supabase client), using the Nocturne design tokens from `dealfinder/static/redesign.html`. Retire `dealfinder/static/index.html` as a product UI. Its 18-mode selector moves into the lab.
- Search works anonymously. Sign-in is optional and only unlocks the watchlist, saved searches and alerts.
- Accessibility is a launch requirement: axe in CI with no WCAG AA violations, a 375 px viewport check, a text equivalent for any struck-through price, and contrast-checked verdict badges.

### 6.4 Static-first deal pages

- A scheduled job renders one HTML page per tracked product (`/deal/<slug>`) with schema.org `Product` markup, Open Graph tags and a sitemap, and publishes them to Cloudflare.
- A page is `noindex` until it has a verdict. AI-written blurbs are never generated at scale.
- These pages serve even when Cloud Run is cold or down. That is the main reliability answer to a scale-to-zero backend.

### 6.5 Sign-in, watchlist, saved searches, alerts

- Supabase Auth with Google, GitHub and magic link. The backend verifies Supabase JWTs against JWKS (ES256). **Remove the `X-User-Id` header path entirely**; today it lets anyone read or edit any watchlist (`tenancy.py:79-83`).
- Per-user isolation keeps the existing Postgres RLS pattern (`userstore.py`, non-superuser app role).
- **Shared project rules.** DealFinder's tables live in their own `dealfinder` schema, never in `public`. The Cloud Run backend connects through the pooler as a dedicated non-superuser role (`dealfinder_app`) granted only that schema, because superusers bypass RLS. RLS policies key on `auth.uid()`, so a cloudcodetree.com account is a DealFinder account. Migrations stay in the DealFinder repo and run against the `dealfinder` schema only; they never touch the site's tables. pgvector is enabled in the project. DealFinder's data must fit beside the site's within the free plan's 500 MB, which the 72-hour Best Buy limit keeps small; the builder measures it. The site's daily heartbeat (`worker/keepalive.ts`) already keeps the project awake, so DealFinder needs no keep-alive of its own.
- Watchlist prices come from the server, never the client (`serve.py:248` today trusts the client).
- Saved searches get a table and routes.
- A scheduled re-price job checks watchlist and saved-search items against Best Buy and emails a price drop through Resend, with an unsubscribe link. It is idempotent and catches up after a missed run. A Healthchecks.io ping alerts when the last good run is too old.
- **No cron on GitHub Actions.** Its terms bar "part of a serverless application" use. Scheduling is Cloud Scheduler, no keep-alive needed (the site's heartbeat covers the shared project). GitHub Actions stays for build, test and deploy, which its terms allow. Lesson from the site (2026-10-25): an anonymous read did NOT stop the free project from pausing; the site now writes a throttled heartbeat row daily from a Worker Cron Trigger (`worker/keepalive.ts`, migration 0008). DealFinder's keep-alive must also be a write, plus a dead-man's switch.

### 6.6 Request path: performance, cost, abuse

- Edge cache in the Worker for anonymous `/api/search` responses (short TTL), plus a server-side cache for query embeddings.
- Load the embedding model once. Today two copies load (`embed.py:42`, `dedup.py:24`). Bake it into the image so cold starts do not download it.
- Sources run concurrently with timeouts. Use a DB connection pool. Circuit-breaker state must survive multiple instances or be per-instance by design.
- Rate limits at the edge (Cloudflare) and in the app for anonymous routes. `/ask` is rate-limited hardest.
- The LLM is never on the default search path (true today). `/ask` uses a model whose provider does not train on prompts, chosen and disclosed on the privacy page. *Builder: free OpenRouter models may log prompts (research §5). Cloudflare Workers AI is a candidate; verify its free quota and data policy.* Cached `/ask` answers expire, because prices change.
- Cost per query is measured from real provider responses, not a static price table.
- Cloud Run `max-instances` is capped and a GCP budget alert is set at $1, so a traffic spike cannot create a bill.
- **Rate limits.** The zone is on Cloudflare Free, whose one rate-limit rule is already used: `infra/ratelimit.tf` matches `/api/search` on any host at 30 requests per 10 s, so it already covers `deals.cloudcodetree.com/api/search`. The stricter `/ask` limit lives in the deals Worker (a Workers rate-limiting binding if Free allows it, else a small counter) and in the app.
- **No job queue at launch.** Heavy work (catalog refresh, page builds, re-pricing, re-embedding) runs as scheduled Cloud Run jobs, off the request path. Cloud Run scales horizontally up to the capped `max-instances`.
- **Cost docs.** `COST.md` gains every cloud component with its free-tier limit and teardown step, and `scripts/cost_check.py` is extended to report the live GCP and Cloudflare billable footprint.

### 6.7 Observability

- Sentry for errors in the backend and front end.
- Structured request logs with latency and per-request cost.
- The dead-man's switch from §6.5.
- An uptime check on the static site and the API.
- The owner gets an email for any alert.

### 6.8 Privacy, secrets, legal pages

- Collect only an email address and sign-in identity. One-click account delete and data export over the real tables.
- Only essential auth cookies, so no consent banner. Verify this stays true.
- Pages: privacy policy (CalOPPA applies once email is collected), "how we rank", and a note that prices may be stale and AI-written text is AI-written.
- Secrets live in GCP Secret Manager and Cloudflare secrets, never in `.env` on a host or in an image. Per-key spend caps, a call-rate alert, and a rotation runbook.
- GitHub workflows pass event fields through `env:`, never `${{ github.event.* }}` inside `run:`.

### 6.9 Launch

1. Soft launch: public but unpromoted, monitored for one week.
2. Owner walkthrough of the product and the course (§7.6).
3. Course release and promotion in the same week: a cloudcodetree.com write-up, then Show HN (working anonymous demo, no upvote asks), then relevant subreddits under their own rules.

## 7. Course design

### 7.1 Lesson-build pipeline (adopted best practice, builder's call)

The drift came from hand-copied code, hand-laid tags and hand-made screenshots. Replace all three with generated artifacts:

1. **Steps are generated commits.** The companion repo gets a linear history with one `step-NN:` commit per step. A script re-creates every tag from those commits after any change.
2. **Snippets come from the repo.** Lessons include code by named anchor (`# ANCHOR: name` / `# ANCHOR_END: name`) at the lesson's tag through a remark plugin. The site build fails on a missing anchor.
3. **Quoted output is captured.** Every "real output" block is a file the pipeline regenerates by running the step. CI fails when a rerun differs, except for outputs explicitly marked as manual (for example a Colab GPU run).
4. **CI runs every step.** A matrix job checks out each tag, starts the light stack, and runs that step's tests and lesson commands.
5. **Screenshots come from a manifest.** Each lesson lists route, locator and ready-state. Playwright regenerates them per tag with the highlight ring injected, and changes arrive as a PR with image diffs that the owner approves.
6. **Learner checkpoints come from the same tests.** Every lesson ends with `make check STEP=NN`.

### 7.1a Release model (builder's call)

- One repo. At course release, the companion's last step **is** production: `main` = final step = what Cloud Run runs. Deploy and ops code (Cloud Run, Scheduler jobs, Secret Manager wiring, Sentry, the deals Worker) lives in the repo and is taught in "Ship it for $0".
- At release the step tags are frozen as `course-v1`. Tags are never rewritten after release; post-release product work lands as ordinary commits after the last step. A future course v2 is the only time steps are regenerated.
- Before release, regenerating steps is expected and cheap; that is what §7.1 is for.

### 7.1b Course UI progression (builder's call)

- The Nocturne lab shell exists from Part 1 and gains one mode per lesson, so every early lesson demos live in the browser on the final look. The mode selector stays the course's spine (one lesson = one mode).
- `dealfinder/static/index.html` is retired from the course entirely. P18 is rewritten around the lab's streaming shopper mode.
- The public React shopper front end arrives at P31.
- Screenshots at each tag show the lab as it exists at that tag.

### 7.2 Re-grounding all lessons

- Rebuild the step sequence on the final code so each lesson's tag contains exactly what the lesson teaches.
- Fix every fabrication and every "illustrative" section in research §2 against real code.
- Retake every screenshot on the final UI.
- Apply the verified blog findings in research §5. The HIGH and MED ones are expected, each checked before use, because the posts are AI-generated. Notable ones:
  - P14's price-filter bug: "headphones under $150" returns a $359.99 item.
  - P12's stale MCP handshake: the 2026-07-28 spec is stateless.
  - Bootstrap confidence intervals in P10 and P23.
  - P25's incident count.
  - P30's missing Langfuse.
  - Accessibility in P31 and P36.
- Fix the course-wide phase labels and `CourseResultsBoard.tsx` part numbers.

### 7.3 Teaching what is new

- Fold the untaught product work into the lessons that own it:
  - the final UI and the lab into P18 and P31
  - per-user isolation with RLS, plus the JWKS fix, into P32
  - watchlist, saved searches and real alert delivery into P33
  - the real observability stack into P30
  - launch operations into P36
- **New lessons (builder sets final numbering; the scaffolder bumps "Part k of M"):**
  - **Data licenses are requirements.** How eBay's and Best Buy's terms shaped the product: no verdicts on eBay data, the 72-hour rule, attribution. This is the real story of this launch.
  - **Static-first: deal pages at the edge.** Pre-rendered pages, schema.org, noindex rules, staying up when the backend sleeps.
  - **Ship it for $0.** Cloud Run + Cloudflare + Supabase + Secret Manager, budget caps, and the cold-start trade-off with real measured numbers.
- Keep the K8s lesson (P29). Production runs on Cloud Run, so P29 teaches K8s as the path at scale and says so plainly.

### 7.4 Payments (P34)

Revenue is out of the product, but billing is a core SaaS skill. P34 stays and teaches Stripe in test mode against the real code, committed and tested, never switched on in the live product (owner decision). Its currently sketched live routes (`P34:335`) become real, tested test-mode routes.

### 7.5 Standing lesson rules (unchanged)

- Real executed output only.
- Test instructions at every testable step.
- Real annotated screenshots.
- Every lesson ends with "## What you can demo now".
- A bespoke concept animation wherever something is explained, each a different shape.
- Every new capability is demoed live in the browser, not faked with terminal renders.

### 7.6 Publish

The owner walks through every lesson, then the course is released by adding the series to `RELEASED_TUTORIAL_SERIES` and flipping each lesson to `draft: false`. A DealFinder entry is created in `app/projects/manifest.ts` (none exists today), with a write-up page and a generated cover, linking the live site and the course.

## 8. Builder's calls (made in this design; owner can override)

- **Hosting details.**
  - Cloud Run service with `min-instances=0`.
  - Cloud Run jobs plus Cloud Scheduler for scheduled work.
  - Secret Manager for secrets.
  - Supabase: the shared `cct-demos` project (owner decision), `dealfinder` schema, `dealfinder_app` role, reached through the pooler (port 6543).
  - The Worker on the existing Cloudflare zone, managed in `infra/`.
- **Front end.** React + Vite for the shopper page, styled with the Nocturne tokens. The lab is the existing Nocturne HTML served at `/lab`. `index.html` is retired as a product UI.
- **Course pipeline.** The §7.1 pipeline, with steps as generated commits.
- **New lessons.** The three in §7.3, with P29 kept as K8s.
- **Launch order.** The sequence in §6.9.
- **Release model.** §7.1a: one repo, final step = production, tags frozen as `course-v1` at release.
- **Course UI.** §7.1b: Nocturne lab from Part 1, `index.html` retired, React shopper page at P31.
- **Launch gate rewrite.** G5 wording; no queue at launch; rate limits per §6.6.

## 9. Open items for the builder

- **O1. Owner-only setup.** These need the owner's identity, so no agent can do them. The builder tries API routes first, quotes any failure, and asks only for what remains:
  - a GCP account with billing enabled (a card is required even on the free tier)
  - a Best Buy API key
  - eBay developer keys and production access
  - Resend, Sentry and Healthchecks.io accounts
  - Adding `https://deals.cloudcodetree.com` to the shared project's auth redirect allowlist (`scripts/configure-auth.mjs` may do this through the Management API; try it first)
- **O2. Facts to verify before relying on them.** Research marks each as secondary or unconfirmed:
  - the Cloud Run free tier for jobs
  - the Cloud Scheduler free job count
  - the Secret Manager and Artifact Registry free storage, since the image size with the baked model must fit
  - Cloud Run cold-start time with the baked model
  - the Workers AI free quota and data policy

## 10. Done means

- `deals.cloudcodetree.com` meets G1-G6. Every launch-gate box in `ROADMAP.md` is checked with a test or a live check behind it, and one full month of billing reads $0.
- The course meets G7-G11. CI is green for every step tag, every snippet and output check, and every screenshot manifest. The owner has walked every lesson, the series is released, and the launch posts are out.
