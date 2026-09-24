#!/usr/bin/env node
/**
 * check-parity.mjs — assert an origin serves the site the way GitHub Pages does.
 *
 * Usage:
 *   node scripts/check-parity.mjs --origin https://cloudcodetree.com
 *   node scripts/check-parity.mjs --origin https://cct-site-staging.chris-247.workers.dev --sweep
 *
 * Run it against PRODUCTION first. A failure there means the contract below is
 * wrong, not that production is broken — correct the contract and re-run. Only
 * a contract that passes on production is evidence of anything on staging.
 *
 * This asserts an explicit behavioral contract (status, redirect Location,
 * content type, body marker) rather than diffing HTML between origins: two
 * builds differ by Next build ID and feed timestamps even from identical
 * source, and that noise would hide real failures.
 *
 * LIMIT: HTTP checks verify delivery, not rendering. A page can return
 * 200 text/html and still be blank (e.g. CSP blocking every asset — observed
 * 2026-08-20). Pair this with a browser check on the key pages.
 */
/**
 * Divergences between GitHub Pages and Workers Assets that are understood,
 * accepted, and deliberately NOT asserted identical. Each entry names the
 * behavior on each origin so a future reader can re-verify.
 */
export const KNOWN_DIFFERENCES = [
  {
    path: '/<page>',
    reason:
      'Trailing-slash canonicalization: Pages emits 301, Workers force-trailing-slash emits 307/308. ' +
      'SEO impact ~nil: every page carries a canonical tag with the slash form, and the sitemap uses it. ' +
      'Contract accepts any of 301/307/308 with the right Location.',
  },
  {
    path: '/404.html',
    reason:
      'Workers html_handling normalizes the .html extension away (307 -> /404/); Pages serves it at 200. ' +
      'Real misses serve the identical 404 page on both, which is what the /definitely-not-a-page/ case asserts.',
  },
  {
    path: '/tutorials/<draft>/',
    reason: 'Beta is the noindex editorial preview and serves draft tutorials; production excludes them structurally.',
  },
];

/** Behavioral contract. Every case must hold on both origins. */
export const CONTRACT = [
  { path: '/',                       status: 200, contentType: /text\/html/, bodyIncludes: '<html' },
  { path: '/about/',                 status: 200, contentType: /text\/html/, bodyIncludes: '<html' },
  // Pages: 301. Workers force-trailing-slash: 307/308. See KNOWN_DIFFERENCES.
  { path: '/about',                  status: [301, 307, 308], location: '/about/' },
  { path: '/ai-news/',               status: 200, contentType: /text\/html/ },
  { path: '/tutorials/',             status: 200, contentType: /text\/html/ },
  { path: '/about/resume/',          status: 200, contentType: /text\/html/ },
  { path: '/about/contact/',         status: 200, contentType: /text\/html/ },
  { path: '/about/schedule/',        status: 200, contentType: /text\/html/ },
  // Legacy redirect stubs are real 200 pages that meta-redirect client-side.
  { path: '/blog/',                  status: 200, contentType: /text\/html/ },
  { path: '/resume/',                status: 200, contentType: /text\/html/ },
  { path: '/contact/',               status: 200, contentType: /text\/html/ },
  { path: '/schedule/',              status: 200, contentType: /text\/html/ },
  { path: '/robots.txt',             status: 200, bodyIncludes: 'Sitemap:' },
  { path: '/sitemap.xml',            status: 200, bodyIncludes: '<urlset' },
  { path: '/feed.xml',               status: 200, bodyIncludes: '<rss' },
  { path: '/rss.xml',                status: 200, bodyIncludes: '<rss' },
  { path: '/index.xml',              status: 200, bodyIncludes: '<rss' },
  { path: '/ai-news/feed.xml',       status: 200, bodyIncludes: '<rss' },
  { path: '/tutorials/feed.xml',     status: 200, bodyIncludes: '<rss' },
  { path: '/definitely-not-a-page/', status: 404, bodyIncludes: '404' },
  // Search + discovery (2026-09). /api/search is 503 until the bindings and
  // index exist — both are acceptable "delivered" states; 404 is not.
  { path: '/api/search?q=claude+code',            status: [200, 503], contentType: /application\/json/ },
  { path: '/api/search',                          status: 400 },
  // Engagement endpoints are POST-only. A GET proves each route reaches its
  // handler instead of the /api/* 404. The 400/403 contract is unit-tested.
  { path: '/api/engage',                          status: 405 },
  { path: '/api/engage/clearance',                status: 405 },
  { path: '/ai-news/search/',                     status: 200, contentType: /text\/html/ },
  // Per-reader: a shared empty shell anyone can fetch, and it must never be
  // indexed — the noindex is the only thing keeping a personal page out of
  // search results.
  { path: '/saved/',                              status: 200, contentType: /text\/html/, bodyIncludes: 'noindex' },
  { path: '/ai-news/topic/claude-code/',          status: 200, contentType: /text\/html/, bodyIncludes: 'Claude Code' },
  { path: '/ai-news/topic/claude-code/feed.xml',  status: 200, bodyIncludes: '<rss' },
  // Multi-topic feed: built by the Worker from the per-topic static feeds.
  { path: '/ai-news/feed.xml?topics=claude-code,security', status: 200, contentType: /rss\+xml/, bodyIncludes: '<rss' },
  { path: '/tutorials/topic/rag/', status: 200, contentType: /text\/html/, bodyIncludes: 'RAG tutorials' },
  { path: '/tutorials/topic/rag/feed.xml', status: 200, bodyIncludes: 'tutorial-build-a-rag-over-your-blog' },
  { path: '/tutorials/feed.xml?topics=rag,python', status: 200, contentType: /rss\+xml/, bodyIncludes: 'Tutorials ·' },
  { path: '/tutorials/dealfinder-part-01/', status: 404, beta: { status: 200, bodyIncludes: 'Data layer, normalization' } },
  { path: '/saved/?section=tutorials', status: 200, bodyIncludes: 'noindex' },
  // Oldest post (frozen back-catalog, never trimmed): the Related strip is
  // baked in once the index has run at least once on main.
  { path: '/ai-news/2026-05-28-19-amd-venice-enters-production-on-tsmc-2nm/', status: 200, bodyIncludes: 'data-related' },
];

