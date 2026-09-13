# CloudCodeTree

AI engineering news, hands-on tutorials, project demos, and Chris Harper's portfolio.

- Production: [cloudcodetree.com](https://cloudcodetree.com)
- Staging: [beta.cloudcodetree.com](https://beta.cloudcodetree.com) (noindex draft preview)

## Development

Use Node 22 (see `.node-version`) and pnpm **11.0.9**, pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm run dev                     # Next.js at localhost:3000
pnpm run check                   # Unit tests, Worker types, lint
pnpm audit                       # Dependency advisories
pnpm run build                   # Type-check and export to out/
pnpm run start                   # Preview with local Wrangler at localhost:8787
pnpm exec playwright install chromium
pnpm run test:browser            # Starts its own preview on localhost:8788
```

Next.js 15 App Router and React 19 generate static HTML. MUI's App Router cache
provider emits styles during prerendering; page content is visible before JavaScript.
Cloudflare Workers Static Assets serve `out/`. The Worker handles search, sessions,
protected demos, admin routes, and filtered RSS. Supabase provides authentication
and per-reader saved/read state, enforced by row-level security.

## Content and structure

- `app/`: routes, client components, tutorials, and reader/search helpers.
- `worker/`: Cloudflare request handlers and tests.
- `content/feed.xml`: incoming editorial feed; `content/drafts/`: scheduled drafts.
- `public/blog/posts.json`: generated canonical article archive, including Markdown.
- `scripts/`: ingest, validation, feed generation, deployment, and infrastructure tools.
- `infra/`: OpenTofu-managed Cloudflare DNS and redirect configuration.
- `tests/browser/`: Playwright regressions, with all contact submissions intercepted.

**Do not hand-edit `public/blog/posts.json`.** Follow
[the feed contract](docs/ai-news-feed-contract.md), update the incoming feed, then run:

```bash
node scripts/ingest-feed.mjs --no-images
node scripts/validate-blog.mjs
node scripts/validate-research-log.mjs
```

Builds generate RSS, the sitemap, search data, content-addressed metadata chunks,
and one JSON body per article. Listings prerender 20 posts and load the remaining
metadata as cacheable chunks; full-feed view fetches only the displayed bodies.
Generated files are ignored by Git. The original archive remains available for
existing consumers.

Tutorials are private by default. A public lesson must belong to a series named
in `RELEASED_TUTORIAL_SERIES` and must not carry `draft: true` in
`app/tutorials/manifest.ts`. The scaffolder creates draft entries and
`page.draft.mdx`; publishing is a separate, explicit manifest change. Staging
builds temporarily include every tutorial draft so work can be reviewed live on
beta without weakening the production gate.

## Deployment

Pushes to `main` run `.github/workflows/deploy.yml`:

1. Prepare images on a separate runner with no deployment credentials. Downloads
   are capped at 10 MB and Sharp decoding at 40 million pixels.
2. Upload validated JPEG artifacts to R2, harvest aggregate search counters, and
   commit resulting data changes. This job does not decode images.
3. Build that exact commit, run validation/unit/browser checks, vendor pinned demo
   builds, and deploy the production Worker. Run parity and browser checks on the
   deployed site. PRs run the build checks without publishing.

Production deployment requires `ENABLE_WORKER_DEPLOY=true` and the existing
Cloudflare account/token secrets. Local deployments use Wrangler authentication.

```bash
# Build the live draft preview; staging adds a banner and noindex headers.
pnpm run build:staging && pnpm run deploy:staging

# Manual production deployment.
pnpm run build && node scripts/fetch-demo-artifacts.mjs && pnpm run deploy:prod

# Verify a deployed origin, including every sitemap URL.
node scripts/check-parity.mjs --origin https://cloudcodetree.com --sweep
PLAYWRIGHT_BASE_URL=https://cloudcodetree.com pnpm run test:browser
```

Assets use relative URLs in both environments. Canonical and feed URLs point to
production. Deployment helpers check the build's indexing policy before publishing.
GitHub Pages was retired on 2026-09-05; there is no `pnpm run deploy` command.

## Privacy and security

Search-miss telemetry stores only an allowlisted topic, first-seen day, and count.
Unknown queries become `other`; raw query text is never logged or harvested.
Worker invocation logging is disabled to avoid recording search URLs. The public
telemetry validator rejects extra fields and legacy raw-query rows. Previously
committed raw rows were removed from the current tree; Git history is unchanged.

Blog and tutorial saves share one Saved page with Blog and Tutorials tabs.
Tutorials also support search, a topic dropdown, topic landing pages/RSS, read
markers, Hide read, and persistent layout/filter controls. Course ordering stays
intact. Saved items and reading history are private to the signed-in reader. Failed reads
show a retry action, and large histories are paginated. The contact form uses
Web3Forms with honeypots and visible errors; it requires no mouse gestures or delay.
The deployed CSP is maintained in `public/_headers` and checked during validation.
Dependabot checks application dependencies and Actions weekly.

For detailed project conventions and operational context, see [CLAUDE.md](CLAUDE.md).
