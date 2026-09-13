#!/usr/bin/env node
/**
 * generate-feeds.mjs — build the public reader feed + sitemap from
 * public/blog/posts.json.
 *
 * Outputs:
 *   public/feed.xml    — RSS 2.0 + Media RSS + content:encoded, for feed
 *                        readers and "subscribe" links. Featured images are
 *                        referenced by absolute URL so they render anywhere.
 *   public/sitemap.xml — static routes + every /ai-news/<id>/ page
 *                        (robots.txt advertises this URL).
 *   public/blog/archive/<hash>.json — 100-post metadata chunks, with stable
 *                        older chunks as posts are prepended.
 *   public/blog/bodies/<hash>.json — one body fetched per visible full-feed post.
 *
 * Runs automatically as `prebuild` and before `dev`; all outputs are
 * regenerated from posts.json each build, so they're never hand-maintained
 * (and they're gitignored).
 *
 * This EMITS the site's own feed (site → readers). It is separate from the
 * INGEST feed at content/feed.xml (task → site); different files, no collision.
 * No external dependencies.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTutorials, seriesTotal } from './lib/tutorials-data.mjs';
import { readProjects } from './lib/projects-data.mjs';
import { topicTags } from './lib/topics.mjs';
import { buildArchive } from './lib/blog-archive.mjs';
import { tutorialTopics, tutorialReaderId } from './lib/tutorial-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const BLOG_DIR = path.join(PUBLIC, 'blog');
const POSTS_JSON = path.join(BLOG_DIR, 'posts.json');

const SITE = 'https://cloudcodetree.com';
const FEED_TITLE = 'AI News · CloudCodeTree';
const FEED_DESC = 'Daily field notes on AI-assisted engineering.';
const FEED_LIMIT = 20; // most-recent items per feed (small feeds; readers want recent, sitemap keeps all)

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' };
const mimeFor = (p) => MIME[(p.split('.').pop() || '').toLowerCase()] || 'image/jpeg';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

/** MM-DD-YYYY → Date (noon UTC, stable). */
function toDate(mdY) {
  const [mm, dd, yyyy] = mdY.split('-').map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
}
const rfc822 = (d) => d.toUTCString();

/** Wrap pre-rendered <item> XML in an RSS 2.0 channel. */
function rssChannel({ title, desc, self, link, itemsXml, now }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xml(title)}</title>
    <link>${link}</link>
    <atom:link href="${self}" rel="self" type="application/rss+xml" />
    <description>${xml(desc)}</description>
    <language>en-us</language>
    <generator>cloudcodetree generate-feeds.mjs</generator>
    <lastBuildDate>${now}</lastBuildDate>
${itemsXml}
  </channel>
</rss>
`;
}

/** Write a feed to public/<relPath>, creating parent dirs as needed. */
async function writeFeed(PUBLIC, relPath, body, label) {
  const out = path.join(PUBLIC, relPath);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, body);
  console.log(`✓ ${relPath} (${label}) → public/`);
}

/** Minimal, safe Markdown→HTML for the controlled post bodies. */
function mdToHtml(md) {
  return md.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).map((b) => {
    b = b.trim();
    if (!b) return '';
    if (/^---+$/.test(b)) return '<hr />';
    return `<p>${inline(b)}</p>`;
  }).filter(Boolean).join('\n');
}
function inline(s) {
  s = xml(s);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+?)\*\*/g, (_, t) => `<strong>${t}</strong>`);
  s = s.replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, (_, p, t) => `${p}<em>${t}</em>`);
  return s;
}

// Images are CDN URLs (GitHub Release assets); no local file to inspect.
function imageInfo(post) {
  if (!post.image) return null;
  return { url: post.image, type: mimeFor(post.image) };
}

async function main() {
  if (!existsSync(POSTS_JSON)) { console.error('✗ posts.json missing'); process.exit(1); }
  const posts = JSON.parse(await readFile(POSTS_JSON, 'utf8'));
  const now = rfc822(new Date());

  // Post bodies are inlined in posts.json (no per-post .md files).
  // Prefer the full publish timestamp; fall back to date-at-noon for old posts.
  const items = posts.map((p) => ({
    p,
    html: mdToHtml(p.content || ''),
    img: imageInfo(p),
    date: p.publishedAt && !isNaN(new Date(p.publishedAt).getTime()) ? new Date(p.publishedAt) : toDate(p.date),
  }));

  const feedPosts = items.slice(0, FEED_LIMIT); // newest-first; cap the feed (sitemap below keeps all)
  const renderItem = ({ p, html, img, date }) => {
    const link = `${SITE}/ai-news/${p.id}/`;
    const cats = (p.tags || []).map((t) => `    <category>${cdata(t)}</category>`).join('\n');
    const media = img
      ? `    <media:content url="${xml(img.url)}" medium="image" type="${img.type}" />\n` +
        `    <media:thumbnail url="${xml(img.url)}" />\n`
      : '';
    const figure = img ? `<p><img src="${xml(img.url)}" alt="" /></p>\n` : '';
    return `  <item>
    <title>${cdata(p.title)}</title>
    <link>${xml(link)}</link>
    <guid isPermaLink="false">${xml(p.id)}</guid>
    <pubDate>${rfc822(date)}</pubDate>
    <dc:creator>${cdata(p.author)}</dc:creator>
