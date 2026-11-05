import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import remarkCourseInclude, { lessonSlugFromPath, parseFenceMeta } from './remark-course-include.mjs';

const PART01 = '/repo/app/tutorials/(article)/dealfinder-part-01/page.draft.mdx';

const FIXTURE = {
  version: 1,
  repo: 'https://github.com/cloudcodetree/tutorial-dealfinder',
  branch: 'course',
  steps: {
    '01': { sha: 'a'.repeat(40), lesson: 'dealfinder-part-01', subject: 'step-01: data layer' },
    '02': { sha: 'b'.repeat(40), lesson: 'dealfinder-part-02', subject: 'step-02: retrieval' },
  },
  snippets: {
    '01:dealfinder/schema.py#product': { lang: 'python', text: 'class Product(BaseModel):\n    id: str' },
    '02:dealfinder/schema.py#product': { lang: 'python', text: 'class Product(BaseModel):\n    id: str\n    title: str' },
  },
  outputs: {
    '01:pytest': { text: '6 passed', manual: null },
    '01:colab-train': { text: 'loss 0.41', manual: { reason: 'needs a Colab T4 GPU', captured: '2026-10-20' } },
  },
};

let dir;
let snippets;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'course-include-'));
  snippets = join(dir, 'snippets.json');
  writeFileSync(snippets, JSON.stringify(FIXTURE));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const code = (meta, lang = null) => ({ type: 'code', lang, meta, value: '' });
const tree = (...children) => ({ type: 'root', children });
const run = (t, path) => remarkCourseInclude({ snippets })(t, { path });

describe('remarkCourseInclude', () => {
  it('fills an include fence from snippets at the lesson step', () => {
    const node = code('include="dealfinder/schema.py#product"');
    run(tree(node), PART01);
    expect(node.value).toBe('class Product(BaseModel):\n    id: str');
    expect(node.lang).toBe('python');
  });

  it('honours an explicit step override', () => {
    const node = code('include="dealfinder/schema.py#product" step="02"');
    run(tree(node), PART01);
    expect(node.value).toBe('class Product(BaseModel):\n    id: str\n    title: str');
  });

  it('keeps a lang the fence already names', () => {
    const node = code('include="dealfinder/schema.py#product"', 'py');
    run(tree(node), PART01);
    expect(node.lang).toBe('py');
  });

  it('throws naming the lesson, step, path and anchor when a key is missing', () => {
    expect(() => run(tree(code('include="dealfinder/schema.py#nope"')), PART01))
      .toThrow(/dealfinder-part-01: step 01 has no snippet dealfinder\/schema\.py#nope.*sync-course-snippets/);
  });

  it('throws when the lesson has no step in the snippet file', () => {
    expect(() => run(tree(code('output="pytest"')), '/repo/app/tutorials/(article)/dealfinder-part-05/page.mdx'))
      .toThrow(/dealfinder-part-05 uses course includes but has no step/);
  });

  it('rejects an include fence that still has a body', () => {
    expect(() => run(tree({ ...code('include="dealfinder/schema.py#product"'), value: 'stale' }), PART01))
      .toThrow(/include fence must be empty/);
  });

  it('leaves plain fences untouched', () => {
    const plain = { type: 'code', lang: 'bash', meta: null, value: 'pytest -q' };
    const withMeta = { type: 'code', lang: 'bash', meta: 'title="run"', value: 'pytest -q' };
    run(tree(plain, withMeta), PART01);
    expect(plain.value).toBe('pytest -q');
    expect(withMeta.value).toBe('pytest -q');
  });

  it('fills an output fence', () => {
    const node = code('output="pytest"');
    run(tree(node), PART01);
    expect(node.value).toBe('6 passed');
  });

  it('appends the manual-capture note after a manual output', () => {
    const node = code('output="colab-train"');
    const t = tree(node, { type: 'paragraph', children: [{ type: 'text', value: 'next' }] });
    run(t, PART01);
    expect(node.value).toBe('loss 0.41');
    expect(t.children[1]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'Captured by hand: needs a Colab T4 GPU (2026-10-20).' }],
    });
    expect(t.children).toHaveLength(3);
  });

  it('finds fences nested inside other nodes', () => {
    const node = code('output="pytest"');
    run(tree({ type: 'blockquote', children: [node] }), PART01);
    expect(node.value).toBe('6 passed');
  });

  it('reloads the snippet file when its mtime changes', () => {
    const plugin = remarkCourseInclude({ snippets });
    const first = code('output="pytest"');
    plugin(tree(first), { path: PART01 });
    expect(first.value).toBe('6 passed');
    const next = structuredClone(FIXTURE);
    next.outputs['01:pytest'].text = '7 passed';
    writeFileSync(snippets, JSON.stringify(next));
    const later = new Date(Date.now() + 5000);
    utimesSync(snippets, later, later);
    const second = code('output="pytest"');
    plugin(tree(second), { path: PART01 });
    expect(second.value).toBe('7 passed');
    writeFileSync(snippets, JSON.stringify(FIXTURE));
  });
});

describe('parseFenceMeta', () => {
  it('reads include, anchor, output and step', () => {
    expect(parseFenceMeta('include="a/b.py#c" step="02"')).toEqual({ include: { path: 'a/b.py', anchor: 'c' }, step: '02' });
    expect(parseFenceMeta('include="a/b.py"')).toEqual({ include: { path: 'a/b.py', anchor: null } });
    expect(parseFenceMeta('output="pytest"')).toEqual({ output: 'pytest' });
  });

  it('is null for a fence that does not opt in', () => {
    expect(parseFenceMeta(null)).toBeNull();
    expect(parseFenceMeta('title="x"')).toBeNull();
  });
});

describe('lessonSlugFromPath', () => {
  it('matches page.mdx and page.draft.mdx under (article)', () => {
    expect(lessonSlugFromPath(PART01)).toBe('dealfinder-part-01');
    expect(lessonSlugFromPath('app/tutorials/(article)/x-y/page.mdx')).toBe('x-y');
    expect(lessonSlugFromPath('app/projects/(detail)/x/page.mdx')).toBeNull();
  });
});
