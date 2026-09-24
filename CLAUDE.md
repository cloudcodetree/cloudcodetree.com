# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is CloudCodeTree's professional portfolio website built with Next.js 15 (App Router), React 19, and TypeScript, statically exported and served by one Cloudflare Worker (`cct-site`, Workers Static Assets — see "Deployment"). It showcases the professional profile of Chris Harper, a Principal Software Engineering Manager with extensive experience leading enterprise teams and cloud architecture initiatives. Features include:

- **Dark Professional Theme**: Uses Material-UI v7 with custom dark theme, glass morphism effects, and gradient accents
- **Hero Landing Page**: Professional intro with avatar, skills showcase, and service offerings
- **Resume Section**: Interactive resume showcasing extensive engineering leadership experience with multiple format downloads
- **AI News Blog**: Statically rendered markdown blog fed by an RSS ingest pipeline (see "Blog" below)
- **Contact Form**: Web3Forms-backed contact form and professional contact methods
- **Interview Scheduling**: Calendly integration for professional consultations
- **Responsive Design**: Mobile-first design with glass morphism, animations, and modern CSS
- **Custom Domain**: cloudcodetree.com on a Cloudflare zone (nameservers moved 2026-09-03; Amazon Registrar still holds the registration)
- **SEO Optimized**: Next.js Metadata API (per-page titles/descriptions, per-post Open Graph images, canonicals) + build-time sitemap.xml and RSS feed
- **Performance Optimized**: Static export, build-time blog rendering, slim client-paginated list index

## Development Commands

```bash
# Install dependencies
pnpm install

# Start development server (webpack) at http://localhost:3000. Turbopack cannot start
# this project (@next/mdx registers a non-serializable rule) — it lives behind dev:turbo.
pnpm run dev

# Build the static export (outputs to ./out)
pnpm run build

# Serve the production build locally
pnpm run start

# Lint code
pnpm run lint

# Worker unit tests + worker typecheck
pnpm test
pnpm run typecheck:worker

# Staging: every tutorial draft + preview banner + noindex → beta.cloudcodetree.com
pnpm run build:staging && pnpm run deploy:staging

# Production: build + vendor the demo builds → cct-site. Both deploy scripts first
# assert the build variant (a prod build deployed to staging once blanked beta).
pnpm run build && node scripts/fetch-demo-artifacts.mjs && pnpm run deploy:prod

# Acceptance test against any origin: 28-case contract, --sweep adds every sitemap URL
node scripts/check-parity.mjs --origin https://beta.cloudcodetree.com --sweep
```

> Note: production deploys are automatic — pushing to `main` triggers
> `.github/workflows/deploy.yml` (re-host blog images → build → deploy the Worker).
> GitHub Pages was retired on 2026-09-05; there is no gh-pages path any more.

## Architecture

### Tech Stack
- **Framework**: Next.js 15 (App Router) with static export (`output: 'export'` → `./out`)
- **Frontend**: React 19, TypeScript
- **UI Library**: Material-UI (MUI) v7 with custom dark theme (Emotion SSR cache)
- **CSS**: Tailwind CSS v3 with custom configuration
- **Routing**: Next.js App Router (file-based, under `app/`)
- **Animation**: Framer Motion
- **Markdown**: React Markdown with remark-gfm
- **Deployment**: GitHub Actions → Cloudflare Worker `cct-site` (Workers Static Assets + the small gateway in `worker/`); staging Worker `cct-site-staging` = beta.cloudcodetree.com
- **Domain**: Cloudflare zone `cloudcodetree.com` (DNS, TLS, always-HTTPS); registrar stays Amazon Registrar
- **Identity / analytics**: Supabase project `cct-demos` (sign-in for gated demos, append-only `demo_events`)

> Historical note: this project was migrated from Vite + React Router to Next.js. The
> legacy `src/` tree and Vite-era configs (netlify.toml, vercel.json) were removed in
> June 2026; the live app is the `app/` directory below.

