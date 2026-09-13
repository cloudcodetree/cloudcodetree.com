import { describe, expect, it } from 'vitest';
import { classifyBuild } from './assert-variant.mjs';

describe('deployment build variants', () => {
  it('requires both noindex and the preview marker for staging', () => {
    expect(classifyBuild('X-Robots-Tag: noindex', '<main>BETA PREVIEW</main>')).toBe('staging');
    expect(classifyBuild('X-Robots-Tag: noindex', '<main>Tutorials</main>')).toBe('mixed');
  });

  it('refuses to classify preview content as production', () => {
    expect(classifyBuild('', '<main>Tutorials</main>')).toBe('production');
    expect(classifyBuild('', '<main>BETA PREVIEW</main>')).toBe('mixed');
  });
});