${cats ? cats + '\n' : ''}    <description>${cdata(p.excerpt || '')}</description>
    <content:encoded>${cdata(figure + html)}</content:encoded>
${media}  </item>`;
  };
  const rssItems = feedPosts.map(renderItem).join('\n');

  // Each feed is written at its canonical .../feed.xml AND at guessable aliases
  // (rss.xml, index.xml) so naive path-discovery also finds it; autodiscovery
  // <link> tags remain the primary, correct mechanism. Aliases share the body
  // (rel=self points at the canonical feed.xml so readers can dedupe).
  const ALIASES = ['feed.xml', 'rss.xml', 'index.xml'];
  const writeAll = (dir, body, n) =>
    Promise.all(ALIASES.map((name) => writeFeed(PUBLIC, dir ? `${dir}/${name}` : name, body, `${n} items`)));

  const siteBody = rssChannel({ title: FEED_TITLE, desc: FEED_DESC, self: `${SITE}/feed.xml`, link: `${SITE}/ai-news/`, itemsXml: rssItems, now });
  await writeAll('', siteBody, feedPosts.length);
  const aiBody = rssChannel({ title: FEED_TITLE, desc: FEED_DESC, self: `${SITE}/ai-news/feed.xml`, link: `${SITE}/ai-news/`, itemsXml: rssItems, now });
  await writeAll('ai-news', aiBody, feedPosts.length);

  // Per-topic feeds: /ai-news/topic/<slug>/feed.xml (same item format, newest 20 with that tag).
  const topics = topicTags(posts);
  // Two tags slugifying the same would overwrite each other's feed here and
  // share one topic page; fail loudly rather than lose a topic's posts.
  const seenSlugs = new Set();
  for (const { tag, slug } of topics) {
    if (seenSlugs.has(slug)) throw new Error('duplicate topic slug: ' + slug);
    seenSlugs.add(slug);
    const tagged = items.filter(({ p }) => (p.tags || []).includes(tag)).slice(0, FEED_LIMIT);
    const body = rssChannel({
      title: `${tag} · AI News · CloudCodeTree`,
      desc: `AI News posts tagged ${tag}.`,
      self: `${SITE}/ai-news/topic/${slug}/feed.xml`,
      link: `${SITE}/ai-news/topic/${slug}/`,
      itemsXml: tagged.map(renderItem).join('\n'),
      now,
    });
    await writeAll(`ai-news/topic/${slug}`, body, tagged.length);
  }

  // Keyword search index for the browser (MiniSearch): no bodies, newest-first.
  const searchIndex = posts.map((p) => ({ id: p.id, title: p.title, excerpt: p.excerpt || '', tags: p.tags || [], date: p.date }));
  await writeFile(path.join(BLOG_DIR, 'search-index.json'), JSON.stringify(searchIndex));
  console.log(`✓ blog/search-index.json (${searchIndex.length} posts) → public/`);

  const archive = buildArchive(posts);
  for (const dir of ['archive', 'bodies']) {
    await rm(path.join(BLOG_DIR, dir), { recursive: true, force: true });
    await mkdir(path.join(BLOG_DIR, dir), { recursive: true });
  }
  for (const file of [...archive.chunks, ...archive.bodies]) {
    await writeFile(path.join(PUBLIC, file.url.slice(1)), file.text);
  }
  console.log(`✓ ${archive.chunks.length} archive chunks + ${archive.bodies.length} article bodies`);

  // Tutorials feed — built from the hand-authored manifest (newest-first, capped).
  const previewTutorials = process.env.NEXT_PUBLIC_CONTENT_PREVIEW === '1';
  const allTuts = readTutorials()
    .filter((t) => previewTutorials || t.published)
    .map((t) => previewTutorials ? { ...t, draft: false } : t);
  const sortedTuts = allTuts
    .filter((t) => t.date)
    .map((t) => ({ ...t, d: toDate(t.date), total: seriesTotal(allTuts, t.series) }))
    .sort((a, b) => (b.d - a.d) || (b.order - a.order));
  const renderTutorial = (t) => {
    const link = `${SITE}/tutorials/${t.slug}/`;
    const fullTitle = `${t.series}: ${t.title} (Part ${t.part} of ${t.total})`;
    return `  <item>
    <title>${cdata(fullTitle)}</title>
    <link>${xml(link)}</link>
    <guid isPermaLink="false">${xml(tutorialReaderId(t.slug))}</guid>
    <pubDate>${rfc822(t.d)}</pubDate>
    <dc:creator>${cdata('Chris Harper')}</dc:creator>
    <category>${cdata(t.series)}</category>
