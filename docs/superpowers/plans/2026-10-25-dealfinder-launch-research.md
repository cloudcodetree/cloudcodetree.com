# DealFinder launch + course finish — research digest (2026-10-25)

Inputs for `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md`.
Six read-only checks ran on 2026-10-25. Items marked **[verified]** were re-checked
against the primary source in the main session; everything else is a subagent
finding with its cited evidence, not yet re-verified.

Companion repo: `~/Development/tutorial-dealfinder` @ `20b3fd5` (`draft/electronics-regen` == `origin/main`).

---

## 1. Code audit — launch gate vs today's code

| Item | State | Evidence | Left |
|---|---|---|---|
| Sign-in | demo-depth, **unsafe** | `tenancy.py:79-83` trusts any `X-User-Id` header, no env guard. `auth.py:27` HS256 only, no JWKS. Only `/me` uses `require_user` (`serve.py:1170`). React = email+password (`Auth.tsx:58`). Nocturne asks for an id via `prompt()` (`redesign.html:306-312`). | Remove header path; JWKS; OAuth UI |
| Watchlist / saved searches | watchlist partial; saved searches missing | `userstore.py:13-40`, routes `serve.py:256-281`; isolation test skips w/o DB; `last_price` is client-supplied (`serve.py:248`); `SavedSearch` is a dataclass only (`worker.py:42`) | Table + routes; server-side prices |
| Alert delivery | demo-depth | `worker.py:135-154` searches the frozen snapshot; in-memory seen-state; `ConsoleNotifier` prints | Scheduler, live re-pricer, email, unsubscribe |
| Caching / LLM on hot path | cache missing; LLM off default path | `SemanticCache` only in `inference.py:103` demo; LLM only on anonymous `/ask` when `OPENROUTER_API_KEY` set (`rag.py:329`) | Cache results + embeddings; gate `/ask` |
| Rate limiting | demo-depth | limiter only in `/compliance` demo (`compliance.py:33`, `serve.py:808`) | Edge or middleware limits |
| Async / workers | missing | all routes sync; sources sequential (`aggregate.py:62-66`); Shopify fetches 10 stores per search; Apify 180 s timeout; one uvicorn; new DB connection per call; breaker in process memory | Queue, pool, shared state, workers |
| Observability | demo-depth | `ops.py:12-15` static gpt-4o price table; `/ops` canned | OTel/Sentry, per-request cost |
| Privacy / secrets | demo-depth | in-memory `DataSubjectStore`; no consent UI; `load_dotenv` (`__init__.py:11-13`) | Real export/erase, consent, secret store |
| Affiliate | partial | eBay `affiliateCampaignId` → `itemAffiliateWebUrl` (`live_sources.py:245-264`); links direct; no click log, disclosure, `rel="sponsored"` | Redirect + click log, disclosure |
| SEO | missing | `/deal/{id}` JSON over snapshot only; all UIs client-rendered; no sitemap/robots/schema.org/OG | Server-rendered deal pages from stored prices |
| Sources | real, thin with no keys | keyless: Shopify (10 lifestyle stores), iTunes; free key: eBay, RapidAPI, BestBuy; paid flag: Apify, Amazon, Firecrawl. No keys: "noise cancelling headphones" → only iTunes songs (9.8 s). Snapshot is NOT a `/search` fallback (`aggregate.py:68-71`); `COST.md:20` claims otherwise | Keys, cache, data strategy (see §3) |
| UIs | — | `/` index.html = 18-mode course lab; `/redesign` Nocturne = closest to a shopper page (`/ranked` + `/watchlist`); React `frontend/` = `/search*` + `/me` only, not served or built | Split Nocturne into shopper page + lab |
| Footprint | measured (light) | RSS idle 106 MB → first embed 295 MB → both fastembed copies 415 MB → peak 532 MB after `/mlops`. Two model copies (`embed.py:42`, `dedup.py:24`). Model = `qdrant/bge-small-en-v1.5-onnx-q` 66.5 MB (comment says ~130 MB). Cache in `$TMPDIR` re-downloads on cold start | Dedupe model, bake into image, >532 MB limit |
| Deploy | demo-depth | root user, fixed port; model not baked; `render.yaml` 9 lines; static `/healthz`; DDL at import (`serve.py:36-42`) silently sets `_DB=False` on failure; no migrations | Migrations, real healthz, env manifest |
| Tests | real | 226 passed, 11 skipped (DB, torch, mlflow, Prefect) | — |

