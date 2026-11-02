// Fills course lesson fences from the committed snippet file at build time.
//
//   ```python include="dealfinder/schema.py#product"
//   ```
//   ```text output="pytest" step="02"
//   ```
//
// The fence body must be empty: the text comes from content/course/snippets.json,
// which scripts/sync-course-snippets.mjs writes from pinned companion step commits.
// The build never reads the companion or the network. A fence uses the step whose
// lesson is this file's slug, unless it names a step. Plain fences are untouched.
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const META_ATTR = /(\w+)="([^"]*)"/g;
const LESSON_PATH = /app\/tutorials\/\(article\)\/([^/]+)\/page(?:\.draft)?\.mdx$/;
const SYNC = 'run node scripts/sync-course-snippets.mjs';

/** {include?: {path, anchor}, output?, step?} for a fence that opts in, else null. */
export function parseFenceMeta(meta) {
  if (!meta) return null;
  const attrs = Object.fromEntries([...meta.matchAll(META_ATTR)].map((m) => [m[1], m[2]]));
  const out = {};
  if ('include' in attrs) {
    const [path, anchor] = attrs.include.split('#');
    out.include = { path, anchor: anchor ?? null };
  }
  if ('output' in attrs) out.output = attrs.output;
  if (!out.include && !out.output) return null;
  if ('step' in attrs) out.step = attrs.step;
  return out;
}

/** The lesson slug for a tutorial page path, or null for any other file. */
export function lessonSlugFromPath(path) {
  return LESSON_PATH.exec(String(path ?? '').replaceAll('\\', '/'))?.[1] ?? null;
}

function collect(node, hits) {
  for (const child of node.children ?? []) {
    if (child.type === 'code') {
      const meta = parseFenceMeta(child.meta);
      if (meta) hits.push({ node: child, parent: node, meta });
    } else {
      collect(child, hits);
    }
  }
  return hits;
}

export default function remarkCourseInclude({ snippets } = {}) {
  const file = isAbsolute(snippets) ? snippets : resolve(process.cwd(), snippets);
  let cache = null;
  const load = () => {
    const { mtimeMs } = statSync(file);
    if (!cache || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, data: JSON.parse(readFileSync(file, 'utf8')) };
    return cache.data;
  };

  return (tree, vfile) => {
    const hits = collect(tree, []);
    if (!hits.length) return;
    const data = load();
    const slug = lessonSlugFromPath(vfile?.path);
    const label = slug ?? vfile?.path ?? 'mdx';
    const lessonStep = Object.entries(data.steps ?? {}).find(([, s]) => s.lesson === slug)?.[0];

    for (const { node, parent, meta } of hits) {
      const at = node.position ? ` (line ${node.position.start.line})` : '';
      if (node.value.trim()) {
        throw new Error(`${label}${at}: include fence must be empty, its text comes from ${snippets}`);
      }
      const step = meta.step ?? lessonStep;
      if (!step) throw new Error(`${label} uses course includes but has no step in ${snippets}; ${SYNC} --update-lock`);

      if (meta.include) {
        const ref = meta.include.anchor ? `${meta.include.path}#${meta.include.anchor}` : meta.include.path;
        const entry = data.snippets?.[`${step}:${ref}`];
        if (!entry) throw new Error(`${label}: step ${step} has no snippet ${ref} in ${snippets}; ${SYNC}${at}`);
        node.value = entry.text;
        if (!node.lang && entry.lang) node.lang = entry.lang;
      } else {
        const entry = data.outputs?.[`${step}:${meta.output}`];
        if (!entry) throw new Error(`${label}: step ${step} has no output ${meta.output} in ${snippets}; ${SYNC}${at}`);
        node.value = entry.text;
        if (entry.manual) {
          const note = `Captured by hand: ${entry.manual.reason} (${entry.manual.captured}).`;
          parent.children.splice(parent.children.indexOf(node) + 1, 0,
            { type: 'paragraph', children: [{ type: 'text', value: note }] });
        }
      }
    }
  };
}
