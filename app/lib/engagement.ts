'use client';

// Sends reader actions to /api/engage. Spec:
// docs/superpowers/specs/2026-09-24-reader-reactions-design.md
//
// Never throws and never rejects: engagement is signal, and a page must not
// notice when it cannot be recorded. readerState is imported dynamically so
// neither module statically depends on the other.
import type { EngagementChange } from '../../scripts/lib/engagement-contract.mjs';
import type { Reaction } from './readerState';

export type { EngagementChange };

/** The signed deltas that move a reaction from `from` to `to`. */
export function reactionDeltas(from: Reaction, to: Reaction): EngagementChange[] {
  if (from === to) return [];
  const out: EngagementChange[] = [];
  if (from === 1) out.push({ event: 'like', delta: -1 });
  if (from === -1) out.push({ event: 'dislike', delta: -1 });
  if (to === 1) out.push({ event: 'like', delta: 1 });
  if (to === -1) out.push({ event: 'dislike', delta: 1 });
  return out;
}

/** Clicking the active reaction clears it. Clicking the other switches. */
export function nextReaction(current: Reaction, clicked: 1 | -1): Reaction {
  return current === clicked ? 0 : clicked;
}

export interface EngageDeps {
  fetch: typeof fetch;
  accessToken: () => Promise<string | null>;
  obtainClearance: () => Promise<boolean>;
}

async function accessToken(): Promise<string | null> {
  try {
    const { hasReaderSession } = await import('./readerState');
    if (!hasReaderSession()) return null;
    const { supabase } = await import('./supabaseClient');
    const { data } = await supabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

// One Turnstile attempt per 25 minutes, under the cookie's 30. A success means
// the cookie is live. A failure means Turnstile is unavailable on this page.
// Either way, asking again sooner would only add challenges.
const REUSE_MS = 25 * 60 * 1000;
let clearance: { at: number; ok: Promise<boolean> } | null = null;

function obtainClearance(): Promise<boolean> {
  if (clearance && Date.now() - clearance.at < REUSE_MS) return clearance.ok;
  const ok = (async () => {
    const { getTurnstileToken } = await import('./turnstile');
    const token = await getTurnstileToken();
    if (!token) return false;
    const res = await fetch('/api/engage/clearance', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.status === 204;
  })().catch(() => false);
  clearance = { at: Date.now(), ok };
  return ok;
}

// Wrapped, not passed bare: calling window.fetch as a method of another object
// throws "Illegal invocation" in browsers.
const defaultDeps: EngageDeps = { fetch: (input, init) => fetch(input, init), accessToken, obtainClearance };

/**
 * Send one reader action. A signed-in reader authenticates with their live
 * access token. On a 403 (signed out, or a token the Worker could not check)
 * the client passes Turnstile once and retries exactly once.
 */
export async function sendEngagement(
  postId: string,
  changes: EngagementChange[],
  deps: EngageDeps = defaultDeps,
): Promise<void> {
  if (changes.length === 0) return;
  try {
    const send = async () => {
      const token = await deps.accessToken();
      return deps.fetch('/api/engage', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ post_id: postId, changes }),
      });
    };
    if ((await send()).status !== 403) return;
    if (!(await deps.obtainClearance())) return;
    await send();
  } catch {
    // Offline, blocked or aborted: the event is dropped.
  }
}