## 2. Lesson inventory — 37 lessons vs the code

- **Step tags are broken.** All 38 tags created 2026-06-29..07-02, before the electronics regen; 70 commits after `step-38`. Only Parts 12, 25, 28 cite a tag containing their main module. 24 lesson files are in no tag (incl. the snapshot). Lessons cite 18 tag names that don't exist (`step-3`, `step-04a/b`, `step-28a/b/c`, `step-31a/b/c`, `step-33a-d`, …).
- **Lessons describing code that doesn't exist:** P16:214-239 (5 tests replaced in `25edaa5`); P13:54,401-422 (`semantic_search` MCP tool); P13:228-230,474 (`data/embeddings.npy`, `ids.json`); P13:173,198 (pgstore signatures without `tenant`); P18:22,54,123 (`StaticFiles` mount, async `aggregate_stream`); P26:377 (`/api/stream`, `SSEStream`); P30:48,70-90 (Langfuse `@observe()` — no Langfuse in repo); P7:428,519 (`source_trust_weight`, `asyncio.gather`); P32:231 (`require_plan_quota`); P3:289, P25:302, P31:74, P12:309 (`companions/dealfinder/...` paths).
- **"Illustrative" (breaks the real-output rule):** P33:353 persistence, P34:335 live routes, P35:355 middleware wiring, P10:318 held-out results + loss curve.
- **Screenshots:** 38 total — 22 original UI at `/`, 13 terminal, 1 Swagger, 1 React SPA, 1 Playwright report, 0 Nocturne. P8/13/14/15 shots show only 3 mode radios (UI now has 18).
- **Untaught final-code features:** Nocturne/`/redesign`, watchlist, `/ranked` (layered fair-price), RLS/tenancy — 0 lessons each.
- **Phase labels inconsistent:** MDX names Phase 1/4/6; `CourseHomeCard.tsx:10` lists 10 phase labels; `CourseResultsBoard.tsx` uses old part numbers (GBDT = '17', now Part 21).
- **Existing coverage of launch topics:** auth P32 (+P31 Supabase section); saved searches P33 (illustrative); alerts P33 `Notifier` seam, P20 Prefect, P30 budget alerts; caching P26/P27; rate limiting P35 (illustrative); payments P34 (sketched); observability P30, P36; privacy P35, P25; deploy P28, P29, P36; front end P18 (vanilla SSE), P31 (React), P36 (Playwright).

## 3. Terms + $0 hosting

| Item | Verdict | Condition / limit | Source |
|---|---|---|---|
| HF Spaces CPU Basic **[verified]** | not allowed at $0 | "creating a new Space that runs on compute (Gradio or Docker) requires a paid plan." PRO $9/mo. Free hardware sleeps after 48 h idle. Disk lost on restart. | https://huggingface.co/docs/hub/spaces-gpus |
| HF custom domain / proxy | not allowed | custom domain is PRO; content policy bans proxies used to bypass restrictions | https://huggingface.co/content-policy |
| Oracle Always Free A1 | OK with conditions | 2 OCPU / 12 GB / 200 GB; reclaimed if CPU p95, network and memory all < 20% for 7 days; capacity errors | https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm |
| Cloud Run free | OK with conditions | 180k vCPU-s, 360k GB-s, 2M req/mo; scales to zero (cold starts) | https://docs.cloud.google.com/free/docs/free-cloud-features |
| Koyeb / Render free | not viable | 512 MB, sleep, "not for production" | https://www.koyeb.com/docs/reference/instances, https://render.com/docs/free |
| Cloudflare Workers free | OK with conditions | 100k req/day, 10 ms CPU, 128 MB | https://developers.cloudflare.com/workers/platform/limits/ |
| Supabase free | OK with conditions | 500 MB DB, 50k MAU, 2 projects, paused after 1 week idle, no backups | https://supabase.com/pricing |
| Upstash / Resend / Sentry free | OK | 500k cmds/mo; 3,000 mails/mo (100/day); 5k errors | vendor pricing pages |
| GitHub Actions cron **[verified]** | not for this use | "don't use Actions as a content delivery network or as part of a serverless application"; cron disabled after 60 days of repo inactivity | https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features |
| eBay Browse + EPN **[verified]** | blocks the verdict | §9.5 may not "use eBay Content … to suggest or model prices"; §9.10 no "train algorithms, conduct machine learning"; §8.1(b) "may not be co-mingled or combined with non-eBay Content"; §8.1(c) listings ≤ 6 h old | https://www.edp.ebay.com/join/api-license-agreement |
| Best Buy API **[verified]** | OK for shopper-facing verdicts; open risk = "derivative works" | the pricing-analysis ban applies only "on behalf of or for the benefit of any third party (such as other retailers)" (close read 2026-10-25); separate clause bars "create derivative works of the Service or the Content"; no ML/training clause; cache ≤ 72 h; logo on every page; 50k calls/day, 5/s; terms dated 2021-02-23 | https://developer.bestbuy.com/legal |
| Apple Search API | not useful | only to promote Apple store content | https://performance-partners.apple.com/search-api |
| Shopify `/products.json` | unclear | API terms ban systematic collection; each store's terms apply | https://www.shopify.com/legal/api-terms |
| Amazon | links only at launch | Creators API needs 10 qualifying sales in 30 days; 24 h cache; comparisons must show Amazon's lowest price | https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction |
| FTC disclosure | OK with conditions | "clearly and conspicuously", next to the link; "paid link" adequate | https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking |
| CCPA / GDPR / cookies | light | CCPA thresholds not met by a tiny site; GDPR: mere accessibility insufficient; essential auth cookies need no consent; CalOPPA privacy policy needed if collecting email | https://cppa.ca.gov/regulations/cpi_adjustment.html |