${(t.tags || []).map((tag) => `    <category>${cdata(tag)}</category>`).join('\n')}
    <description>${cdata(t.excerpt || '')}</description>
  </item>`;
  };
  const tuts = sortedTuts.slice(0, FEED_LIMIT);
  const tutItems = tuts.map(renderTutorial).join('\n');
  const tutBody = rssChannel({ title: 'Tutorials · CloudCodeTree', desc: 'Hands-on tutorials for agentic AI development and AI engineering.', self: `${SITE}/tutorials/feed.xml`, link: `${SITE}/tutorials/`, itemsXml: tutItems, now });
  await writeAll('tutorials', tutBody, tuts.length);

  const tutTopics = tutorialTopics(allTuts);
  const tutSlugs = new Set();
  for (const { tag, slug } of tutTopics) {
    if (tutSlugs.has(slug)) throw new Error('duplicate tutorial topic slug: ' + slug);
    tutSlugs.add(slug);
    const tagged = sortedTuts.filter((t) => t.tags.includes(tag)).slice(0, FEED_LIMIT);
    const body = rssChannel({ title: `${tag} · Tutorials · CloudCodeTree`, desc: `Hands-on tutorials tagged ${tag}.`,
      self: `${SITE}/tutorials/topic/${slug}/feed.xml`, link: `${SITE}/tutorials/topic/${slug}/`,
      itemsXml: tagged.map(renderTutorial).join('\n'), now });
    await writeAll(`tutorials/topic/${slug}`, body, tagged.length);
  }

  // --- sitemap.xml -----------------------------------------------------------
  const iso = (d) => d.toISOString().slice(0, 10);
  const newest = items.length ? iso(items.map((it) => it.date).sort((a, b) => b - a)[0]) : iso(new Date());
  // Hand-authored tutorial slugs, discovered from app/tutorials/(article)/*/.
  // Manifest-driven (not a directory scan) so drafts never leak into the sitemap.
  const tutorialSlugs = allTuts.map((t) => t.slug);

  const staticRoutes = [
    { loc: `${SITE}/`, lastmod: newest, priority: '1.0' }, // home = AI News blog
    ...topics.map((t) => ({ loc: `${SITE}/ai-news/topic/${t.slug}/`, lastmod: newest, priority: '0.5' })),
    { loc: `${SITE}/tutorials/`, priority: '0.8' },
    { loc: `${SITE}/tutorials/all/`, priority: '0.7' },
    ...tutTopics.map((t) => ({ loc: `${SITE}/tutorials/topic/${t.slug}/`, priority: '0.5' })),
    ...tutorialSlugs.map((s) => ({ loc: `${SITE}/tutorials/${s}/`, priority: '0.7' })),
    { loc: `${SITE}/projects/`, priority: '0.8' },
    ...readProjects().filter((p) => !p.draft).map((p) => ({ loc: `${SITE}/projects/${p.slug}/`, priority: '0.6' })),
    { loc: `${SITE}/about/`, priority: '0.7' },
    { loc: `${SITE}/about/resume/`, priority: '0.6' },
    { loc: `${SITE}/about/contact/`, priority: '0.4' },
    { loc: `${SITE}/about/schedule/`, priority: '0.4' },
  ];
  const urls = [
    ...staticRoutes,
    ...items.map(({ p, date }) => ({ loc: `${SITE}/ai-news/${p.id}/`, lastmod: iso(date), priority: '0.6' })),
  ].map((u) => `  <url>
    <loc>${xml(u.loc)}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <priority>${u.priority}</priority>
  </url>`).join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  await writeFile(path.join(PUBLIC, 'sitemap.xml'), sitemap);
  console.log(`✓ sitemap.xml (${items.length + staticRoutes.length} urls) → public/`);
  // The /ai-news list paginates client-side from a slim (content-free) index the
  // server route embeds, with a reader-selectable page size — so no per-page
  // chunk files are generated here anymore.
}

main().catch((e) => { console.error('✗ generate-feeds failed:', e.message); process.exit(1); });