### Project Structure
```
app/                          # Next.js App Router
├── layout.tsx               # Root layout (metadata, providers)
├── page.tsx                 # Home route (/)
├── ai-news/page.tsx         # "AI News" list route (/ai-news) → components/BlogPage (feed + pagination)
├── ai-news/[id]/page.tsx    # Article route (/ai-news/<id>) → components/BlogPost; generateStaticParams from posts.json
├── blog/…                   # Legacy: static redirect stubs (/blog, /blog/<id>) → /ai-news (components/Redirect)
├── resume/page.tsx          # Resume route (/resume)
├── contact/page.tsx         # Contact route (/contact)
├── schedule/page.tsx        # Schedule route (/schedule)
├── components/              # UI components (BlogPage, HomePage, ClientLayout, …)
├── config/                  # Config (calendly.ts)
└── lib/                     # theme.ts, mui.ts, emotionCache.ts, emailObfuscation.ts

scripts/                      # Blog automation (Node; deps: fast-xml-parser, sharp — used by ingest)
├── ingest-feed.mjs          # content/feed.xml (RSS 2.0 + Media RSS) → posts.json + CDN images
├── generate-feeds.mjs       # posts.json → public/feed.xml + sitemap.xml (prebuild + dev)
├── publish-post.mjs         # Manual publishing: draft → posts.json entry (content inline)
├── normalize-tags.mjs       # One-off: canonicalize tags in feed.xml + posts.json (idempotent)
├── trim-feed.mjs            # Keep content/feed.xml to a rolling ~120-item window
└── validate-blog.mjs        # Validate posts.json consistency + tag vocabulary

content/                      # Source feed the Desktop task writes (ingested at publish time)
├── feed.xml                 # RSS 2.0 + Media RSS — source of truth for 2026-06-09 onward
├── search-misses.jsonl      # Committed: aggregate topic miss counters (see "Search analytics")
└── search-misses.state.json # Harvest cursor, so counts are not re-counted per push

.claude/                      # Claude Code project tooling (see "Claude Code Tooling")
├── settings.json            # Hooks + protective deny rules
├── hooks/                   # validate-blog.sh, secret-scan.sh
├── skills/                  # publish-post
├── agents/                  # blog-editor, frontend-reviewer
└── commands/                # /publish-post, /blog-status

public/
├── blog/                    # Blog content
│   └── posts.json          # Index + inlined post bodies (images live on R2: img.cloudcodetree.com)
├── resume/                  # Resume assets
│   └── chris_harper-resume.md
├── resume.pdf              # Protected resume PDF
└── [standard PWA files]    # 404.html, robots.txt, sw.js, etc.
```

### Key Components

**ClientLayout.tsx**: Main application shell featuring:
- Responsive navigation (mobile drawer + desktop horizontal nav)
- Route-based page transitions with Framer Motion animations
- Glass morphism AppBar with backdrop blur effects
- Icon-based navigation with active state styling

**HomePage.tsx**: Professional landing page with:
- Hero section with gradient avatar and typography
- Interactive skills showcase with animated chips
- Services grid highlighting core competencies
- Call-to-action sections for resume and contact

**BlogPage.tsx / BlogPost.tsx**: the AI News blog (see "Blog" below):
- List page paginates client-side from a slim, content-free index the server route
  embeds at build time, with a reader-selectable page size (no per-page fetches)
- Article pages are fully prerendered — the post is passed as a prop by the
  server route (`app/ai-news/[id]/page.tsx`), no client-side fetch
- Markdown rendered via `react-markdown` + `remark-gfm`

**Admin (owner-only)**: `/admin/analytics/` (`app/admin/`, `AnalyticsDashboard`) —
signups by day and provider, demo opens per project, and the recent-activity feed.
The Worker answers `/admin/*` only to the owner's session (404 for everyone else,
including other signed-in visitors); the data comes through the SECURITY DEFINER
function `owner_analytics()` (`supabase/migrations/0004_owner_analytics.sql`), which
refuses any caller not in `site_owners`. `OWNER_USER_ID` lives in `wrangler.jsonc`.