**Training snapshot provenance [verified]:** `data/snapshots/electronics-2026-07.json`, 270 rows, every row from `RapidAPI:*` or `Apify:*` (Google Shopping results). eBay was dropped at build time (sandbox data).

## 4. Best practices

**Course**
1. Steps as generated commits on a linear branch; a script re-tags after any rebase (gitorial, Tortilla; FSDL labs and TutorialKit use folder-per-step instead).
2. Snippets included from the repo by named anchor at the lesson's tag; build fails on a missing anchor (mdBook `{{#include file:anchor}}`; EF Core docs prefer named regions).
3. Quoted output captured to files and re-checked in CI (Rust book `output.txt` + `update-rustc.sh`; cog `--check`; pytest-examples).
4. CI runs every step (Runme on Linkerd docs; nbdev_test).
5. Screenshots regenerated in CI from a per-lesson manifest, human-approved via image-diff PR (Datasette + shot-scraper).
6. Pin the toolchain (uv lock + pinned base image); scheduled upgrade PR reruns 3-5.
7. Learner checkpoints from the same tests (`make check STEP=NN`; CodeCrafters testers).
8. Measure learning: 2-3 "why" questions per lesson via `/api/engage`; track dropout (Brown Rust-book quiz study).
9. 2026 curriculum gaps: error analysis with LLM judges calibrated to human labels; OTel GenAI tracing; OWASP LLM Top 10 2025 mapping; simplest-agent-first; data/model tests.

**Product**
1. Static-first: deal pages served cached/static at Cloudflare; backend only for search + alerts; scheduled jobs ping a dead-man's switch (Healthchecks.io).
2. Fair price from our own observed history ("lowest in 30/90 days"), never the seller's "was" price (EU 30-day rule, Which? Black Friday study).
3. No-signup demo (Show HN bans signup walls; PH self-hunt OK, no upvote asks).
4. Index only pages with original data; noindex until a product has history + a verdict; no AI blurbs at scale (Google spam policies).
5. Rank independent of commission; "how we rank" page; label every affiliate link; "report bad deal" feeds evals (Honey, Slickdeals).
6. Narrow catalog; own the alert channel (email/RSS).
7. Minimal privacy pack: email only, one privacy notice, one disclosure page, one-click delete.

## 5. AI News blog findings (production, 2026-08-04 → 10-23, 576 posts)

Blog posts are AI-generated; "verify" = check before use.

