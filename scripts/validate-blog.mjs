#!/usr/bin/env node
/**
 * validate-blog.mjs — assert public/blog/posts.json is internally consistent.
 * Used by the validate-blog hook and by CI. Exits non-zero with messages on failure.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEED_WINDOW, FEED_WINDOW_LIMIT } from './lib/feed-window.mjs';
import { isFeedEra } from './lib/feed-era.mjs';
import { slugForTag, topicTags } from './lib/topics.mjs';
import { isSearchTopic } from './lib/search-telemetry.mjs';
import { parseMisses } from './lib/search-misses.mjs';
import { ITEM_ID_RE } from './lib/engagement-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = path.join(ROOT, 'public', 'blog');
const POSTS_JSON = path.join(BLOG_DIR, 'posts.json');
const FEED = path.join(ROOT, 'content', 'feed.xml');
const TOMBSTONES = path.join(ROOT, 'content', 'removed-posts.json');
const SEARCH_MISSES = path.join(ROOT, 'content', 'search-misses.jsonl');

const REQUIRED =['id', 'title', 'excerpt', 'author', 'date', 'tags', 'readTime', 'content', 'image'];
/** Must stay identical to reader_state's CHECK constraint (migration 0006). */
const POST_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

/**
 * Tag vocabulary — see "Per-item fields" in docs/ai-news-feed-contract.md.
 * Keep the two in sync: adding a tag here without adding it there (or vice versa)
 * is how the site's topic filter ends up with three chips for one topic.
 */
const CONTENT_TYPES = ['News', 'Workflow', 'Tutorial'];
const TOPIC_TAGS = [
  'LLM', 'Agents', 'Claude Code', 'MCP', 'Best Practices', 'Developer Tools',
  'RAG', 'Embeddings', 'Fine-Tuning', 'Vectors', 'Self-Hosting', 'HuggingFace',
  'Security', 'AWS', 'Cloud', 'Design', 'Claude Design', 'Design-to-Code', 'UI/UX',
  // Track tags (five-track aggregator pilot, 2026-08-22)
  'Frontier', 'Team Adoption', 'AI for Your Role', 'Everyday AI', 'Building AI Products',
  // Topic tags introduced by the pilot run
  'Metrics', 'Marketing', 'Policy', 'QA', 'Video AI', 'VLM', 'Video Generation', 'Local AI',
];
const KNOWN_TAGS = new Set(['AI', ...CONTENT_TYPES, ...TOPIC_TAGS]);
/** Retired tags that must never come back (duplicates that fragment the filter). */
const BANNED_TAGS = new Map([['AI News', 'News']]);

/* Scope of the tag rules (feed era vs frozen back-catalogue) lives in
 * scripts/lib/feed-era.mjs, shared with normalize-tags.mjs so the rule that FINDS
 * a tag problem and the rule that FIXES it cannot disagree about scope. */

/**
 * Backstop for the rolling feed window. Nothing breaks the moment the feed grows —
 * the damage is gradual and invisible: each routine run reads the whole feed to
 * dedup, so an un-trimmed feed quietly stops fitting in context and the dedup guard
 * weakens without any failure to notice. This warns before that happens.
 *
 * A warning, not an error: an oversized feed is never a reason to block a deploy.
 *
 * NOTE: reading the feed here is only ever a SIZE check. Tag enforcement is scoped
 * by publish date (isFeedEra), deliberately NOT by feed membership — see above.
 */
/**
 * A removed post must actually be gone from posts.json.
 *
 * remove-post.mjs edits BOTH content/feed.xml and public/blog/posts.json, which
 * makes it easy to commit half the removal — stage `content/` and forget
 * `public/`, and the item vanishes from the feed while the page keeps building
 * and deploying from posts.json. That happened once and the post stayed live
 * through a green deploy, because nothing cross-checked the two.
 *
 * An error, not a warning: a post the owner asked to unpublish is still online.
 */
async function checkTombstones(posts, errors) {
  if (!existsSync(TOMBSTONES)) return;
  const removed = JSON.parse(await readFile(TOMBSTONES, 'utf8'));
  const ids = new Set(posts.map((p) => p.id));
  for (const t of removed) {
    if (t?.id && ids.has(t.id)) {
      errors.push(
        `"${t.id}" is listed in content/removed-posts.json but is STILL in posts.json — ` +
          'the removal was only half-committed (did you stage public/blog/posts.json?). ' +
          'Re-run scripts/remove-post.mjs or restore the deletion.',
      );
    }
  }
}

const RELATED_JSON = path.join(BLOG_DIR, 'related.json');

/**
 * related.json is generated (scripts/index-search.mjs) from the search
 * manifest, which can lag posts.json by a run. A neighbor id that no longer
 * exists would render a dead card, so it is an error — but only when the
 * file exists (local builds without a token never write one).
 */
async function checkRelated(posts, errors) {
  if (!existsSync(RELATED_JSON)) return;
  const related = JSON.parse(await readFile(RELATED_JSON, 'utf8'));
  if (!related || typeof related !== 'object' || Array.isArray(related)) {
    errors.push('related.json: expected an object of { postId: [neighborId, …] }');
    return;
  }
  const ids = new Set(posts.map((p) => p.id));
  for (const [id, neighbors] of Object.entries(related)) {
    if (!ids.has(id)) errors.push(`related.json: "${id}" is not in posts.json`);
    if (!Array.isArray(neighbors) || neighbors.some((n) => typeof n !== 'string')) {
      errors.push(`related.json: "${id}" must map to an array of post ids`);
      continue;
    }
    for (const n of neighbors) if (!ids.has(n)) errors.push(`related.json: "${id}" points at missing post "${n}"`);
    if (neighbors.includes(id)) errors.push(`related.json: "${id}" lists itself`);
  }
}