**Theme Configuration**: 
- Custom dark theme with blue/cyan gradient accents (#3b82f6, #06b6d4)
- Glass morphism effects using backdrop-filter and rgba backgrounds
- Responsive typography scaling for mobile/desktop
- Consistent component styling with rounded corners and hover effects

### External Integrations

**Web3Forms** (contact form):
- ContactPage.tsx submits to the Web3Forms API with an access key that is
  client-exposed **by design** (it only routes mail to the configured inbox).
  Spam mitigation is handled by Web3Forms settings, not by hiding the key.

**Calendly Integration**:
- Configured URL: 'https://calendly.com/cloudcodetree'
- Supports both embedded widget and new-tab open

## Deployment

The site is one Cloudflare Worker, `cct-site`, configured in `wrangler.jsonc`. Workers
Static Assets serve `./out`; `worker/index.ts` runs only for `run_worker_first` paths
(`/api/*` and the `/projects/*/demo/*` gate) and on asset misses. `public/_headers`
(the CSP — live on Workers, it was inert on Pages; guarded by `scripts/validate-csp.mjs`)
and `public/_redirects` (legacy Pages paths → successors, bare + splat forms) ship
inside the assets.

### Environments
| | Worker | URL | Build |
|---|---|---|---|
| production | `cct-site` | https://cloudcodetree.com via the apex Worker route | `pnpm run build` + `node scripts/fetch-demo-artifacts.mjs` |
| staging | `cct-site-staging` | https://beta.cloudcodetree.com (also `cct-site-staging.chris-247.workers.dev`) | `pnpm run build:staging` (all tutorial drafts, preview banner, noindex) |

`scripts/assert-variant.mjs` (inside `deploy:staging` / `deploy:prod`) refuses to
deploy the wrong variant. `scripts/check-parity.mjs --origin <url> [--sweep]` is the
acceptance test: a 32-case contract (redirects, feeds, headers, the gate) plus a sweep
of every sitemap URL. HTTP checks cannot see a blank page — pair them with a browser.

### CI (`.github/workflows/deploy.yml`, on push to `main`)
Three jobs: `prepare-images` decodes downloaded images on a separate runner
without deployment credentials; `rehost-images` validates/uploads only prepared
JPEGs and commits image URLs plus aggregate search counters; `build` checks out
that exact commit, runs the dependency audit, lint, unit/type checks, content
validation, production build, and browser regressions. Main pushes vendor demo
artifacts and deploy, then verify parity and browser behavior on production.
PRs run the build/browser checks without publishing. Node 22 and pnpm 11.0.9 are
pinned in `.node-version` and `package.json`. The optional `PEXELS_API_KEY` is
available only to image preparation for stock-photo fallback; Cloudflare write
credentials are confined to the upload and deploy steps.
`node scripts/set-ci-secrets.mjs` sets the variable and both secrets from a token
kept in `.env` (it never prints the token); `node scripts/cf-zone.mjs status|purge|www-redirect`
covers the zone-level chores with the same token. Both environments carry the `ai` (`AI`)
and `vectorize` (`VECTORIZE` → `cct-search`) bindings in `wrangler.jsonc` for search; the CI
token's scopes include Workers AI Read and Vectorize Edit alongside its existing scopes.
Local deploys use `wrangler login` (OAuth) — no token on disk.
`.github/workflows/supabase-keepalive.yml` pings the
Supabase project twice a week so the free tier never pauses it.

### DNS (Cloudflare zone `cloudcodetree.com`)
Nameservers `henrik.ns.cloudflare.com` / `meg.ns.cloudflare.com`, changed at the
**registrar** (Route 53 → Registered domains, not the hosted zone) on 2026-09-03. The
Worker route `cloudcodetree.com/*` serves the apex; a proxied AAAA placeholder
(`100::`) supplies the DNS record required by the route. It replaced the four legacy
GitHub Pages A records on 2026-09-10. `www`
is a zone-level Single Redirect rule (301 to the apex, path + query preserved) — it
is deliberately **not** a Worker route, because the Worker only runs for
`run_worker_first` paths and would otherwise serve duplicate content. MX / SPF / DMARC /
DKIM for Google Workspace live in the zone. **The zone, its settings, every DNS record,
the redirect rule and the R2 bucket are managed by OpenTofu in `infra/`** (`node
scripts/tofu.mjs plan` should say "No changes"; see `infra/README.md`). The Route 53
hosted zone was deleted on 2026-09-05, so `infra/` is the only copy of the DNS outside
Cloudflare. Not in OpenTofu: the Worker (wrangler) and the R2 custom domain
`img.cloudcodetree.com` (not importable in provider 5.x).

### Cutover history
- 2026-09-03: nameservers on Cloudflare; beta rehearsal green.
- 2026-09-04: `draft/dealfinder` merged to `main` (PR #1); production Worker deployed
  from the merged tree.
- 2026-09-05: CI armed, apex route deployed by CI (PR #3) — the site is on the Worker.
  GitHub Pages retired: `public/CNAME`, the gh-pages job, `pnpm run deploy` removed;
  the `gh-pages` branch is kept until ~2026-09-19 as a cold rollback.
- 2026-09-10: repo renamed `cloudcodetree.github.io` → **`cloudcodetree.com`**.
  The old name only ever meant "GitHub Pages site"; renaming away from the
  `<user>.github.io` pattern also made that URL 404 immediately (verified),
  which is what the gh-pages deletion timer was for. GitHub redirects the old
  clone URL indefinitely, and the routine kept publishing across the rename.
  The www CNAME was retargeted from the dead hostname to the apex the same day.
Runbook: `docs/superpowers/plans/2026-08-25-cutover-runbook.md`.

### URLs
- **Production**: `https://cloudcodetree.com/`
- **Staging**: `https://beta.cloudcodetree.com/` (noindex)
- **Development**: `http://localhost:3000/`

## Content Management

### Blog Posts
See the **Blog ("AI News")** section below — posts live inline in
`public/blog/posts.json` and are managed exclusively through the scripts in
`scripts/` (never hand-edited).

### Resume PDF
- Store resume PDF in `public/resume.pdf`
- Contains sensitive contact information (protected by a `.claude` deny rule)

### GitHub Integration
- Projects are curated by hand in `app/projects/manifest.ts` (see "Projects");
  nothing on the site calls the GitHub API at runtime
- No authentication required for public repositories

## Performance Considerations

- **Static export**: every route (incl. all blog articles) is prerendered HTML —
  no server, no client data fetch for article content
- **Slim list index**: the list page embeds a content-free index (no post bodies)
  and paginates client-side, instead of shipping the whole posts.json
- **React 19 / Next 15**: build-time type + lint checks are ON
  (`next.config.js` no longer ignores build errors)
- **Lazy Loading**: Framer Motion animations animate when components enter viewport
- **Image hosting**: blog images live in the R2 bucket `cct-blog-images`, served at
  `https://img.cloudcodetree.com/<id>.jpg` with a one-year immutable cache — never in the repo
- **Service Worker**: Basic service worker (`sw.js`) included for PWA capabilities

## Security Notes

- The Web3Forms access key in ContactPage is public by design (see Integrations)
- No sensitive API keys exposed in client code
- All external links use rel="noopener noreferrer"
- HTTPS enforced at the Cloudflare zone (`always_use_https`, TLS 1.2+)
- `.claude/hooks/secret-scan.sh` blocks commits containing Anthropic/AWS keys or PEMs

## Browser Support

- **Modern Browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **JavaScript**: ES2020+ features (optional chaining, nullish coalescing)
- **CSS Requirements**: 
  - CSS Grid and Flexbox (widely supported)
  - `backdrop-filter` for glass morphism effects (recent browsers)
  - CSS custom properties (CSS variables)
  - CSS `clamp()` for responsive typography
- **Fallbacks**: Glass morphism gracefully degrades without backdrop-filter
- **Mobile Support**: iOS 14+, Android Chrome 90+

## Development Workflow

Use Node 22 and the package-pinned pnpm 11.0.9.

1. **Local Development**: `pnpm run dev` serves at `http://localhost:3000/` with hot
   reload (it first runs `generate-feeds.mjs` so the feed and sitemap exist)
2. **Code Quality**: `pnpm run check` and `pnpm audit`
3. **Type Checking**: enforced during `pnpm run build` (TS + ESLint failures fail the build)
4. **Build**: `pnpm run build` generates the static export in `./out`
5. **Deploy**: push to `main` → GitHub Actions builds and deploys the Worker (manual:
   `pnpm run deploy:prod`); rehearse on beta first with `pnpm run build:staging && pnpm run deploy:staging`
6. **Live Sites**: production `https://cloudcodetree.com/`, staging `https://beta.cloudcodetree.com/`
7. **DNS Management**: the Cloudflare zone (see "Deployment"); OpenTofu in `infra/` once imported
8. **Content Updates**: blog content flows through the feed pipeline (see "Blog")

## Routing & SEO

- **Static export**: every route is a real prerendered HTML file — deep links work
  on Workers Static Assets without SPA redirect tricks (`404.html` is served on misses)
- **Metadata**: Next.js Metadata API — per-page `metadata` exports; blog articles
  get per-post title/description/canonical/Open Graph image via `generateMetadata`
- **Sitemap & feed**: `public/sitemap.xml` + `public/feed.xml` generated at prebuild
  (gitignored), advertised in robots.txt / `<link rel="alternate">`

## Navigation Structure

Nav (`app/components/ClientLayout.tsx`) is **AI News · Tutorials · Projects · About**.
Nav hrefs carry **trailing slashes** deliberately (`/tutorials/`, not `/tutorials`) —
`trailingSlash: true` means the real page is `/x/`, and a bare href costs a
redirect hop (301 on Pages, 307 on Workers) on every click.

**Current Active Routes**:
- `/` - **AI News blog** (the home/front door; `BlogPage`)
- `/ai-news/` - preserved legacy list (canonical → `/`); articles live at `/ai-news/<id>`
- `/tutorials` (+ `/tutorials/<slug>`) - hand-authored **MDX** tutorials (see Tutorials below)
- `/projects` (+ `/projects/<slug>`) - the **Projects gallery** (see Projects below)
- `/about` - the former home page, toned down (`HomePage`); the personal/portfolio hub
- `/about/resume`, `/about/contact`, `/about/schedule` - personal sub-routes
- `/resume`, `/contact`, `/schedule` - redirect stubs → the `/about/*` versions

**Site chrome is opt-in per section**: `app/layout.tsx` renders bare children;
each top-level section adds the AppBar/nav via its own tiny `layout.tsx`
wrapping `ClientLayout` (see `app/tutorials/layout.tsx`, `app/projects/layout.tsx`).
A new section without one ships headerless.

## Projects

`/projects` is a hand-curated gallery of real repos; `/projects/<slug>` are MDX
write-ups. It mirrors the tutorials subsystem:

- **`app/projects/manifest.ts`** is the single source of truth (slug, title,
  summary, tech chips, `repoUrl` — omitted for private repos, `externalUrl`,
  cover, featured/order). Scripts read it via `scripts/lib/projects-data.mjs`;
  keep entries as flat single-quoted object literals. Copy is grounded in each
  repo's README — don't invent capabilities.
- Detail pages live at `app/projects/(detail)/<slug>/page.mdx` with per-page
  `metadata` (canonical + OG cover), styled by `(detail)/layout.tsx`.
- Hero covers are **committed generated assets**
  (`node scripts/generate-project-covers.mjs` → `public/projects/covers/`),
  same precedent as tutorial covers.
- `scripts/generate-feeds.mjs` includes `/projects/` + every slug in the sitemap.
- **Shipped (Phase 2 of the design spec):** auth-gated live demos under
  `/projects/<slug>/demo/`. The Worker gate (`worker/index.ts`) verifies an HttpOnly
  `cct_session` cookie holding a Supabase JWT against JWKS and fails closed; a
  signed-out request bounces to the project's landing page with `?signin=1&next=<demo>`.
  Identity is Supabase (magic link + Google / GitHub / LinkedIn; `app/lib/authConfig.ts`,
  `app/components/demo/`, provider wiring via `scripts/configure-auth.mjs`); analytics
  are append-only `demo_events` under RLS (`supabase/migrations/`, read through the
  private `analytics` views). Sign-in is site-wide chrome (`GlobalAuth` → `AuthWidget`)
  and returns visitors to the page they were on; **only the demos are gated** — the
  gallery and landing pages are public. Spec:
  `docs/superpowers/specs/2026-08-20-projects-gated-demos-design.md`.

## Blog ("AI News")

The blog is labeled **AI News** in the nav and masthead; the route is **`/ai-news`**
(legacy `/blog` and `/blog/<id>` are static redirect stubs → `/ai-news`, via
`app/components/Redirect.tsx`, with `canonical` + `noindex`). It's **static markdown**:
`public/blog/posts.json` is the newest-first index; each entry points at a
post's body **inlined in `posts.json`** (no per-post `.md` files). The only committed blog
asset is `public/blog/posts.json`; **images are not in the repo** — they live in the R2
bucket `cct-blog-images` behind `https://img.cloudcodetree.com` and `posts.json` stores
their URLs (`scripts/lib/r2.mjs` is the one place that knows the bucket and origin).

**Rendering.** The list (`/ai-news`, `app/ai-news/page.tsx` → `BlogPage`) embeds a slim,
content-free index at build time (read from `posts.json` server-side) and paginates
**client-side** from it, with a reader-selectable page size — no per-page fetches; the page
is kept in the URL as `?page=N`. Bodies render via `react-markdown` + `remark-gfm`. Each
post title links to `/ai-news/<id>` (`app/ai-news/[id]/page.tsx` → `BlogPost`); the server
route reads the post at build time and passes it as a prop — article HTML is fully baked,
with per-post Open Graph metadata from `generateMetadata`. Shared types/styling live in
`app/components/blogShared.ts`. All `/ai-news/<id>` pages are pre-rendered via
`generateStaticParams` (required for `output: 'export'`).

**Generated artifacts (emit).** `scripts/generate-feeds.mjs` runs at `prebuild` (and
before `dev`; also `npm run feeds`) and builds, from `posts.json`:
`public/feed.xml` (RSS 2.0 + Media RSS + `content:encoded`; item links point to
`/ai-news/<id>`, images absolute) and `public/sitemap.xml` (static routes + every article).
Both are gitignored (regenerated each build). Per-page JSON chunks were retired — the list
paginates client-side. The feed is discoverable via a `<link rel="alternate">` in
`app/layout.tsx`, the sitemap via robots.txt. This is separate from the **ingest** feed at
`content/feed.xml` (task → site).

**Search + discovery (2026-09).** Hybrid search: keywords in the browser (MiniSearch over
the generated `public/blog/search-index.json`) merged by reciprocal rank fusion with
meaning from `GET /api/search?q=` (`worker/search.ts`: Workers AI `bge-base` embeds the
query, Vectorize index `cct-search` answers; 1 h cache; 503 = keyword-only). The index is
filled by `node scripts/index-search.mjs` in the CI deploy job (diff-based; state =
`search-manifest.json` on the R2 bucket — a FLAT key, since `r2Put` percent-encodes a `/`),
which also writes the generated `public/blog/related.json` behind the **Related** strip on
every article and mirrors it to R2 as `search-related.json`.
`/ai-news/topic/<slug>/` (+ `feed.xml`) exists per tag from `scripts/lib/topics.mjs` — the
ONE slug source for scripts and app code.
A multi-topic feed is served by the Worker at `/ai-news/feed.xml?topics=<slug,slug>`
(merges the per-topic static feeds, newest 20, 1 h edge cache; no `topics` = the static
file). `--dry-run` never touches Cloudflare; no token =
keyword-only + related posts from the last mirror (empty if there is none), never a failed
build.

**Search analytics (2026-09).** Deliberate `/api/search` misses log only
`{event:'search_miss', topic}`. `scripts/lib/search-telemetry.mjs` defines the fixed
allowlist; only exact normalized topic matches get a named bucket, everything
else becomes `other`. No raw query text, snippets, scores, or error messages are
logged. Automatic Worker invocation logs are disabled so URLs cannot reintroduce
query text. The harvester rejects legacy `q` events and publishes only
`{topic, first_seen, count}` to `content/search-misses.jsonl`. Its committed cursor
prevents recounting; failed or saturated windows do not advance it. Telemetry
API failures remain non-blocking, but `validate-blog.mjs` rejects an unsafe public
row. The owner dashboard and editorial routine consume aggregate topic counters.
Old raw rows were removed from the current file; historical commits were not
rewritten.

**Reactions and engagement (2026-09).** Spec:
`docs/superpowers/specs/2026-09-24-reader-reactions-design.md`. Every reader can
like or dislike an article or tutorial lesson. Saves and reads are recorded too.
No counts are ever shown. Two stores, two jobs. `reader_state.reaction`
(migration 0007, own-rows RLS) holds a signed-in reader's own choice. Workers
Analytics Engine (`cct_engagement`, beta `cct_engagement_staging`) holds the
aggregate stream from everyone. The browser posts signed deltas to
`POST /api/engage` (`worker/engage.ts`). The event shape lives in
`scripts/lib/engagement-contract.mjs`, shared by the Worker, the browser and the
future harvester. Signed-in requests send the live Supabase access token as
`Authorization: Bearer`. They do not use `cct_session`, which expires after an
hour and is never re-minted. Anyone else gets a 403, passes invisible Turnstile
once through `/api/engage/clearance` (a 30-minute HMAC cookie, `cct_engage`),
and retries once. A read is 10 visible seconds, sent once per item per browser.
`assert-variant.mjs` refuses a production deploy that carries the Turnstile test
site key. Next specs: the harvester and editorial posts, personal
recommendations, and Slack delivery.

**Listing payloads.** Server routes pass only the first 20 metadata rows and an
archive manifest. `generate-feeds.mjs` emits hashed 100-row metadata chunks and
individual hashed article bodies. `usePostArchive` shares cached metadata requests
and evicts failures for retry. Full-feed view loads Markdown/highlighting lazily
and fetches only the displayed bodies. Keep the full canonical `posts.json` for
existing consumers. Do not put the entire archive back into route props. Listing and main navigation
links disable eager prefetching so unrelated pages cannot load Markdown or auth
code into the homepage.

**Rendering and browser checks.** The MUI App Router cache provider renders a
stable server/client tree and emits styles in the head. Primary content must not
start at opacity zero. Both environments use relative assets; staging is marked
by its noindex header. `pnpm run test:browser` serves the export through Wrangler;
`PLAYWRIGHT_BASE_URL` targets an existing origin. All contact submissions are
mocked, including production tests. Reader-state failures reject and evict the
shared cache; callers display retry UI. Histories are read in 500-row pages.

**Hard rules**
- Post bodies are Markdown stored inline in `posts.json` `content` (no `.md` files, no YAML
  frontmatter). All metadata lives in `posts.json`.
- Dates are `MM-DD-YYYY`. Posts are newest-first.
- `id` == `posts.json` `id` (== the feed `<guid>`).
- `posts.json` entry schema: `id, title, excerpt, author, date, tags[], readTime, content,
  image` plus optional `imageSource` / `dek`. `image` is the R2 URL
  `https://img.cloudcodetree.com/<id>.jpg`, falling back to `…/_default.png`. Images are
  never committed to the repo. (Until 2026-09-05 they lived on the GitHub Release
  `blog-images`; that Release still exists as a cold fallback and `isHosted()` still
  accepts its URLs.)
  Posts are not separated by category (the old `eyebrow` badge was removed).
- **Tags follow a fixed vocabulary** enforced by `validate-blog.mjs`: `AI` on every post,
  exactly one content-type (`News` / `Workflow` / `Tutorial`), plus topic tags from the
  list in `docs/ai-news-feed-contract.md`. A retired tag or a missing content-type is a
  build error; an unrecognized tag is a warning. Rules apply only to posts present in
  `content/feed.xml` — the 150-post pre-06-09 back-catalog is frozen and exempt.
- **Never hand-edit `posts.json`** — go through the scripts below.

**Primary source — an RSS feed (ingestion).** Since the 2026-06-09 cutover, posts come
from a single **RSS 2.0 + Media RSS** feed that the cloud routine maintains at
`content/feed.xml` (committed; not under `public/`).
The full feed format + the routine prompt live in `docs/ai-news-feed-contract.md`. Ingest it
with:
```bash
node scripts/ingest-feed.mjs [content/feed.xml] [--no-images] [--refresh-images]
```
> **`posts.json` is the archive; `feed.xml` is a rolling ~120-item window.** Because
> ingest merges rather than rebuilds, trimming the feed never removes a published
> post. The window exists because each routine run reads the whole feed to dedup, and
> an unbounded file stops fitting in context — silently weakening that guard. Trim
> with `node scripts/trim-feed.mjs`, always AFTER ingest (it only drops items already
> in `posts.json`). Dedup beyond ~2 weeks means searching `posts.json`, not the feed.
> There is no `--out` flag on ingest — it always writes `public/blog/` in place.
> The window lives in `scripts/lib/feed-window.mjs` (one definition, shared by the
> trimmer and the guard). `validate-blog.mjs` **warns** — never fails — once the feed
> passes 1.5× the window, which is the signal that the routine stopped trimming.
Each `<item>` UPSERTS a post keyed by `<guid>` (== `id`): `<content:encoded>` CDATA → the
`content` field (Markdown), `<media:content>`/`<media:thumbnail>` URL → the featured image,
which ingest **downloads, compresses (sharp, 1200px / JPEG q78), and uploads to R2**
(`posts.json` stores the `img.cloudcodetree.com` URL; `imageSource` = `<link>`),
tags from `<category>`. It's a **merge, not a rebuild**: posts not in the feed are preserved.
Idempotent; an image already uploaded for an id is reused unless `--refresh-images`. Requires
`gh` (authenticated) + sharp; without them, posts get the placeholder (CI's
`rehost-images` job fixes those on the next push). The `2026-05-28`–`2026-06-08` posts
are the back-catalog from the retired Desktop-briefings importer (removed June 2026);
they live only in `posts.json` now. `2026-06-09` onward is the feed.

**Auto-publish (cloud).** The **"AI News Publisher" Claude Code cloud routine**
(claude.ai/code/routines) runs **3×/day (≈04:00, 12:00, 20:00 UTC)**; each run is an
independent session whose only shared state is the committed feed — which is why the
contract's volume rules are expressed **per-day** (~8 items is where a run should
start doubting itself, not a cap) and derived by each run from `content/feed.xml`.
The budget is a brake on filler, never a cap on signal: a genuinely new and useful
item is always publishable, and past 8 each one must be justified in the run report. It researches the day's stories, updates
`content/feed.xml` per `docs/ai-news-feed-contract.md`, runs ingest + `validate-blog`,
and commits/pushes — no local machine involved. The routine's environment has no
Cloudflare token, so its posts land with placeholder images; the **`rehost-images`
job in `.github/workflows/deploy.yml`** then uploads the real images to R2 (via the
`CLOUDFLARE_API_TOKEN` secret) and commits the URLs before the same run builds and
deploys.

**Manual fallback.** If the routine is down, publish by hand: edit `content/feed.xml`
per the contract, then `node scripts/ingest-feed.mjs && node scripts/validate-blog.mjs`,
commit `content/feed.xml` + `public/blog/`, and push. (The pre-cloud Desktop-task +
launchd-watcher pipeline was removed in June 2026 — see git history for
`scripts/push-feed.sh` if it's ever needed again.)

**Manual / one-off posts** — drop a `.md` (optionally with frontmatter) and run
`node scripts/publish-post.mjs <file> --commit`, or `--intake ~/Downloads/cct-blog-drafts`,
or the `/publish-post` command.

Validate anytime with `node scripts/validate-blog.mjs` (CI and a hook run this too).
The `rehost-images` CI job also runs `node scripts/validate-research-log.mjs`,
which fails the build if a routine run's research log claims posts that aren't in
`content/feed.xml` (guards the "log says published, content missing" bug).

## Tutorials (hand-authored, separate from the blog)

`/tutorials` is a **hand-written, interactive** learning section, fully decoupled
from the auto-generated AI News blog. **Full convention + how-to: the
`create-tutorial` skill** (`.claude/skills/create-tutorial/`, or run `/new-tutorial`) —
use it to add one. In short:

- Tutorials are **MDX** files at `app/tutorials/(article)/<slug>/page.mdx` (via
  `@next/mdx`; `pageExtensions` includes `mdx`; root `mdx-components.tsx` exposes
  custom components like `<Callout>` from `app/components/mdx/`). List metadata
  lives in `app/tutorials/manifest.ts`; the list UI (`TutorialsList`, cards/list +
  searchable topic flyout + per-page) shares the blog's reader controls. `app/tutorials/layout.tsx` adds site
  chrome; `app/tutorials/(article)/layout.tsx` styles the MDX + back link.
- Each tutorial has a **companion code repo** `github.com/cloudcodetree/tutorial-<slug>`
  (public) where the build is a **step-by-step git-tag progression** (`step-01`,
  `step-02`, …; `main` = final) so learners can check out or diff any step. The
  MDX links the repo + per-step compare URLs.
- Scaffold a whole new tutorial (manifest entry + MDX stub + hero cover, with
  sibling "Part k of M" bumps) with
  `node scripts/scaffold-tutorial.mjs <slug> --series "…" --title "…" --type verified|anchored [--with-repo]`;
  scaffold just the companion repo with
  `node scripts/new-tutorial-repo.mjs <slug> --title "…" [--create-remote]`.
- `app/tutorials/manifest.ts` is the single source of truth; the cover generator and
  scaffolder read it via `scripts/lib/tutorials-data.mjs`. Hero covers are generated by
  `scripts/generate-tutorial-covers.mjs` (committed). `scripts/generate-feeds.mjs`
  auto-discovers tutorial slugs for the sitemap.
- Reader features share `useReaderLibrary`, `ReaderChips`, `TopicsFlyout`, and
  the existing RLS-protected `reader_state` table with the blog. Tutorial IDs are
  `tutorial-<slug>` (the RSS GUID), generated/validated by
  `scripts/lib/tutorial-catalog.mjs`. Existing blog IDs are unchanged. No new
  database table or migration is needed. Saving is per lesson; opening an article
  records `read_at`, not a course-completion claim. Sign-out clears private UI.
- `/tutorials/` keeps the course cards; `/tutorials/all/` and
  `/tutorials/topic/<slug>/` show individual lessons in course order. Search
  (`?q=`), OR topic filters (`?topics=`), pagination (`?page=`), and the existing
  course scope (`?series=`) compose. Layout/page-size/hide-read preferences use
  `tut-*` storage keys independently of the blog.
- Tutorial topic pages, their RSS feeds, and sitemap entries all use
  `tutorialTopics()` from the same catalog helper. `AI` and `Tutorial` are hidden
  categories; unreleased series and draft lessons are excluded. The Worker merges topic feeds at
  `/tutorials/feed.xml?topics=rag,python`, with a cache namespace separate from
  the blog. New manifest topics automatically get pages/feeds on build.
- `/saved/` has Blog and Tutorials tabs; `/saved/?section=tutorials` opens the
  tutorial library. Hide read never hides explicitly saved lessons on this page.
  Browser tests intercept every auth/storage request; they never alter a live
  reader's bookmarks.
- First tutorial: `build-a-rag-over-your-blog` (repo: `tutorial-rag-over-blog`).
- Headings get GitHub-style ids from `rehype-slug` (`next.config.js`), so in-page
  tables of contents link to `#the-heading-text`. A "capture" in a lesson must be
  real output: `node scripts/render-terminal-capture.mjs <out.png> --title '$ cmd' --file lines.txt`
  renders actual terminal lines into the screenshot style — never compose numbers by hand.

## Local multi-repo workspace

`./projects/` (gitignored, never checked in) holds symlinks to every git repo
under `~/Development` — rebuild with `pnpm run link-projects`. It exists so a
session rooted here can work across sibling repos (edit a demo app, bump its
pinned SHA in `app/projects/manifest.ts`, redeploy) while each repo keeps its
own git. Deploys never read it: demo builds clone pinned SHAs from GitHub
(`scripts/fetch-demo-artifacts.mjs`), so local state cannot leak into
production. `companions/dealfinder` (the DealFinder curriculum's documented
path) is a symlink to `~/Development/tutorial-dealfinder` — it was a git
submodule until 2026-08-25. Fences: both paths are excluded in tsconfig and
ignored by the Next dev watcher; never import from them in app code.

## Drafts (the publish gate)

Tutorial publication is closed by default and requires **two gates** in
`app/tutorials/manifest.ts`: the course name must appear in
`RELEASED_TUTORIAL_SERIES`, and the lesson must carry `draft: false`. `draft` is
a **required** field — a lesson that never states its status fails to compile, so
it can never become public by omission. The scaffolder always creates
`page.draft.mdx` plus `draft: true`, including for an already released series.
Commit and push drafts freely; they are not routes. Release a reviewed lesson by
flipping its flag to `draft: false`. Release a new course only with a separate,
explicit allowlist edit — and because both gates are independent, adding a course
to the allowlist publishes **nothing** on its own; each lesson still needs its own
flip. The "Become a Full-Stack AI Engineer" course is intentionally absent from
the allowlist while it is being developed, and all 37 of its lessons are held.

`scripts/apply-drafts.mjs` runs at prebuild and renames every private tutorial's
`page.mdx` → `page.draft.mdx`, which Next does not route. Private lessons are
also excluded from lists, saved items, feeds, topic pages, and the sitemap.
Projects retain their independent `draft: true` gate; draft projects also skip
demo vendoring. `pnpm run build:staging` temporarily reverses the tutorial gate,
builds all draft routes/listings/feeds into the beta export, then restores the
source filenames in a `finally` block. Beta carries a visible preview banner and
site-wide noindex header. `assert-variant.mjs` refuses preview content on the
production deploy path and refuses a non-preview export on the staging path.

## Editor theme (VS Code)

`.vscode/settings.json` is a **committed, generated** workspace theme so anyone opening
the repo in VS Code gets the same look with nothing to install: Cobalt2 hue-shifted in
OKLCH onto a dark green/grey ground, with an eye-comfort pass (no pure-white text,
capped accent chroma, token foregrounds ≥ 4.5:1). Never hand-edit it — tune the knobs at the
top of `scripts/generate-vscode-theme.mjs` (target background, chroma cap, base theme)
and re-run `node scripts/generate-vscode-theme.mjs` (`--dry-run` prints the mapping +
contrast table). Colors that mean something by hue (terminal ANSI, git, diff,
error/warning) keep their hue. To opt out locally, override the keys in your user
settings via a VS Code Profile.

## Claude Code Tooling

Project-scoped Claude Code config lives in `.claude/`:

- **Skills** (`.claude/skills/`): `publish-post` (the blog publishing workflow),
  `create-tutorial` (authoring a tutorial: scaffolder + verified/anchored rules).
- **Agents** (`.claude/agents/`): `blog-editor` (style/excerpt/tags/fact-flag pass on a
  draft), `frontend-reviewer` (Next.js/MUI/static-export/a11y review of UI changes),
  `learning-experience-reviewer` (instructional-design/e-learning evaluation of tutorials —
  cognitive load, clarity, visuals, learning-science best practices).
- **Slash commands** (`.claude/commands/`): `/publish-post`, `/blog-status`, `/new-tutorial`.
- **Hooks** (`.claude/hooks/`, wired in `settings.json`):
  - `validate-blog.sh` — PostToolUse on Write/Edit; blocks if a `public/blog/` change
    leaves `posts.json` inconsistent.
  - `secret-scan.sh` — PreToolUse on Bash; blocks `git commit`/`git push` when the diff
    contains an Anthropic/AWS key or PEM private key.
- **Settings** (`.claude/settings.json`): hooks + protective `deny` rules (resume PDF,
  `.env*`). A convenience permission allowlist is intentionally left out of the committed
  file — add per-developer allows to `.claude/settings.local.json` if desired, e.g.
  `Bash(pnpm run:*)`, `Bash(node scripts/:*)`, `Bash(git commit:*)`.

The design spec for this setup is in
`docs/superpowers/specs/2026-06-05-claude-code-blog-automation-design.md`.