**Launch**
- **HIGH** Free OpenRouter models may log prompts for training — check each `:free` model's policy and disclose before shopper `/ask` text goes there. [08-31 openrouter-hosted-inference-model-routing; 08-24 ox-alpha] verify
- **HIGH** Keys in public repos/images harvested within minutes — host secrets, per-key spend caps, call-rate alerts, rotation runbook. [09-15 anthropic-threat-intelligence-api-keys-agents] verify
- **HIGH** Scheduler outages (GitHub Actions down 7h47m on Aug 17) — alert when the last good re-check is stale; next run catches up. [08-22 github-aug17-outage] verify
- **HIGH** Supabase: connect via the pooler (6543) — some hosts can't reach the IPv6 direct connection. [10-12 pgvector-supabase-vecs] verify on our host
- **HIGH** Per-request cost from the provider response, not a static table (OpenRouter fee, long-context pricing, cache reads). [09-21, 10-09 openrouter; 10-08 haiku-5-5] verify
- **MED** Hash embedded text; re-embed only changed rows; bulk-delete guard so a failed scrape can't wipe listings. [08-21 rag-incremental-index-recordmanager; 10-09 record-manager]
- **MED** Cached `/ask` answers need a TTL (stale prices). [09-24 semantic-caching-gptcache]
- **MED** OpenRouter `provider.max_price` cap so no fallback reaches a paid route. [08-31; 08-17 stripe-openrouter] verify
- **MED** Workflows pass event fields via `env:`, never `${{ github.event.* }}` inside `run:`. [08-23 wiz-red-agent-ci-security]
- **MED** Accessibility: axe in CI, 375px project, text equivalent for struck-through "was" prices, contrast-checked verdict badges. [08-18, 09-08, 10-11, 10-22]
- **MED** Limit scraper/agent egress at the Docker network level. [10-15, 10-11 anthropic sandbox posts] verify
- **LOW** Workers AI binding as a free LLM fallback in the Worker; pin model id, alert on 404. [10-08 cloudflare-workers-ai-binding] verify quota
- **LOW** HF acquisition by Nvidia (closes H1 2027) — keep a named fallback host. [09-05] verify
- **LOW** Disclose AI-written text (DealFinder's models are not watermarked). [08-27, 08-22 eu-ai-act] verify

**Course**
- **HIGH P14** "headphones under $150" returns the $359.99 Bose — parse the query into validated metadata filters first (reuse P11 `nl_to_sql`); tenant filter always added in code. [09-28, 10-16 self-query-retriever]
- **MED P10/P23** Bootstrap paired score differences; ship only if the CI lower bound > 0 (P10 n=33, P23 n=20). [09-18 evaluate-fine-tuned-llm-three-tier-holdout]
- **MED P12** MCP 2026-07-28 spec is stateless — "The real protocol handshake" step and alt text are stale; error code -32002 → -32602; `ttlMs`/`cacheScope`; RFC 9207 `iss` (P32). [08-04, 08-22 mcp stateless spec] verify by rerunning the client
- **MED P12** `${VAR}` references in `.mcp.json`, never raw keys (GitGuardian: 24,008 secrets in public MCP configs). [10-04 gitguardian; 10-03 infostealers] verify numbers
- **MED P13** Hash-based incremental re-embed (above).
- **MED P14** Structured `cited_ids` instead of the `_title_cited` heuristic. [10-21 citation-aware-rag] verify
- **MED P25** Callout says "three cases" — a fourth was disclosed Sep 9; map OpenAI's post-mortem failures (proxy zero-day, broad egress, over-scoped file tool, goal persistence) to P25 layers. [09-10, 08-29] verify
- **MED P30** Langfuse `langfuse.decorators.observe` import is likely gone in SDK v3 — and the repo has no Langfuse at all (see §2). [08-31 langfuse] verify
- **MED P10** GRPO sidebar with P6's Pydantic gate as the reward. [09-08 grpo-structured-output] verify numbers
- **MED P31/P36** No accessibility coverage anywhere — add axe + responsive checks.
- **LOW P10** `save_steps=50` for Colab disconnects; `target_modules="all-linear"`; push only the adapter. [09-10, 08-26, 09-15] verify
- **LOW P16/P24** Newer models reject `budget_tokens` (adaptive thinking). [10-05] verify
- **LOW P11/P12** Tool descriptions: when to call, when not, side effects, return shape. [09-07]
- **LOW P15** Force tool on retrieval turns; `required` for OpenAI-compatible clients. [08-16, 08-30] verify per provider
- **LOW P16/P17** Planner/generator/evaluator with handoff files; separate evaluator. [08-14]
- **LOW P26/P29** Modal scale-to-zero serving; llm-d prefix-aware routing. [10-18, 10-22] verify
- **LOW** Batch API limits conflict between posts (100k vs 10k) — verify before using. [09-23, 10-11]

Full per-post URLs: `https://cloudcodetree.com/ai-news/<id>/` (ids above are abbreviated by date + slug).
