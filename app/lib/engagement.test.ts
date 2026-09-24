// app/lib/engagement.test.ts
import { describe, expect, it, vi } from 'vitest';
import { nextReaction, reactionDeltas, sendEngagement, type EngageDeps } from './engagement';

describe('reactionDeltas', () => {
  it.each([
    [0, 0, []],
    [1, 1, []],
    [-1, -1, []],
    [0, 1, [{ event: 'like', delta: 1 }]],
    [0, -1, [{ event: 'dislike', delta: 1 }]],
    [1, 0, [{ event: 'like', delta: -1 }]],
    [-1, 0, [{ event: 'dislike', delta: -1 }]],
    [1, -1, [{ event: 'like', delta: -1 }, { event: 'dislike', delta: 1 }]],
    [-1, 1, [{ event: 'dislike', delta: -1 }, { event: 'like', delta: 1 }]],
  ] as const)('%i -> %i', (from, to, expected) => {
    expect(reactionDeltas(from, to)).toEqual(expected);
  });
});

describe('nextReaction', () => {
  it('toggles the clicked reaction and switches from the other', () => {
    expect(nextReaction(0, 1)).toBe(1);
    expect(nextReaction(1, 1)).toBe(0);
    expect(nextReaction(-1, 1)).toBe(1);
    expect(nextReaction(1, -1)).toBe(-1);
  });
});

function deps(statuses: number[], opts: { token?: string | null; clearance?: boolean } = {}) {
  const fetch = vi.fn(async () => new Response(null, { status: statuses.shift() ?? 204 }));
  const d: EngageDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    accessToken: vi.fn(async () => opts.token ?? null),
    obtainClearance: vi.fn(async () => opts.clearance ?? true),
  };
  return { d, fetch };
}
const LIKE = [{ event: 'like', delta: 1 }] as const;

describe('sendEngagement', () => {
  it('sends nothing for no changes', async () => {
    const { d, fetch } = deps([]);
    await sendEngagement('p', [], d);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the body and a bearer token when signed in', async () => {
    const { d, fetch } = deps([204], { token: 'tok' });
    await sendEngagement('p', [...LIKE], d);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/engage');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual({ post_id: 'p', changes: [{ event: 'like', delta: 1 }] });
    expect(d.obtainClearance).not.toHaveBeenCalled();
  });

  it('sends no authorization header when signed out', async () => {
    const { d, fetch } = deps([204]);
    await sendEngagement('p', [...LIKE], d);
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('obtains clearance on a 403 and retries once', async () => {
    const { d, fetch } = deps([403, 204]);
    await sendEngagement('p', [...LIKE], d);
    expect(d.obtainClearance).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry when clearance fails (Turnstile blocked)', async () => {
    const { d, fetch } = deps([403], { clearance: false });
    await sendEngagement('p', [...LIKE], d);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never sends a third request when 403 persists after clearance', async () => {
    const { d, fetch } = deps([403, 403, 403]);
    await sendEngagement('p', [...LIKE], d);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves even when the network throws', async () => {
    const d: EngageDeps = {
      fetch: vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof globalThis.fetch,
      accessToken: async () => null,
      obtainClearance: async () => true,
    };
    await expect(sendEngagement('p', [...LIKE], d)).resolves.toBeUndefined();
  });
});
