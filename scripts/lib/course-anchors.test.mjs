import { describe, expect, it } from 'vitest';
import { CourseAnchorError, extractAnchor, listAnchors } from './course-anchors.mjs';

describe('extractAnchor', () => {
  it('extracts a named region and strips nested markers', () => {
    const src = '# ANCHOR: all\nx = 1\n# ANCHOR: inner\ny = 2\n# ANCHOR_END: inner\n# ANCHOR_END: all\n';
    expect(extractAnchor(src, 'all', 'a.py')).toBe('x = 1\ny = 2');
  });

  it('dedents the region', () => {
    expect(extractAnchor('class A:\n    # ANCHOR: m\n    def m(self):\n        return 1\n    # ANCHOR_END: m\n', 'm', 'a.py'))
      .toBe('def m(self):\n    return 1');
  });

  it('returns the whole file without its markers when the name is null', () => {
    expect(extractAnchor('import os\n# ANCHOR: a\nx = 1\n# ANCHOR_END: a\n', null, 'a.py')).toBe('import os\nx = 1');
  });

  it('reads #, //, -- and <!-- --> comment leaders', () => {
    for (const [o, c] of [['# ', ''], ['// ', ''], ['-- ', ''], ['<!-- ', ' -->']])
      expect(extractAnchor(`${o}ANCHOR: q${c}\nSELECT 1\n${o}ANCHOR_END: q${c}\n`, 'q', 'f')).toBe('SELECT 1');
  });

  it('names the file and anchor when the anchor is missing', () => {
    expect(() => extractAnchor('x = 1\n', 'nope', 'a.py')).toThrow(/a\.py has no anchor 'nope'/);
  });
});

describe('listAnchors', () => {
  it('throws on unclosed, duplicate and stray markers with line numbers', () => {
    expect(() => listAnchors('# ANCHOR: a\nx\n', 'a.py')).toThrow(/a\.py:1 ANCHOR 'a' is never closed/);
    expect(() => listAnchors('# ANCHOR: a\n# ANCHOR_END: a\n# ANCHOR: a\n# ANCHOR_END: a\n', 'a.py')).toThrow(/a\.py:3 duplicate anchor 'a'/);
    expect(() => listAnchors('x\n# ANCHOR_END: b\n', 'a.py')).toThrow(/a\.py:2 ANCHOR_END 'b' has no ANCHOR/);
  });

  it('throws a CourseAnchorError', () => {
    expect(() => listAnchors('# ANCHOR: a\n', 'a.py')).toThrow(CourseAnchorError);
  });

  it('maps each name to its 1-based marker lines', () => {
    expect(listAnchors('x\n# ANCHOR: a\ny\n# ANCHOR_END: a\n', 'a.py')).toEqual(new Map([['a', { start: 2, end: 4 }]]));
  });
});
