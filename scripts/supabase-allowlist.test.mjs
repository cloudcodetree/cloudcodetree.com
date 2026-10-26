import { describe, expect, it } from 'vitest';
import { mergeAllowList } from './supabase-allowlist.mjs';

describe('mergeAllowList', () => {
  it('appends new patterns once, keeps order', () => {
    expect(mergeAllowList('https://a/**,https://b/**', ['https://b/**', 'http://127.0.0.1:8000/**']))
      .toBe('https://a/**,https://b/**,http://127.0.0.1:8000/**');
  });
  it('handles an empty current list', () => {
    expect(mergeAllowList('', ['https://deals.cloudcodetree.com/**'])).toBe('https://deals.cloudcodetree.com/**');
  });
});