/**
 * Two different tags that slugify to the same string would silently share one
 * /ai-news/topic/<slug>/ page (and one feed), so one topic's posts would
 * vanish behind the other's. Cheap to check, impossible to spot in review.
 */
function checkTopicSlugs(posts, errors) {
  const bySlug = new Map();
  for (const { tag } of topicTags(posts)) {
    const slug = slugForTag(tag);
    const first = bySlug.get(slug);
    if (first === undefined) bySlug.set(slug, tag);
    else errors.push(`topic slug "${slug}" is produced by both "${first}" and "${tag}"`);
  }
}

async function checkFeedWindow(warnings) {
  if (!existsSync(FEED)) return;
  const xml = await readFile(FEED, 'utf8');
  const count = (xml.match(/<item>/g) || []).length;
  if (count < FEED_WINDOW_LIMIT) return;
  warnings.push(
    `content/feed.xml holds ${count} items — past the ${FEED_WINDOW}-item window ` +
      `(warns at ${FEED_WINDOW_LIMIT}). Run "node scripts/trim-feed.mjs"; if this keeps ` +
      'recurring, the publishing routine has stopped running it.',
  );
}

/** Public telemetry must contain only the fixed topic schema, never user text. */
async function checkSearchMisses(errors) {
  if (!existsSync(SEARCH_MISSES)) return;
  const text = await readFile(SEARCH_MISSES, 'utf8');
  for (const line of text.split('\n').filter((line) => line.trim())) {
    try {
      const row = JSON.parse(line);
      if (!row || Object.keys(row).some((key) => !['topic', 'count', 'first_seen'].includes(key)) ||
          !isSearchTopic(row.topic) || parseMisses(line).length !== 1) throw new Error();
    } catch { errors.push('Search telemetry contains an invalid row; only aggregate topic/count/first_seen fields are allowed.'); }
  }
}

async function main() {
  const errors = [];
  const warnings = [];
  let enforced = 0;

  if (!existsSync(POSTS_JSON)) {
    console.error('✗ public/blog/posts.json is missing');
    process.exit(1);
  }

  let posts;
  try {
    posts = JSON.parse(await readFile(POSTS_JSON, 'utf8'));
  } catch (e) {
    console.error(`✗ posts.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(posts)) errors.push('posts.json must be a JSON array');

  const seen = new Set();
  for (const [i, p] of (posts || []).entries()) {
    const where = `entry[${i}] (${p && p.id ? p.id : '?'})`;
    for (const f of REQUIRED) {
      if (p[f] === undefined || p[f] === null || p[f] === '') errors.push(`${where}: missing "${f}"`);
    }
    if (p.id && seen.has(p.id)) errors.push(`${where}: duplicate id "${p.id}"`);
    if (p.id) seen.add(p.id);
    // The id is a database key, not just a URL slug: public.reader_state carries
    // the identical CHECK (migration 0006). If posts.json drifts from it, a
    // reader's "mark as read" and "save" both fail silently against that post —
    // so the drift is caught here, at publish time, instead.
    if (p.id && !POST_ID_RE.test(p.id)) errors.push(`${where}: id must match ${POST_ID_RE} (lowercase, digits, hyphens; ≤128 chars)`);
    if (p.id && POST_ID_RE.test(p.id) && !ITEM_ID_RE.test(p.id)) errors.push(`${where}: id must be at most 96 characters so it can carry reactions (engagement-contract.mjs)`);
    if (p.tags && !Array.isArray(p.tags)) errors.push(`${where}: "tags" must be an array`);
    if (p.readTime !== undefined && typeof p.readTime !== 'number') errors.push(`${where}: "readTime" must be a number`);
    if (p.date && !/^\d{2}-\d{2}-\d{4}$/.test(p.date)) errors.push(`${where}: "date" must be MM-DD-YYYY (got "${p.date}")`);
    if (p.image && !/^https?:\/\//.test(p.image) && !p.image.startsWith('/')) errors.push(`${where}: "image" must be a URL or absolute path (got "${p.image}")`);

    // Tag vocabulary — feed-era posts only (see isFeedEra()).
    if (Array.isArray(p.tags) && isFeedEra(p)) {
      enforced++;
      for (const t of p.tags) {
        if (BANNED_TAGS.has(t)) {
          errors.push(`${where}: retired tag "${t}" — use "${BANNED_TAGS.get(t)}" instead`);
        } else if (!KNOWN_TAGS.has(t)) {
          warnings.push(`${where}: unknown tag "${t}" — add it to validate-blog.mjs + docs/ai-news-feed-contract.md, or fix the typo`);
        }
      }
      const types = p.tags.filter((t) => CONTENT_TYPES.includes(t));
      if (types.length === 0) {
        errors.push(`${where}: missing a content-type tag (one of ${CONTENT_TYPES.join(', ')})`);
      } else if (types.length > 1) {
        warnings.push(`${where}: ${types.length} content-type tags (${types.join(', ')}) — expected exactly one`);
      }
      if (!p.tags.includes('AI')) warnings.push(`${where}: missing the baseline "AI" tag`);
    }
  }

  await checkFeedWindow(warnings);
  await checkSearchMisses(errors);
  await checkTombstones(posts, errors);
  await checkRelated(posts, errors);
  checkTopicSlugs(posts || [], errors);

  for (const w of warnings) console.warn(`  ! ${w}`);

  if (errors.length) {
    console.error(`✗ blog validation failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const warned = warnings.length ? `, ${warnings.length} warning(s)` : '';
  console.log(`✓ blog OK — ${posts.length} posts (tag rules on ${enforced} feed-era), posts.json consistent${warned}`);
}

main();
