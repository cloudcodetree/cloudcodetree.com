import { describe, expect, it } from 'vitest';
import { mergeAllowList, nextAllowList } from './supabase-allowlist.mjs';

describe('mergeAllowList', () => {
  it('appends new patterns once, keeps order', () => {
    expect(mergeAllowList('https://a/**,https://b/**', ['https://b/**', 'http://127.0.0.1:8000/**']))
      .toBe('https://a/**,https://b/**,http://127.0.0.1:8000/**');
  });
  it('handles an empty current list', () => {
    expect(mergeAllowList('', ['https://deals.cloudcodetree.com/**'])).toBe('https://deals.cloudcodetree.com/**');
  });
});

describe('nextAllowList', () => {
  const add = ['http://127.0.0.1:8000/**'];
  it('refuses a failed read, even when its body has no message', () => {
    expect(() => nextAllowList({ ok: false, status: 502 }, { error: 'bad gateway' }, add)).toThrow(/HTTP 502/);
  });
  it('refuses a body without a uri_allow_list', () => {
    expect(() => nextAllowList({ ok: true, status: 200 }, { site_url: 'x' }, add)).toThrow(/uri_allow_list/);
  });
  it('treats an explicit null list as empty', () => {
    expect(nextAllowList({ ok: true, status: 200 }, { uri_allow_list: null }, add))
      .toEqual({ before: '', after: 'http://127.0.0.1:8000/**' });
  });
  it('merges into an existing list', () => {
    expect(nextAllowList({ ok: true, status: 200 }, { uri_allow_list: 'https://a/**' }, add).after)
      .toBe('https://a/**,http://127.0.0.1:8000/**');
  });
});
