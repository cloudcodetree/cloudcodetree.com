// scripts/lib/engagement-contract.test.mjs
import { describe, expect, it } from 'vitest';
import { EVENTS, ITEM_ID_RE, isValidChange, kindOf, parseEngagement } from './engagement-contract.mjs';

describe('engagement contract', () => {
  it('knows exactly four events', () => {
    expect([...EVENTS]).toEqual(['like', 'dislike', 'save', 'read']);
  });

  it('accepts ids up to 96 characters and rejects anything longer or malformed', () => {
    expect(ITEM_ID_RE.test('a'.repeat(96))).toBe(true);
    expect(ITEM_ID_RE.test('a'.repeat(97))).toBe(false);
    expect(ITEM_ID_RE.test('2026-09-23-01-example')).toBe(true);
    expect(ITEM_ID_RE.test('-leading-hyphen')).toBe(false);
    expect(ITEM_ID_RE.test('Upper')).toBe(false);
    expect(ITEM_ID_RE.test('')).toBe(false);
  });

  it('derives kind from the tutorial- prefix', () => {
    expect(kindOf('tutorial-build-a-rag-over-your-blog')).toBe('tutorial');
    expect(kindOf('2026-09-23-01-example')).toBe('post');
  });

  it('validates single changes', () => {
    expect(isValidChange({ event: 'like', delta: 1 })).toBe(true);
    expect(isValidChange({ event: 'dislike', delta: -1 })).toBe(true);
    expect(isValidChange({ event: 'read', delta: 1 })).toBe(true);
    expect(isValidChange({ event: 'read', delta: -1 })).toBe(false);
    expect(isValidChange({ event: 'like', delta: 2 })).toBe(false);
    expect(isValidChange({ event: 'share', delta: 1 })).toBe(false);
    expect(isValidChange(null)).toBe(false);
  });

  it('parses a valid body and drops extra fields', () => {
    expect(parseEngagement({ post_id: 'abc', changes: [{ event: 'like', delta: 1, auth: 'user' }], kind: 'x' }))
      .toEqual({ postId: 'abc', changes: [{ event: 'like', delta: 1 }] });
  });

  it('rejects bad bodies', () => {
    expect(parseEngagement(null)).toBeNull();
    expect(parseEngagement({ post_id: 'BAD', changes: [{ event: 'like', delta: 1 }] })).toBeNull();
    expect(parseEngagement({ post_id: 'abc', changes: [] })).toBeNull();
    const three = [{ event: 'like', delta: 1 }, { event: 'dislike', delta: -1 }, { event: 'save', delta: 1 }];
    expect(parseEngagement({ post_id: 'abc', changes: three })).toBeNull();
    // Duplicate events in one request would double-count.
    expect(parseEngagement({ post_id: 'abc', changes: [{ event: 'like', delta: 1 }, { event: 'like', delta: 1 }] })).toBeNull();
  });
});
