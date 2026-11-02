import { describe, expect, it } from 'vitest';
import { CourseSyncError, buildSnippets, collectRefs, diffSnippets, serialize, unreachableSteps } from './sync-course-snippets.mjs';

const SHA = 'a'.repeat(40);
const LOCK = { '01': { sha: SHA, lesson: 'dealfinder-part-01', subject: 'step-01: data layer' } };
const FILES = {
  [`${SHA}:dealfinder/schema.py`]: 'import x\n# ANCHOR: product\nclass Product(BaseModel):\n    id: str\n# ANCHOR_END: product\n',
  [`${SHA}:course/outputs/01/pytest.txt`]: '$ pytest -q\n6 passed\n',
  [`${SHA}:course/outputs/01/colab-train.txt`]: '# manual: needs a Colab T4 GPU · captured 2026-10-20\nloss 0.41\n',
};
const read = (sha, path) => FILES[`${sha}:${path}`] ?? null;

const lesson = (slug, body) => ({ slug, path: `app/tutorials/(article)/${slug}/page.draft.mdx`, text: `# Title\n\n${body}\n` });
const fence = (info, body = '') => `\`\`\`${info}\n${body}${body ? '\n' : ''}\`\`\``;
const part01 = lesson('dealfinder-part-01', fence('python include="dealfinder/schema.py#product"'));
const part05 = lesson('dealfinder-part-05', fence('python include="dealfinder/schema.py#product"'));
const withAnchor = (name) => lesson('dealfinder-part-01', fence(`python include="dealfinder/schema.py#${name}"`));
const manualLesson = lesson('dealfinder-part-01', fence('text output="colab-train"'));

const build = (lessons, opts = {}) => buildSnippets({ refs: collectRefs(lessons), steps: LOCK, read, ...opts });

describe('collectRefs', () => {
  it('reads include and output fences with their file and line', () => {
    const l = lesson('dealfinder-part-01', `${fence('python include="a.py#x" step="02"')}\n\n${fence('text output="pytest"')}\n\n${fence('bash', 'pytest -q')}`);
    expect(collectRefs([l])).toEqual([
      { kind: 'include', slug: 'dealfinder-part-01', step: '02', path: 'a.py', anchor: 'x', where: `${l.path}:3` },
      { kind: 'output', slug: 'dealfinder-part-01', step: null, name: 'pytest', where: `${l.path}:6` },
    ]);
  });

  it('ignores fence-looking lines inside another fence', () => {
    const l = lesson('dealfinder-part-01', '````md\n```python include="a.py"\n```\n````');
    expect(collectRefs([l])).toEqual([]);
  });

  it('flags an include fence that still has a body, and one with no language', () => {
    const stale = lesson('dealfinder-part-01', fence('python include="a.py"', 'old code'));
    const bare = lesson('dealfinder-part-01', fence('include="a.py"'));
    expect(() => collectRefs([stale, bare])).toThrow(CourseSyncError);
    try { collectRefs([stale, bare]); } catch (e) {
      expect(e.problems).toEqual([
        `${stale.path}:3 include fence must be empty`,
        `${bare.path}:3 a course fence needs a language before include= or output=`,
      ]);
    }
  });
});

describe('buildSnippets', () => {
  it('builds keys "<step>:<path>#<anchor>" from lesson fences', () => {
    const out = build([part01]);
    expect(Object.keys(out.snippets)).toEqual(['01:dealfinder/schema.py#product']);
    expect(out.snippets['01:dealfinder/schema.py#product']).toEqual({ lang: 'python', text: 'class Product(BaseModel):\n    id: str' });
    expect(out.steps).toEqual(LOCK);
  });

  it('keys a whole-file include with no #', () => {
    const out = build([lesson('dealfinder-part-01', fence('python include="dealfinder/schema.py"'))]);
    expect(out.snippets['01:dealfinder/schema.py'].text).toBe('import x\nclass Product(BaseModel):\n    id: str');
  });

  it('fails when a lesson with includes has no step in the lock', () => {
    expect(() => build([part05])).toThrow(/dealfinder-part-05 uses course includes but has no step in the lock/);
  });

  it('fails when an include names an anchor missing at that step', () => {
    expect(() => build([withAnchor('nope')])).toThrow(/step 01 dealfinder\/schema\.py has no anchor 'nope'/);
  });

  it('fails when a file or an output is missing at that step', () => {
    const l = lesson('dealfinder-part-01', `${fence('python include="gone.py"')}\n\n${fence('text output="nope"')}`);
    expect(() => build([l])).toThrow(/step 01 has no file gone\.py[\s\S]*step 01 has no output nope \(course\/outputs\/01\/nope\.txt\)/);
  });

  it('fails --strict when any series lesson has no step', () => {
    expect(() => build([part01], { strictLessons: ['dealfinder-part-01', 'dealfinder-part-02'] })).toThrow(/dealfinder-part-02 has no step/);
  });

  it('marks manual outputs with reason and date and strips the header line', () => {
    expect(build([manualLesson]).outputs['01:colab-train'])
      .toEqual({ text: 'loss 0.41', manual: { reason: 'needs a Colab T4 GPU', captured: '2026-10-20' } });
    const auto = build([lesson('dealfinder-part-01', fence('text output="pytest"'))]);
    expect(auto.outputs['01:pytest']).toEqual({ text: '$ pytest -q\n6 passed', manual: null });
  });

  it('is byte-stable', () => {
    expect(serialize(build([part01]))).toBe(serialize(build([part01])));
    expect(serialize(build([part01])).endsWith('}\n')).toBe(true);
  });

  it('writes an empty file for no refs and no steps', () => {
    expect(serialize(buildSnippets({ refs: [], steps: {}, read }))).toBe(
      '{\n  "version": 1,\n  "repo": "https://github.com/cloudcodetree/tutorial-dealfinder",\n  "branch": "course",\n'
      + '  "steps": {},\n  "snippets": {},\n  "outputs": {}\n}\n');
  });
});

describe('diffSnippets', () => {
  it('lists the keys that were added, removed or changed', () => {
    const a = build([part01]);
    const b = structuredClone(a);
    b.snippets['01:dealfinder/schema.py#product'].text = 'changed';
    b.outputs['01:pytest'] = { text: 'x', manual: null };
    delete b.steps['01'];
    expect(diffSnippets(a, b)).toEqual([
      'steps 01: removed',
      'snippets 01:dealfinder/schema.py#product: changed',
      'outputs 01:pytest: added',
    ]);
    expect(diffSnippets(a, structuredClone(a))).toEqual([]);
  });
});

describe('unreachableSteps', () => {
  it('flags a locked step commit the course branch no longer contains', () => {
    // A fixup rebase moves step-01; the old commit stays fetchable by SHA, so only
    // ancestry shows the lesson now quotes code from no branch.
    const steps = { '01': { sha: 'a'.repeat(40) }, '02': { sha: 'b'.repeat(40) } };
    expect(unreachableSteps(steps, (sha) => sha.startsWith('a'))).toEqual([
      'step 02 commit bbbbbbb is not on the course branch: run node scripts/sync-course-snippets.mjs --update-lock',
    ]);
    expect(unreachableSteps(steps, () => true)).toEqual([]);
  });
});
