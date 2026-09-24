// app/lib/turnstile.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Opts = Record<string, unknown> & { 'error-callback': () => void; callback: (t: string) => void };

/**
 * A stand-in for the real script. Like Turnstile, it resets the widget after an
 * error callback returns unless `retry` is 'never', and resetting a widget that
 * was already removed throws "Nothing to reset found for provided container".
 */
function fakeTurnstile() {
  const state = { opts: null as Opts | null, removed: false, removedInsideCallback: false, inCallback: false };
  const api = {
    render: vi.fn((_el: unknown, opts: Opts) => { state.opts = opts; return 'w1'; }),
    remove: vi.fn(() => { state.removed = true; if (state.inCallback) state.removedInsideCallback = true; }),
    fail() {
      state.inCallback = true;
      state.opts!['error-callback']();
      state.inCallback = false;
      if (state.opts!.retry !== 'never' && state.removed) {
        throw new Error('[Cloudflare Turnstile] Nothing to reset found for provided container.');
      }
    },
  };
  return { api, state };
}

let turnstile: ReturnType<typeof fakeTurnstile>;
// The module caches the loaded script, so each test imports a fresh copy.
let getTurnstileToken: typeof import('./turnstile').getTurnstileToken;
const host = { style: {}, remove: vi.fn() };

beforeEach(async () => {
  vi.resetModules();
  ({ getTurnstileToken } = await import('./turnstile'));
  turnstile = fakeTurnstile();
  host.remove.mockClear();
  (globalThis as unknown as { window: unknown }).window = { turnstile: turnstile.api };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => host,
    body: { appendChild: vi.fn() },
    head: { appendChild: vi.fn() },
  };
});

describe('getTurnstileToken', () => {
  it('turns off Turnstile retries, since the caller owns the retry policy', async () => {
    const pending = getTurnstileToken();
    await vi.waitFor(() => expect(turnstile.state.opts).not.toBeNull());
    expect(turnstile.state.opts!.retry).toBe('never');
    turnstile.state.opts!.callback('tok');
    await expect(pending).resolves.toBe('tok');
  });

  it('a failed challenge resolves null and leaves Turnstile nothing to throw', async () => {
    const pending = getTurnstileToken();
    await vi.waitFor(() => expect(turnstile.state.opts).not.toBeNull());
    expect(() => turnstile.api.fail()).not.toThrow();
    await expect(pending).resolves.toBeNull();
    expect(turnstile.state.removedInsideCallback).toBe(false);
    await vi.waitFor(() => expect(turnstile.api.remove).toHaveBeenCalledWith('w1'));
    expect(host.remove).toHaveBeenCalled();
  });
});
