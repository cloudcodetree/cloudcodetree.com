// app/lib/localReactions.test.ts
import { describe, expect, it } from 'vitest';
import { clearLocalReactions, readLocalReactions, writeLocalReaction } from './localReactions';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

describe('local reactions', () => {
  it('writes, reads and clears', () => {
    const store = memory();
    writeLocalReaction('a', 1, store);
    writeLocalReaction('b', -1, store);
    expect(readLocalReactions(store)).toEqual({ a: 1, b: -1 });
    writeLocalReaction('a', 0, store);
    expect(readLocalReactions(store)).toEqual({ b: -1 });
    clearLocalReactions(['b'], store);
    expect(readLocalReactions(store)).toEqual({});
  });

  it('ignores anything but 1 and -1 in stored data', () => {
    const store = memory();
    store.setItem('cct-reactions', JSON.stringify({ a: 1, b: 2, c: 'x', d: -1 }));
    expect(readLocalReactions(store)).toEqual({ a: 1, d: -1 });
  });

  it('never throws when storage is blocked', () => {
    expect(readLocalReactions(throwing)).toEqual({});
    expect(() => writeLocalReaction('a', 1, throwing)).not.toThrow();
    expect(() => clearLocalReactions(['a'], throwing)).not.toThrow();
    expect(readLocalReactions(null)).toEqual({});
  });
});
