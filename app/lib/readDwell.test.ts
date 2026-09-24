// app/lib/readDwell.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SENT_READS, createDwell, readLedger } from './readDwell';

describe('createDwell', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires once after the threshold of visible time', () => {
    const hit = vi.fn();
    const d = createDwell(10_000, hit);
    d.show();
    vi.advanceTimersByTime(9_999);
    expect(hit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hit).toHaveBeenCalledTimes(1);
    d.hide(); d.show();
    vi.advanceTimersByTime(60_000);
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('pauses while hidden and resumes with the remaining time', () => {
    const hit = vi.fn();
    const d = createDwell(10_000, hit);
    d.show();
    vi.advanceTimersByTime(6_000);
    d.hide();
    vi.advanceTimersByTime(60_000);
    expect(hit).not.toHaveBeenCalled();
    d.show();
    vi.advanceTimersByTime(3_999);
    expect(hit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('never fires after dispose', () => {
    const hit = vi.fn();
    const d = createDwell(10_000, hit);
    d.show();
    d.dispose();
    vi.advanceTimersByTime(60_000);
    expect(hit).not.toHaveBeenCalled();
  });
});

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

describe('readLedger', () => {
  it('remembers sent ids across instances on the same storage', () => {
    const store = memory();
    readLedger(store).add('a');
    expect(readLedger(store).has('a')).toBe(true);
    expect(readLedger(store).has('b')).toBe(false);
  });

  it('keeps only the most recent ids', () => {
    const store = memory();
    const ledger = readLedger(store);
    for (let i = 0; i <= MAX_SENT_READS; i++) ledger.add(`id-${i}`);
    expect(readLedger(store).has('id-0')).toBe(false);
    expect(readLedger(store).has(`id-${MAX_SENT_READS}`)).toBe(true);
  });

  it('works in memory when storage is blocked', () => {
    const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    const ledger = readLedger(throwing);
    expect(() => ledger.add('a')).not.toThrow();
    expect(ledger.has('a')).toBe(true);
  });
});