export function evaluateCase(testCase, { status, headers, body }) {
  const failures = [];
  if (testCase.status !== undefined) {
    const allowed = Array.isArray(testCase.status) ? testCase.status : [testCase.status];
    if (!allowed.includes(status)) {
      failures.push(
        allowed.length === 1
          ? `expected status ${allowed[0]}, got ${status}`
          : `expected status one of ${allowed.join(', ')}, got ${status}`,
      );
    }
  }
  if (testCase.location !== undefined) {
    const actual = headers.get('location');
    const normalized = actual && actual.startsWith('http') ? new URL(actual).pathname : actual;
    if (normalized !== testCase.location) {
      failures.push(`expected Location ${testCase.location}, got ${normalized}`);
    }
  }
  if (testCase.contentType !== undefined) {
    const actual = headers.get('content-type') ?? '';
    if (!testCase.contentType.test(actual)) {
      failures.push(`expected content-type matching ${testCase.contentType}, got "${actual}"`);
    }
  }
  if (testCase.bodyIncludes !== undefined && !body.includes(testCase.bodyIncludes)) {
    failures.push(`body does not contain "${testCase.bodyIncludes}"`);
  }
  return failures;
}

export function sitemapPaths(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

async function probe(origin, urlPath) {
  const res = await fetch(new URL(urlPath, origin), { redirect: 'manual' });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const origin = args[args.indexOf('--origin') + 1];
  const sweep = args.includes('--sweep');
  if (!origin || origin.startsWith('--')) {
    console.error('usage: check-parity.mjs --origin <url> [--sweep]');
    process.exit(2);
  }

  const beta = new URL(origin).hostname === 'beta.cloudcodetree.com';
  let failed = 0;
  console.log(`\n▸ contract (${CONTRACT.length} cases) against ${origin}`);
  for (const testCase of CONTRACT) {
    const effective = beta && testCase.beta ? { ...testCase, ...testCase.beta } : testCase;
    const failures = evaluateCase(effective, await probe(origin, testCase.path));
    if (failures.length > 0) {
      failed += 1;
      console.error(`  ✗ ${testCase.path}`);
      for (const f of failures) console.error(`      ${f}`);
    }
  }
  if (failed === 0) console.log('  ✓ all contract cases pass');

  if (sweep) {
    // Sweep the origin against ITS OWN sitemap, not the local one. The local
    // working tree can be ahead of production (e.g. draft tutorials in the
    // manifest), and sweeping local URLs against an older deploy reports
    // content differences as serving failures — which they are not.
    const res = await fetch(new URL('/sitemap.xml', origin));
    const xml = await res.text();
    const paths = sitemapPaths(xml);
    console.log(`\n▸ sweep (${paths.length} sitemap URLs) against ${origin}`);
    const results = await inBatches(paths, 8, async (p) => {
      // Retry transient throttling (503/429): GitHub Pages sheds load under an
      // 8-concurrent 626-URL burst and returns 503s for pages that are 200 when
      // fetched alone (observed 2026-08-20; Workers served the identical burst
      // clean). Retrying distinguishes "throttled" from "dead" — a genuinely
      // broken page stays broken on every attempt.
      let status;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        const res = await fetch(new URL(p, origin), { redirect: 'manual' });
        // Drain so keep-alive sockets get reused across 500+ requests.
        await res.arrayBuffer();
        status = res.status;
        if (status !== 503 && status !== 429) break;
      }
      return { path: p, status };
    });
    const bad = results.filter((r) => r.status !== 200);
    for (const r of bad) console.error(`  ✗ ${r.path} → ${r.status}`);
    failed += bad.length;
    if (bad.length === 0) console.log(`  ✓ all ${paths.length} URLs return 200`);
  }

  console.log('');
  if (failed > 0) {
    console.error(`✗ ${failed} failure(s) against ${origin}`);
    process.exit(1);
  }
  console.log(`✓ ${origin} satisfies the parity contract`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
