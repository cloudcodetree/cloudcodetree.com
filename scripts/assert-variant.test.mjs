import { describe, expect, it } from 'vitest';
import { TURNSTILE_TEST_SITE_KEY, classifyBuild, findTestSiteKey } from './assert-variant.mjs';

describe('deployment build variants', () => {
  it('requires both noindex and the preview marker for staging', () => {
    expect(classifyBuild('X-Robots-Tag: noindex', '<main>BETA PREVIEW</main>')).toBe('staging');
    expect(classifyBuild('X-Robots-Tag: noindex', '<main>Tutorials</main>')).toBe('mixed');
  });

  it('refuses to classify preview content as production', () => {
    expect(classifyBuild('', '<main>Tutorials</main>')).toBe('production');
    expect(classifyBuild('', '<main>BETA PREVIEW</main>')).toBe('mixed');
  });

  it('finds the Turnstile always-pass test key in built scripts', () => {
    const files = [
      { file: 'out/_next/a.js', text: `k="${TURNSTILE_TEST_SITE_KEY}"` },
      { file: 'out/_next/b.js', text: 'k="0x4AAAAAAAreal"' },
    ];
    expect(findTestSiteKey(files)).toEqual(['out/_next/a.js']);
    expect(findTestSiteKey([{ file: 'out/_next/b.js', text: 'nothing' }])).toEqual([]);
  });
});
