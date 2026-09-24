# Reader Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every reader like, dislike, save and read articles and tutorial lessons, recording per-reader reactions in `reader_state` and an anonymous aggregate event stream in Workers Analytics Engine.

**Architecture:** One shared contract module defines the event shape. The Worker gains `POST /api/engage` (validate, authenticate, rate-limit, write to Analytics Engine) and `POST /api/engage/clearance` (Turnstile, then a signed 30-minute cookie). The browser computes signed deltas, persists reactions to `reader_state` when signed in or `localStorage` when not, and sends events through one transport that retries once through Turnstile on a 403.

**Tech Stack:** Cloudflare Workers (Analytics Engine, rate-limit binding, WebCrypto HMAC), Cloudflare Turnstile, Supabase Postgres + RLS, Next.js 15 / React 19 / MUI v7, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-reader-reactions-design.md`

## Global Constraints

- Work on branch `feat/reader-reactions`. Nothing merges to `main` until Task 10's beta acceptance passes. Pushing to `main` deploys production.
- Item id pattern: `^[a-z0-9][a-z0-9-]{0,95}$`.
- Events: `like`, `dislike`, `save`, `read`. Delta: `1` or `-1`. `read` accepts only `1`. 1 or 2 changes per request, events distinct within a request. Body at most 1,024 bytes.
- Rate limit: 30 requests per 60 seconds, keyed by `cf-connecting-ip`. The IP is never written anywhere.
- Responses: `204` success. `400` invalid. `403` no valid bearer and no valid clearance, or disallowed origin. `405` wrong method. `429` over the limit. A failed Analytics Engine write still returns `204`.
- Signed-in auth: `Authorization: Bearer <supabase access token>`, checked with `verifyToken` from `worker/auth.ts`. `cct_session` is never used for engagement.
- Clearance cookie: `cct_engage=<value>; HttpOnly; Secure; SameSite=Strict; Path=/api/engage; Max-Age=1800`. Value is `base64url("<expiry>.<nonce>") + "." + base64url(HMAC-SHA256)`. No identity inside.
- Datasets: `cct_engagement` (production), `cct_engagement_staging` (beta). Data point: `indexes: [id]`, `blobs: [event, kind, auth]`, `doubles: [delta]`. `kind` is `tutorial` for ids starting `tutorial-`, else `post`. `auth` is `user` or `anon`, decided by the Worker.
- Reactions are `1` (like), `0` (none), `-1` (dislike). Clicking the active button clears it. Clicking the other switches.
- A `read` is sent once per item per browser, after 10 cumulative visible seconds. At most 2,000 sent ids are remembered.
- No counts are shown anywhere. Buttons appear on article pages only, never list cards.
- Signed-out state lives in `localStorage` key `cct-reactions`. Sent reads live in `localStorage` key `cct-reads-sent`.
- Spec deviation, deliberate: `scripts/check-parity.mjs` only issues GETs, so parity pins the routes with `405` cases. The `400`/`403` contract is covered by unit tests and a beta `curl` in Task 10.

## Review Focus

1. **Double-clicking a reaction button.** A second click computed from stale React state would send `like +1` twice. Expected: net deltas always equal the final state. Pinned in Task 9 (browser, `dblclick`), using a ref for the current reaction.
2. **Turnstile blocked by an extension or network.** Expected: the button still toggles, one `403` is sent, no clearance request, no retry loop, no page error. Pinned in Task 6 (unit) and Task 9 (browser, script aborted).
3. **`localStorage` unavailable** (Safari private mode, blocked site data). Expected: reactions and read tracking never throw. Pinned in Task 7 and Task 8 (unit, throwing storage).
4. **A 403 that persists after clearance succeeded** (cookie blocked, key rotated). Expected: exactly one retry per action, never a third request. Pinned in Task 6 (unit).
5. **Signing out after reacting while signed in.** Expected: the page shows only local state, never the account's reaction. Pinned in Task 9 (browser).

---

### Task 1: Shared engagement contract

**Files:**
- Create: `scripts/lib/engagement-contract.mjs`
- Create: `scripts/lib/engagement-contract.d.mts`
- Create: `scripts/lib/engagement-contract.test.mjs`
- Modify: `scripts/validate-blog.mjs` (near line 187, the existing id check)

**Interfaces:**
- Consumes: nothing.
- Produces: `EVENTS`, `ITEM_ID_RE`, `MAX_CHANGES`, `MAX_BODY_BYTES`, `kindOf(id: string): 'post' | 'tutorial'`, `isValidChange(change: unknown): change is EngagementChange`, `parseEngagement(body: unknown): { postId: string; changes: EngagementChange[] } | null`. Types `EngagementEvent`, `ItemKind`, `EngagementChange = { event: EngagementEvent; delta: 1 | -1 }`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/lib/engagement-contract.test.mjs`
Expected: FAIL, cannot resolve `./engagement-contract.mjs`.

- [ ] **Step 3: Write the contract**

```js
// scripts/lib/engagement-contract.mjs
// The engagement event contract. The Worker (worker/engage.ts), the browser
// (app/lib/engagement.ts) and the future harvester all import it, so the three
// cannot drift. Spec: docs/superpowers/specs/2026-09-24-reader-reactions-design.md

/** Events a reader action can produce. */
export const EVENTS = Object.freeze(['like', 'dislike', 'save', 'read']);

/**
 * Item ids: the reader_state shape, narrowed to 96 characters so an id fits
 * Analytics Engine's 96-byte index. Ids are ASCII, so characters equal bytes.
 */
export const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;

export const MAX_CHANGES = 2;
export const MAX_BODY_BYTES = 1024;

/** 'tutorial' for tutorial-<slug> ids, 'post' for everything else. */
export function kindOf(id) {
  return id.startsWith('tutorial-') ? 'tutorial' : 'post';
}

/** A known event with a delta of 1 or -1. A read can only be added. */
export function isValidChange(change) {
  if (!change || typeof change !== 'object') return false;
  const { event, delta } = change;
  if (!EVENTS.includes(event)) return false;
  if (delta !== 1 && delta !== -1) return false;
  return !(event === 'read' && delta !== 1);
}

/** Parse an /api/engage body into { postId, changes }, or null. Never throws. */
export function parseEngagement(body) {
  if (!body || typeof body !== 'object') return null;
  const { post_id: postId, changes } = body;
  if (typeof postId !== 'string' || !ITEM_ID_RE.test(postId)) return null;
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_CHANGES) return null;
  if (!changes.every(isValidChange)) return null;
  if (new Set(changes.map((c) => c.event)).size !== changes.length) return null;
  return { postId, changes: changes.map(({ event, delta }) => ({ event, delta })) };
}
```

```ts
// scripts/lib/engagement-contract.d.mts
export type EngagementEvent = 'like' | 'dislike' | 'save' | 'read';
export type ItemKind = 'post' | 'tutorial';
export interface EngagementChange { event: EngagementEvent; delta: 1 | -1 }
export const EVENTS: readonly EngagementEvent[];
export const ITEM_ID_RE: RegExp;
export const MAX_CHANGES: number;
export const MAX_BODY_BYTES: number;
export function kindOf(id: string): ItemKind;
export function isValidChange(change: unknown): change is EngagementChange;
export function parseEngagement(body: unknown): { postId: string; changes: EngagementChange[] } | null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run scripts/lib/engagement-contract.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Guard post ids in validate-blog**

A post whose id is longer than 96 characters could never carry engagement events. In `scripts/validate-blog.mjs`, add the import at the top with the other imports:

```js
import { ITEM_ID_RE } from './lib/engagement-contract.mjs';
```

Directly after the existing `POST_ID_RE` check (line 187), add:

```js
    if (p.id && POST_ID_RE.test(p.id) && !ITEM_ID_RE.test(p.id)) errors.push(`${where}: id must be at most 96 characters so it can carry reactions (engagement-contract.mjs)`);
```

- [ ] **Step 6: Verify validation still passes on the real archive**

Run: `node scripts/validate-blog.mjs`
Expected: `✓ blog OK` (the longest id today is 74 characters).

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/engagement-contract.mjs scripts/lib/engagement-contract.d.mts scripts/lib/engagement-contract.test.mjs scripts/validate-blog.mjs
git commit -m "feat(engage): shared engagement event contract"
```

---

### Task 2: Clearance cookie and Turnstile verification

**Files:**
- Create: `worker/origin.ts`
- Create: `worker/clearance.ts`
- Create: `worker/clearance.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `isAllowedOrigin(request: Request, allowed: string | undefined): boolean` (comma-separated list)
  - `CLEARANCE_COOKIE = 'cct_engage'`, `CLEARANCE_TTL_SECONDS = 1800`
  - `signClearance(secret: string, nowSeconds: number): Promise<string>`
  - `verifyClearance(secret: string, value: string, nowSeconds: number): Promise<boolean>`
  - `clearanceCookie(value: string): string`
  - `readClearance(request: Request): string | null`
  - `type Siteverify = (secret: string, token: string, remoteip: string | null) => Promise<boolean>`
  - `interface ClearanceEnv { ENGAGE_ORIGINS?: string; TURNSTILE_SECRET?: string; ENGAGE_HMAC_KEY?: string }`
  - `handleClearance(request, env: ClearanceEnv, verify?: Siteverify, now?: () => number): Promise<Response>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/clearance.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  CLEARANCE_TTL_SECONDS, clearanceCookie, handleClearance, readClearance, signClearance, verifyClearance,
} from './clearance';
import { isAllowedOrigin } from './origin';

const KEY = 'test-hmac-key';
const NOW = 1_800_000_000;
const ORIGINS = 'https://cloudcodetree.com,http://127.0.0.1:8788';
const env = { ENGAGE_ORIGINS: ORIGINS, TURNSTILE_SECRET: 'ts-secret', ENGAGE_HMAC_KEY: KEY };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://cloudcodetree.com/api/engage/clearance', {
    method: 'POST',
    headers: { origin: 'https://cloudcodetree.com', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('isAllowedOrigin', () => {
  it('accepts listed origins only', () => {
    const req = (origin?: string) => new Request('https://x/', { headers: origin ? { origin } : {} });
    expect(isAllowedOrigin(req('https://cloudcodetree.com'), ORIGINS)).toBe(true);
    expect(isAllowedOrigin(req('http://127.0.0.1:8788'), ORIGINS)).toBe(true);
    expect(isAllowedOrigin(req('https://evil.example'), ORIGINS)).toBe(false);
    expect(isAllowedOrigin(req(), ORIGINS)).toBe(false);
    expect(isAllowedOrigin(req('https://cloudcodetree.com'), undefined)).toBe(false);
  });
});

describe('clearance cookie', () => {
  it('round-trips a fresh value', async () => {
    const value = await signClearance(KEY, NOW);
    expect(await verifyClearance(KEY, value, NOW + 60)).toBe(true);
  });

  it('rejects an expired value', async () => {
    const value = await signClearance(KEY, NOW);
    expect(await verifyClearance(KEY, value, NOW + CLEARANCE_TTL_SECONDS + 1)).toBe(false);
  });

  it('rejects a value signed with another key', async () => {
    const value = await signClearance('other-key', NOW);
    expect(await verifyClearance(KEY, value, NOW)).toBe(false);
  });

  it('rejects a tampered payload or signature, and garbage', async () => {
    const value = await signClearance(KEY, NOW);
    const [payload, sig] = value.split('.');
    const forgedPayload = btoa(`${NOW + 999999}.x`).replace(/=+$/, '');
    expect(await verifyClearance(KEY, `${forgedPayload}.${sig}`, NOW)).toBe(false);
    expect(await verifyClearance(KEY, `${payload}.${sig.slice(0, -2)}AA`, NOW)).toBe(false);
    expect(await verifyClearance(KEY, 'not-a-cookie', NOW)).toBe(false);
    expect(await verifyClearance(KEY, 'a.b.c', NOW)).toBe(false);
  });

  it('carries the required attributes', () => {
    expect(clearanceCookie('v')).toBe('cct_engage=v; HttpOnly; Secure; SameSite=Strict; Path=/api/engage; Max-Age=1800');
  });

  it('is read back from the Cookie header', () => {
    const req = new Request('https://x/', { headers: { cookie: 'a=1; cct_engage=abc.def; b=2' } });
    expect(readClearance(req)).toBe('abc.def');
    expect(readClearance(new Request('https://x/'))).toBeNull();
  });
});

describe('handleClearance', () => {
  const now = () => NOW;

  it('refuses anything but POST', async () => {
    const res = await handleClearance(new Request('https://cloudcodetree.com/api/engage/clearance'), env);
    expect(res.status).toBe(405);
  });

  it('refuses a foreign origin', async () => {
    const verify = vi.fn(async () => true);
    const res = await handleClearance(post({ token: 't' }, { origin: 'https://evil.example' }), env, verify, now);
    expect(res.status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed without its secrets', async () => {
    const res = await handleClearance(post({ token: 't' }), { ENGAGE_ORIGINS: ORIGINS }, vi.fn(async () => true), now);
    expect(res.status).toBe(503);
  });

  it('rejects a missing or malformed token', async () => {
    const verify = vi.fn(async () => true);
    expect((await handleClearance(post('not json'), env, verify, now)).status).toBe(400);
    expect((await handleClearance(post({}), env, verify, now)).status).toBe(400);
    expect((await handleClearance(post({ token: 'x'.repeat(2049) }), env, verify, now)).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it('sets no cookie when Turnstile says no', async () => {
    const res = await handleClearance(post({ token: 't' }), env, vi.fn(async () => false), now);
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('issues a verifiable cookie when Turnstile says yes, passing the client IP', async () => {
    const verify = vi.fn(async () => true);
    const res = await handleClearance(post({ token: 't' }, { 'cf-connecting-ip': '203.0.113.9' }), env, verify, now);
    expect(res.status).toBe(204);
    expect(verify).toHaveBeenCalledWith('ts-secret', 't', '203.0.113.9');
    const cookie = res.headers.get('set-cookie') ?? '';
    const value = cookie.split(';')[0].slice('cct_engage='.length);
    expect(await verifyClearance(KEY, value, NOW + 10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/clearance.test.ts`
Expected: FAIL, cannot resolve `./clearance`.

- [ ] **Step 3: Write `worker/origin.ts`**

```ts
/// <reference types="@cloudflare/workers-types" />
// Engagement endpoints only answer pages served by this site. This is a
// browser-context filter, not a security boundary: a script can forge Origin,
// which is why /api/engage also demands a bearer token or a clearance cookie.

/** True when the request's Origin is in the comma-separated `allowed` list. */
export function isAllowedOrigin(request: Request, allowed: string | undefined): boolean {
  const origin = request.headers.get('origin');
  if (!origin || !allowed) return false;
  return allowed.split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}
```

- [ ] **Step 4: Write `worker/clearance.ts`**

```ts
/// <reference types="@cloudflare/workers-types" />
// POST /api/engage/clearance: proof that an anonymous reader passed Turnstile.
//
// Turnstile tokens are single-use and live 5 minutes, so asking for one per
// like would mean a siteverify round trip on every click. Instead the Worker
// verifies one token and returns `cct_engage`: HttpOnly, HMAC-signed, valid
// for 30 minutes on /api/engage only. It carries an expiry and a random nonce.
// Nothing in it identifies the reader.

import { isAllowedOrigin } from './origin';

export const CLEARANCE_COOKIE = 'cct_engage';
export const CLEARANCE_TTL_SECONDS = 1800;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN = 2048;

export interface ClearanceEnv {
  ENGAGE_ORIGINS?: string;
  TURNSTILE_SECRET?: string;
  ENGAGE_HMAC_KEY?: string;
}

export type Siteverify = (secret: string, token: string, remoteip: string | null) => Promise<boolean>;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** `<payload>.<signature>`, where payload is base64url("<expiry>.<nonce>"). */
export async function signClearance(secret: string, nowSeconds: number): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = b64url(enc.encode(`${nowSeconds + CLEARANCE_TTL_SECONDS}.${nonce}`));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** True only for an untampered value whose expiry is still in the future. */
export async function verifyClearance(secret: string, value: string, nowSeconds: number): Promise<boolean> {
  const parts = value.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const sigBytes = fromB64url(sig);
  const body = fromB64url(payload);
  if (!payload || !sigBytes || !body) return false;
  // subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(payload));
  if (!ok) return false;
  const expiry = Number(new TextDecoder().decode(body).split('.')[0]);
  return Number.isFinite(expiry) && expiry > nowSeconds;
}

export function clearanceCookie(value: string): string {
  return `${CLEARANCE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/engage; Max-Age=${CLEARANCE_TTL_SECONDS}`;
}

export function readClearance(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === CLEARANCE_COOKIE && v.length) return v.join('=');
  }
  return null;
}

/** Cloudflare's siteverify. Any failure, including a network error, is a no. */
export const siteverify: Siteverify = async (secret, token, remoteip) => {
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, ...(remoteip ? { remoteip } : {}) }),
    });
    if (!res.ok) return false;
    const data = await res.json<{ success?: unknown }>();
    return data.success === true;
  } catch {
    return false;
  }
};

export async function handleClearance(
  request: Request,
  env: ClearanceEnv,
  verify: Siteverify = siteverify,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<Response> {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
  if (!isAllowedOrigin(request, env.ENGAGE_ORIGINS)) return new Response('forbidden', { status: 403 });
  // Fail closed: without both secrets no trustworthy pass can be issued.
  if (!env.TURNSTILE_SECRET || !env.ENGAGE_HMAC_KEY) return new Response('unavailable', { status: 503 });

  let token: unknown;
  try {
    token = (await request.json<{ token?: unknown }>()).token;
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN) {
    return new Response('bad request', { status: 400 });
  }

  if (!(await verify(env.TURNSTILE_SECRET, token, request.headers.get('cf-connecting-ip')))) {
    return new Response('forbidden', { status: 403 });
  }
  const value = await signClearance(env.ENGAGE_HMAC_KEY, now());
  return new Response(null, { status: 204, headers: { 'set-cookie': clearanceCookie(value) } });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run worker/clearance.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Typecheck the Worker**

Run: `pnpm run typecheck:worker`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add worker/origin.ts worker/clearance.ts worker/clearance.test.ts
git commit -m "feat(engage): Turnstile clearance and signed cct_engage cookie"
```

---

### Task 3: The engage endpoint

**Files:**
- Create: `worker/engage.ts`
- Create: `worker/engage.test.ts`

**Interfaces:**
- Consumes: `parseEngagement`, `kindOf`, `MAX_BODY_BYTES` (Task 1). `isAllowedOrigin` (Task 2). `readClearance`, `verifyClearance`, `signClearance` (Task 2). `verifyToken`, `InvalidTokenError`, `JwksUnavailableError`, `setJwksForTesting` (existing `worker/auth.ts`).
- Produces: `interface EngageEnv { SUPABASE_URL: string; ENGAGE_ORIGINS?: string; ENGAGE_HMAC_KEY?: string; ENGAGEMENT?: AnalyticsEngineDataset; ENGAGE_LIMITER?: RateLimit }`, `handleEngage(request, env: EngageEnv, now?: () => number): Promise<Response>`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/engage.test.ts
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { setJwksForTesting } from './auth';
import { signClearance } from './clearance';
import { handleEngage, type EngageEnv } from './engage';

const SUPABASE_URL = 'https://demo-ref.supabase.co';
const KEY = 'test-hmac-key';
const NOW = 1_800_000_000;
const now = () => NOW;
const LIKE = { post_id: '2026-09-23-01-example', changes: [{ event: 'like', delta: 1 }] };

let userToken: string;
let badToken: string;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const { privateKey: stranger } = await generateKeyPair('ES256');
  setJwksForTesting(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' }] }));
  const mint = (key: CryptoKey) =>
    new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject('user-1')
      .setIssuer(`${SUPABASE_URL}/auth/v1`).setIssuedAt().setExpirationTime('1h').sign(key);
  userToken = await mint(privateKey);
  badToken = await mint(stranger);
});

function makeEnv(overrides: Partial<EngageEnv> = {}) {
  const writeDataPoint = vi.fn();
  const limit = vi.fn(async () => ({ success: true }));
  const env: EngageEnv = {
    SUPABASE_URL,
    ENGAGE_ORIGINS: 'https://cloudcodetree.com',
    ENGAGE_HMAC_KEY: KEY,
    ENGAGEMENT: { writeDataPoint } as unknown as AnalyticsEngineDataset,
    ENGAGE_LIMITER: { limit } as unknown as RateLimit,
    ...overrides,
  };
  return { env, writeDataPoint, limit };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://cloudcodetree.com/api/engage', {
    method: 'POST',
    headers: { origin: 'https://cloudcodetree.com', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const bearer = () => ({ authorization: `Bearer ${userToken}` });
const cleared = async (at = NOW) => ({ cookie: `cct_engage=${await signClearance(KEY, at)}` });

describe('handleEngage', () => {
  it('refuses anything but POST', async () => {
    const { env } = makeEnv();
    expect((await handleEngage(new Request('https://cloudcodetree.com/api/engage'), env, now)).status).toBe(405);
  });

  it('refuses a foreign origin and writes nothing', async () => {
    const { env, writeDataPoint } = makeEnv();
    const res = await handleEngage(post(LIKE, { ...bearer(), origin: 'https://evil.example' }), env, now);
    expect(res.status).toBe(403);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it.each([
    ['not json', 'nope'],
    ['oversize body', JSON.stringify({ ...LIKE, pad: 'x'.repeat(1100) })],
    ['bad id', { ...LIKE, post_id: 'Bad Id' }],
    ['no changes', { ...LIKE, changes: [] }],
    ['three changes', { ...LIKE, changes: [{ event: 'like', delta: 1 }, { event: 'dislike', delta: -1 }, { event: 'save', delta: 1 }] }],
    ['unknown event', { ...LIKE, changes: [{ event: 'share', delta: 1 }] }],
    ['delta 2', { ...LIKE, changes: [{ event: 'like', delta: 2 }] }],
    ['read -1', { ...LIKE, changes: [{ event: 'read', delta: -1 }] }],
    ['duplicate events', { ...LIKE, changes: [{ event: 'like', delta: 1 }, { event: 'like', delta: 1 }] }],
  ])('rejects %s with 400 and writes nothing', async (_name, body) => {
    const { env, writeDataPoint } = makeEnv();
    const res = await handleEngage(post(body, bearer()), env, now);
    expect(res.status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('returns 403 without a bearer token or clearance', async () => {
    const { env, writeDataPoint } = makeEnv();
    expect((await handleEngage(post(LIKE), env, now)).status).toBe(403);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('records a signed-in like as auth user', async () => {
    const { env, writeDataPoint } = makeEnv();
    const res = await handleEngage(post(LIKE, bearer()), env, now);
    expect(res.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ['2026-09-23-01-example'], blobs: ['like', 'post', 'user'], doubles: [1],
    });
  });

  it('records a cleared anonymous like as auth anon', async () => {
    const { env, writeDataPoint } = makeEnv();
    const res = await handleEngage(post(LIKE, await cleared()), env, now);
    expect(res.status).toBe(204);
    expect(writeDataPoint.mock.calls[0][0].blobs[2]).toBe('anon');
  });

  it('rejects an expired clearance', async () => {
    const { env } = makeEnv();
    const res = await handleEngage(post(LIKE, await cleared(NOW - 1801)), env, now);
    expect(res.status).toBe(403);
  });

  it('falls back to clearance when the bearer token is invalid', async () => {
    const { env, writeDataPoint } = makeEnv();
    const res = await handleEngage(post(LIKE, { authorization: `Bearer ${badToken}`, ...(await cleared()) }), env, now);
    expect(res.status).toBe(204);
    expect(writeDataPoint.mock.calls[0][0].blobs[2]).toBe('anon');
  });

  it('derives kind server-side and ignores client claims', async () => {
    const { env, writeDataPoint } = makeEnv();
    const body = { post_id: 'tutorial-build-a-rag-over-your-blog', changes: [{ event: 'read', delta: 1, auth: 'user' }], kind: 'post' };
    await handleEngage(post(body, await cleared()), env, now);
    expect(writeDataPoint.mock.calls[0][0]).toEqual({
      indexes: ['tutorial-build-a-rag-over-your-blog'], blobs: ['read', 'tutorial', 'anon'], doubles: [1],
    });
  });

  it('writes one point per change', async () => {
    const { env, writeDataPoint } = makeEnv();
    const body = { ...LIKE, changes: [{ event: 'like', delta: -1 }, { event: 'dislike', delta: 1 }] };
    await handleEngage(post(body, bearer()), env, now);
    expect(writeDataPoint).toHaveBeenCalledTimes(2);
    expect(writeDataPoint.mock.calls.map((c) => [c[0].blobs[0], c[0].doubles[0]])).toEqual([['like', -1], ['dislike', 1]]);
  });

  it('returns 429 over the rate limit, keyed by client IP, and writes nothing', async () => {
    const { env, writeDataPoint, limit } = makeEnv();
    limit.mockResolvedValueOnce({ success: false });
    const res = await handleEngage(post(LIKE, { ...bearer(), 'cf-connecting-ip': '203.0.113.9' }), env, now);
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('still returns 204 when the Analytics Engine write throws', async () => {
    const { env, writeDataPoint } = makeEnv();
    writeDataPoint.mockImplementation(() => { throw new Error('boom'); });
    expect((await handleEngage(post(LIKE, bearer()), env, now)).status).toBe(204);
  });

  it('returns 204 without an Analytics Engine binding', async () => {
    const { env } = makeEnv({ ENGAGEMENT: undefined });
    expect((await handleEngage(post(LIKE, bearer()), env, now)).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/engage.test.ts`
Expected: FAIL, cannot resolve `./engage`.

- [ ] **Step 3: Write `worker/engage.ts`**

```ts
/// <reference types="@cloudflare/workers-types" />
// POST /api/engage: one reader action as one or two Analytics Engine points.
//
// Spec: docs/superpowers/specs/2026-09-24-reader-reactions-design.md
// The Worker, never the client, decides who is asking:
//   - a valid Supabase access token in `Authorization: Bearer` means `user`
//   - otherwise a valid cct_engage clearance cookie means `anon`
//   - neither means 403, and the client retries once through Turnstile.
// cct_session is deliberately not used: it is minted once at sign-in, capped
// at an hour and never re-minted, so it expires under a reader mid-session.

import { MAX_BODY_BYTES, kindOf, parseEngagement } from '../scripts/lib/engagement-contract.mjs';
import { InvalidTokenError, JwksUnavailableError, verifyToken } from './auth';
import { readClearance, verifyClearance } from './clearance';
import { isAllowedOrigin } from './origin';

export interface EngageEnv {
  SUPABASE_URL: string;
  ENGAGE_ORIGINS?: string;
  ENGAGE_HMAC_KEY?: string;
  ENGAGEMENT?: AnalyticsEngineDataset;
  ENGAGE_LIMITER?: RateLimit;
}

type Auth = 'user' | 'anon';
const MAX_TOKEN = 8192;

async function whoIsAsking(request: Request, env: EngageEnv, nowSeconds: number): Promise<Auth | null> {
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (bearer && bearer.length <= MAX_TOKEN && env.SUPABASE_URL) {
    try {
      await verifyToken(bearer, env.SUPABASE_URL);
      return 'user';
    } catch (err) {
      // A bad token and an unreachable JWKS both fall through to the clearance
      // cookie. Anything else is a bug and should surface.
      if (!(err instanceof InvalidTokenError) && !(err instanceof JwksUnavailableError)) throw err;
    }
  }
  const pass = readClearance(request);
  if (pass && env.ENGAGE_HMAC_KEY && (await verifyClearance(env.ENGAGE_HMAC_KEY, pass, nowSeconds))) return 'anon';
  return null;
}

export async function handleEngage(
  request: Request,
  env: EngageEnv,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<Response> {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
  if (!isAllowedOrigin(request, env.ENGAGE_ORIGINS)) return new Response('forbidden', { status: 403 });

  // Shed load before any parsing or crypto. The IP is only the limiter key.
  if (env.ENGAGE_LIMITER) {
    const { success } = await env.ENGAGE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return new Response('too many requests', { status: 429 });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return new Response('bad request', { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const parsed = parseEngagement(body);
  if (!parsed) return new Response('bad request', { status: 400 });

  const auth = await whoIsAsking(request, env, now());
  if (!auth) return new Response('forbidden', { status: 403 });

  try {
    const kind = kindOf(parsed.postId);
    for (const { event, delta } of parsed.changes) {
      env.ENGAGEMENT?.writeDataPoint({ indexes: [parsed.postId], blobs: [event, kind, auth], doubles: [delta] });
    }
  } catch {
    // Engagement is signal, never a dependency of the page.
  }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/engage.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Typecheck the Worker**

Run: `pnpm run typecheck:worker`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add worker/engage.ts worker/engage.test.ts
git commit -m "feat(engage): POST /api/engage writes reactions to Analytics Engine"
```

---

### Task 4: Routing, bindings and parity

**Files:**
- Modify: `worker/index.ts` (imports, `Env`, the `/api/*` block)
- Modify: `worker/index.test.ts` (add a routing block)
- Modify: `wrangler.jsonc` (top level and `env.staging`)
- Modify: `scripts/check-parity.mjs` (next to the `/api/search` cases, line 73)

**Interfaces:**
- Consumes: `handleEngage`, `EngageEnv` (Task 3). `handleClearance`, `ClearanceEnv` (Task 2).
- Produces: `Env` gains `ENGAGEMENT?`, `ENGAGE_LIMITER?`, `ENGAGE_ORIGINS?`, `TURNSTILE_SECRET?`, `ENGAGE_HMAC_KEY?`. Routes `/api/engage` and `/api/engage/clearance`.

- [ ] **Step 1: Write the failing routing test**

Append to `worker/index.test.ts`:

```ts
describe('engagement routes', () => {
  it('route /api/engage and /api/engage/clearance to their handlers', async () => {
    const { env } = stubEnv();
    // A GET reaches each handler, which answers 405. Without the route it would be the /api/* 404.
    expect((await worker.fetch(new Request('https://cloudcodetree.com/api/engage'), env, ctx)).status).toBe(405);
    expect((await worker.fetch(new Request('https://cloudcodetree.com/api/engage/clearance'), env, ctx)).status).toBe(405);
  });

  it('keeps other /api paths at 404', async () => {
    const { env } = stubEnv();
    expect((await worker.fetch(new Request('https://cloudcodetree.com/api/engagex'), env, ctx)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/index.test.ts`
Expected: FAIL, the first test gets 404 instead of 405.

- [ ] **Step 3: Wire the routes**

In `worker/index.ts`, add imports below the existing ones:

```ts
import { handleEngage } from './engage';
import { handleClearance } from './clearance';
```

Add to `interface Env`, after `VECTORIZE?: Vectorize;`:

```ts
  /** Engagement events: reactions, saves, reads. Optional so a missing binding drops events, never a page. */
  ENGAGEMENT?: AnalyticsEngineDataset;
  ENGAGE_LIMITER?: RateLimit;
  /** Comma-separated origins allowed to call /api/engage*. */
  ENGAGE_ORIGINS?: string;
  TURNSTILE_SECRET?: string;
  ENGAGE_HMAC_KEY?: string;
```

In `fetch`, directly after the `/api/search` block and before the `/api/` 404 catch-all:

```ts
    if (url.pathname === '/api/engage/clearance') return handleClearance(request, env);
    if (url.pathname === '/api/engage') return handleEngage(request, env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the bindings**

In `wrangler.jsonc`, top level, directly after the `"vectorize"` line:

```jsonc
  // Engagement (spec 2026-09-24-reader-reactions-design.md): reactions, saves
  // and reads as aggregate events. Staging writes its own dataset below, so
  // beta testing never touches production numbers.
  "analytics_engine_datasets": [{ "binding": "ENGAGEMENT", "dataset": "cct_engagement" }],
  // Spam damping for /api/engage. Per Cloudflare location and approximate by design.
  "ratelimits": [{ "name": "ENGAGE_LIMITER", "namespace_id": "4101", "simple": { "limit": 30, "period": 60 } }],
```

In the top-level `"vars"`, add:

```jsonc
    // Origins allowed to call /api/engage*. The 127.0.0.1 entry is the local
    // wrangler dev server the browser tests use.
    "ENGAGE_ORIGINS": "https://cloudcodetree.com,http://127.0.0.1:8788",
```

In `env.staging.vars`, add:

```jsonc
        "ENGAGE_ORIGINS": "https://beta.cloudcodetree.com,https://cct-site-staging.chris-247.workers.dev",
```

In `env.staging`, directly after its `"vectorize"` line:

```jsonc
      "analytics_engine_datasets": [{ "binding": "ENGAGEMENT", "dataset": "cct_engagement_staging" }],
      "ratelimits": [{ "name": "ENGAGE_LIMITER", "namespace_id": "4102", "simple": { "limit": 30, "period": 60 } }],
```

- [ ] **Step 6: Add the parity cases**

In `scripts/check-parity.mjs`, directly after `{ path: '/api/search', status: 400 },`:

```js
  // Engagement endpoints are POST-only. A GET proves each route reaches its
  // handler instead of the /api/* 404. The 400/403 contract is unit-tested.
  { path: '/api/engage',                          status: 405 },
  { path: '/api/engage/clearance',                status: 405 },
```

- [ ] **Step 7: Verify config and the full check**

Run: `pnpm exec wrangler deploy --dry-run --outdir /tmp/cct-dry && pnpm exec wrangler deploy --dry-run --env staging --outdir /tmp/cct-dry-staging`
Expected: both succeed and list `ENGAGEMENT` and `ENGAGE_LIMITER` among the bindings.

Run: `pnpm run check`
Expected: all tests, the Worker typecheck and lint pass.

- [ ] **Step 8: Commit**

```bash
git add worker/index.ts worker/index.test.ts wrangler.jsonc scripts/check-parity.mjs
git commit -m "feat(engage): route /api/engage and bind Analytics Engine + rate limit"
```

---

### Task 5: `reader_state.reaction` and its client persistence

**Files:**
- Create: `supabase/migrations/0007_reader_state_reaction.sql`
- Modify: `app/lib/readerState.ts` (`ReaderRow`, the select, `patchCache`, new `setReaction`)
- Modify: `app/lib/useReaderLibrary.ts` (the row literal in `toggleSaved`)
- Modify: `app/lib/readerState.test.ts` (the supabase mock, new tests)
- Modify: `tests/browser/reader-fixture.ts` (`Row` type and write merge)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type Reaction = -1 | 0 | 1`, `ReaderRow.reaction: Reaction`, `setReaction(postId: string, reaction: Reaction): Promise<boolean>`. `setReaction` persists only. It never sends engagement events.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0007_reader_state_reaction.sql
-- A reader's own like (1), dislike (-1) or nothing (0) on a post or tutorial
-- lesson. Spec: docs/superpowers/specs/2026-09-24-reader-reactions-design.md
-- The own-rows RLS policies from 0005 and the updated_at trigger from 0006
-- already cover the new column, so no policy changes. Additive with a default:
-- safe to apply before the client code that reads it ships.
alter table public.reader_state
  add column reaction smallint not null default 0
  check (reaction in (-1, 0, 1));
```

- [ ] **Step 2: Extend the test mock and write the failing tests**

In `app/lib/readerState.test.ts`, replace the `calls` object and `vi.mock` block with:

```ts
const calls = {
  select: 0, upsert: 0, failRead: false, failWrite: false,
  rows: [] as ReaderRow[], upserts: [] as Record<string, unknown>[],
};
vi.mock('./supabaseClient', () => ({
  supabase: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'reader-1' } } } }) },
    from: () => ({
      select: () => ({ order: () => ({ range: async (from: number, to: number) => { calls.select++; return { data: calls.failRead ? null : calls.rows.slice(from, to + 1), error: calls.failRead ? { message: 'offline' } : null }; } }) }),
      upsert: async (payload: Record<string, unknown>) => {
        calls.upsert++;
        calls.upserts.push(payload);
        return { error: calls.failWrite ? { message: 'offline' } : null };
      },
    }),
  }),
}));
```

Add `setReaction` to the import from `./readerState`. The file's existing `beforeEach` sits inside another `describe`, so the new block resets its own fields. Append:

```ts
describe('setReaction', () => {
  beforeEach(() => { calls.failWrite = false; calls.upserts = []; });

  it('writes only the reaction, so it cannot clobber saved or read_at', async () => {
    signIn();
    resetReaderState();
    expect(await setReaction('post-a', 1)).toBe(true);
    expect(calls.upserts.at(-1)).toEqual({ user_id: 'reader-1', post_id: 'post-a', reaction: 1 });
  });

  it('reports a failed write', async () => {
    signIn();
    resetReaderState();
    calls.failWrite = true;
    expect(await setReaction('post-a', -1)).toBe(false);
  });

  it('refuses when signed out', async () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {};
    resetReaderState();
    expect(await setReaction('post-a', 1)).toBe(false);
    expect(calls.upserts).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run app/lib/readerState.test.ts`
Expected: FAIL, `setReaction` is not exported.

- [ ] **Step 4: Implement**

In `app/lib/readerState.ts`:

Replace the `ReaderRow` interface with:

```ts
/** A reader's own reaction: like (1), none (0), dislike (-1). */
export type Reaction = -1 | 0 | 1;

export interface ReaderRow {
  post_id: string;
  saved: boolean;
  read_at: string | null;
  reaction: Reaction;
}
```

In `fetchReaderState`, change the select to `'post_id, saved, read_at, reaction'`.

In `patchCache`, change the default row to `{ post_id: postId, saved: false, read_at: null, reaction: 0 }`.

After `setSaved`, add:

```ts
/**
 * Set this reader's reaction on an item. Resolves true on success. Persists
 * only: engagement events are the caller's job, because merging signed-out
 * reactions into an account must not count them a second time.
 */
export async function setReaction(postId: string, reaction: Reaction): Promise<boolean> {
  const epoch = generation;
  const userId = await currentUserId();
  if (!userId || generation !== epoch) return false;
  try {
    const { supabase } = await import('./supabaseClient');
    const { error } = await supabase()
      .from('reader_state')
      .upsert({ user_id: userId, post_id: postId, reaction }, { onConflict: 'user_id,post_id' });
    if (!error && generation === epoch) patchCache(postId, { reaction });
    return !error && generation === epoch;
  } catch {
    return false;
  }
}
```

In `app/lib/useReaderLibrary.ts`, in `toggleSaved`, change the optimistic row to:

```ts
    setState((cur) => new Map(cur).set(id, { post_id: id, saved, read_at: before?.read_at ?? null, reaction: before?.reaction ?? 0 }));
```

In `tests/browser/reader-fixture.ts`, change the `Row` type and the write merge:

```ts
type Row = { post_id: string; saved: boolean; read_at: string | null; reaction?: -1 | 0 | 1 };
```

```ts
      rows.set(data.post_id, { post_id: data.post_id, saved: false, read_at: null, reaction: 0, ...rows.get(data.post_id), ...data });
```

- [ ] **Step 5: Run tests and the typecheck**

Run: `pnpm exec vitest run app/lib/readerState.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If it flags any `ReaderRow` literal missing `reaction` (for example in `app/lib/readerState.test.ts`), add `reaction: 0` to that literal and re-run.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_reader_state_reaction.sql app/lib/readerState.ts app/lib/useReaderLibrary.ts app/lib/readerState.test.ts tests/browser/reader-fixture.ts
git commit -m "feat(reactions): reader_state.reaction column and setReaction"
```

---

### Task 6: Engagement transport, Turnstile, CSP

**Files:**
- Create: `app/lib/engagement.ts`
- Create: `app/lib/engagement.test.ts`
- Create: `app/lib/turnstile.ts`
- Modify: `app/lib/authConfig.ts` (add `TURNSTILE_SITE_KEY`)
- Modify: `public/_headers` (`script-src`)
- Modify: `scripts/validate-csp.mjs` (`REQUIRED`)

**Interfaces:**
- Consumes: `EngagementChange` type (Task 1). `Reaction` type (Task 5).
- Produces:
  - `reactionDeltas(from: Reaction, to: Reaction): EngagementChange[]`
  - `nextReaction(current: Reaction, clicked: 1 | -1): Reaction`
  - `interface EngageDeps { fetch: typeof fetch; accessToken: () => Promise<string | null>; obtainClearance: () => Promise<boolean> }`
  - `sendEngagement(postId: string, changes: EngagementChange[], deps?: EngageDeps): Promise<void>` (never rejects)
  - `getTurnstileToken(timeoutMs?: number): Promise<string | null>`
  - `TURNSTILE_SITE_KEY: string`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run app/lib/engagement.test.ts`
Expected: FAIL, cannot resolve `./engagement`.

- [ ] **Step 3: Add the site key**

Append to `app/lib/authConfig.ts`:

```ts
// Turnstile site key: public by design, like the keys above. The widget is
// configured as Invisible for cloudcodetree.com and beta.cloudcodetree.com.
// Until Task 10 replaces it, this is Cloudflare's always-pass INVISIBLE TEST
// key. scripts/assert-variant.mjs refuses to deploy it to production.
export const TURNSTILE_SITE_KEY = '1x00000000000000000000BB';
```

- [ ] **Step 4: Write `app/lib/turnstile.ts`**

```ts
'use client';

// Invisible Turnstile, loaded only when a signed-out reader first engages.
// Readers who never react, save or read for 10 seconds never download it.
import { TURNSTILE_SITE_KEY } from './authConfig';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    'error-callback': () => void;
    'timeout-callback': () => void;
  }): string;
  remove(id: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loading: Promise<TurnstileApi | null> | null = null;

function loadScript(): Promise<TurnstileApi | null> {
  loading ??= new Promise((resolve) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.turnstile ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

/** A Turnstile token, or null when Turnstile is blocked, fails or times out. Never throws. */
export async function getTurnstileToken(timeoutMs = 15_000): Promise<string | null> {
  const api = await loadScript();
  if (!api) return null;
  return new Promise((resolve) => {
    // An invisible widget has no visual footprint, but it still needs a host
    // element in the document.
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.bottom = '0';
    host.style.right = '0';
    document.body.appendChild(host);
    let settled = false;
    let id: string | null = null;
    const done = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (id) { try { api.remove(id); } catch { /* already gone */ } }
      host.remove();
      resolve(token);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      id = api.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => done(token),
        'error-callback': () => done(null),
        'timeout-callback': () => done(null),
      });
    } catch {
      done(null);
    }
  });
}
```

- [ ] **Step 5: Write `app/lib/engagement.ts`**

```ts
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

const defaultDeps: EngageDeps = { fetch: (...args) => fetch(...args), accessToken, obtainClearance };

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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run app/lib/engagement.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 7: Allow Turnstile in the CSP**

In `public/_headers`, in the `Content-Security-Policy` line, append ` https://challenges.cloudflare.com` to the end of the `script-src` list (after `https://www.gstatic.com`).

In `scripts/validate-csp.mjs`, add to `REQUIRED`:

```js
  { origin: 'https://challenges.cloudflare.com', directive: 'script-src' }, // Turnstile, anonymous reactions
```

Run: `node scripts/validate-csp.mjs && pnpm exec vitest run scripts/validate-csp.test.mjs`
Expected: `✓ CSP allows all … required origins`, and the test passes.

- [ ] **Step 8: Commit**

```bash
git add app/lib/engagement.ts app/lib/engagement.test.ts app/lib/turnstile.ts app/lib/authConfig.ts public/_headers scripts/validate-csp.mjs
git commit -m "feat(reactions): engagement transport with a one-shot Turnstile retry"
```

---

### Task 7: Save events, local reactions, and the sign-in merge

**Files:**
- Create: `app/lib/localReactions.ts`
- Create: `app/lib/localReactions.test.ts`
- Modify: `app/lib/readerState.ts` (`setSaved` emits a save event, new `mergeLocalReactions`)
- Modify: `app/lib/readerState.test.ts`

**Interfaces:**
- Consumes: `Reaction`, `setReaction`, `ReaderStateMap` (Task 5). `sendEngagement` (Task 6).
- Produces:
  - `readLocalReactions(store?): Record<string, Reaction>`
  - `writeLocalReaction(id: string, reaction: Reaction, store?): void`
  - `clearLocalReactions(ids: string[], store?): void`
  - `mergeLocalReactions(local: Record<string, Reaction>, account: ReaderStateMap): Promise<{ applied: Record<string, Reaction>; settled: string[] }>`
  - `setSaved` now sends `save +1` or `save -1` after a successful write.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

In `app/lib/readerState.test.ts`, add near the top, after the existing `vi.mock`:

```ts
const sent: { postId: string; changes: unknown[] }[] = [];
vi.mock('./engagement', () => ({
  sendEngagement: async (postId: string, changes: unknown[]) => { sent.push({ postId, changes }); },
}));
```

Add `setSaved` and `mergeLocalReactions` to the import from `./readerState`, and append:

```ts
describe('save events', () => {
  beforeEach(() => { calls.failWrite = false; calls.upserts = []; sent.length = 0; });

  it('sends save +1 and save -1 after successful writes', async () => {
    signIn();
    resetReaderState();
    expect(await setSaved('post-a', true)).toBe(true);
    expect(await setSaved('post-a', false)).toBe(true);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      { postId: 'post-a', changes: [{ event: 'save', delta: 1 }] },
      { postId: 'post-a', changes: [{ event: 'save', delta: -1 }] },
    ]);
  });

  it('sends nothing when the write fails', async () => {
    signIn();
    resetReaderState();
    calls.failWrite = true;
    expect(await setSaved('post-a', true)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
  });
});

describe('mergeLocalReactions', () => {
  beforeEach(() => { calls.failWrite = false; calls.upserts = []; sent.length = 0; });

  it('copies local reactions where the account has none, and sends no events', async () => {
    signIn();
    resetReaderState();
    const account = new Map([
      ['has-own', { post_id: 'has-own', saved: false, read_at: null, reaction: -1 as const }],
      ['neutral', { post_id: 'neutral', saved: true, read_at: null, reaction: 0 as const }],
    ]);
    const result = await mergeLocalReactions({ 'has-own': 1, neutral: 1, fresh: -1 }, account);
    expect(result.applied).toEqual({ neutral: 1, fresh: -1 });
    expect(result.settled.sort()).toEqual(['fresh', 'has-own', 'neutral']);
    expect(calls.upserts.map((u) => [u.post_id, u.reaction])).toEqual([['neutral', 1], ['fresh', -1]]);
    expect(sent).toHaveLength(0);
  });

  it('leaves failed writes unsettled so a later visit retries them', async () => {
    signIn();
    resetReaderState();
    calls.failWrite = true;
    const result = await mergeLocalReactions({ fresh: 1 }, new Map());
    expect(result).toEqual({ applied: {}, settled: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run app/lib/localReactions.test.ts app/lib/readerState.test.ts`
Expected: FAIL, `./localReactions` does not resolve and `mergeLocalReactions` is not exported.

- [ ] **Step 3: Write `app/lib/localReactions.ts`**

```ts
'use client';

// A signed-out reader's reactions, kept in localStorage so they survive a
// reload. Every function tolerates blocked or full storage: the reaction was
// still counted, it just will not survive the page.
import type { Reaction } from './readerState';

const KEY = 'cct-reactions';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalReactions(store: Store | null = defaultStore()): Record<string, Reaction> {
  try {
    const raw = store?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const out: Record<string, Reaction> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [id, v] of Object.entries(parsed)) if (v === 1 || v === -1) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLocalReaction(id: string, reaction: Reaction, store: Store | null = defaultStore()): void {
  try {
    const all = readLocalReactions(store);
    if (reaction === 0) delete all[id];
    else all[id] = reaction;
    store?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage.
  }
}

export function clearLocalReactions(ids: string[], store: Store | null = defaultStore()): void {
  if (ids.length === 0) return;
  try {
    const all = readLocalReactions(store);
    for (const id of ids) delete all[id];
    store?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage.
  }
}
```

- [ ] **Step 4: Emit save events and add the merge in `app/lib/readerState.ts`**

In `setSaved`, replace the success line:

```ts
    if (!error && generation === epoch) patchCache(postId, { saved });
```

with:

```ts
    if (!error && generation === epoch) {
      patchCache(postId, { saved });
      // Every save path (article pages, list cards, /saved) goes through here,
      // so this is the one place the save event is sent.
      void import('./engagement').then(({ sendEngagement }) =>
        sendEngagement(postId, [{ event: 'save', delta: saved ? 1 : -1 }]));
    }
```

After `setReaction`, add:

```ts
/**
 * Copy reactions made while signed out into the account, for items where the
 * account has no reaction. Sends no engagement events: each was counted when
 * it happened. `settled` lists local entries that can be deleted: the ones
 * written, and the ones the account already overrides. Failed writes stay
 * local so a later visit retries them.
 */
export async function mergeLocalReactions(
  local: Record<string, Reaction>,
  account: ReaderStateMap,
): Promise<{ applied: Record<string, Reaction>; settled: string[] }> {
  const applied: Record<string, Reaction> = {};
  const settled: string[] = [];
  for (const [id, reaction] of Object.entries(local)) {
    if ((account.get(id)?.reaction ?? 0) !== 0) { settled.push(id); continue; }
    if (await setReaction(id, reaction)) {
      applied[id] = reaction;
      settled.push(id);
    }
  }
  return { applied, settled };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run app/lib/localReactions.test.ts app/lib/readerState.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/localReactions.ts app/lib/localReactions.test.ts app/lib/readerState.ts app/lib/readerState.test.ts
git commit -m "feat(reactions): save events, local reactions and the sign-in merge"
```

---

### Task 8: Read dwell

**Files:**
- Create: `app/lib/readDwell.ts`
- Create: `app/lib/readDwell.test.ts`
- Create: `app/lib/useReadDwell.ts`

**Interfaces:**
- Consumes: `sendEngagement` (Task 6).
- Produces: `READ_DWELL_MS = 10_000`, `MAX_SENT_READS = 2000`, `createDwell(thresholdMs: number, onReached: () => void): { show(): void; hide(): void; dispose(): void }`, `readLedger(store?): { has(id: string): boolean; add(id: string): void }`, `useReadDwell(itemId: string | null): void`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run app/lib/readDwell.test.ts`
Expected: FAIL, cannot resolve `./readDwell`.

- [ ] **Step 3: Write `app/lib/readDwell.ts`**

```ts
// A "read" is 10 cumulative seconds of the article being visible, sent once per
// item per browser. Separate from reader_state.read_at, which marks an item as
// opened immediately and drives the Hide read filter.

export const READ_DWELL_MS = 10_000;
export const MAX_SENT_READS = 2000;
const KEY = 'cct-reads-sent';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Accumulates visible time and calls `onReached` once when it crosses the threshold. */
export function createDwell(thresholdMs: number, onReached: () => void) {
  let spent = 0;
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const hide = () => {
    if (startedAt === null) return;
    spent += Date.now() - startedAt;
    startedAt = null;
    if (timer) { clearTimeout(timer); timer = null; }
  };
  const show = () => {
    if (finished || startedAt !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      finished = true;
      timer = null;
      startedAt = null;
      onReached();
    }, Math.max(0, thresholdMs - spent));
  };
  const dispose = () => { hide(); finished = true; };
  return { show, hide, dispose };
}

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The ids whose read was already sent from this browser, newest last. */
export function readLedger(store: Store | null = defaultStore()) {
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    ids = [];
  }
  return {
    has: (id: string) => ids.includes(id),
    add: (id: string) => {
      ids = [...ids.filter((x) => x !== id), id].slice(-MAX_SENT_READS);
      try { store?.setItem(KEY, JSON.stringify(ids)); } catch { /* blocked: memory only */ }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run app/lib/readDwell.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the hook `app/lib/useReadDwell.ts`**

```ts
'use client';

import { useEffect } from 'react';
import { READ_DWELL_MS, createDwell, readLedger } from './readDwell';
import { sendEngagement } from './engagement';

/** Send `read +1` for this item once per browser, after 10 visible seconds. */
export function useReadDwell(itemId: string | null): void {
  useEffect(() => {
    if (!itemId) return;
    const ledger = readLedger();
    if (ledger.has(itemId)) return;
    const dwell = createDwell(READ_DWELL_MS, () => {
      if (readLedger().has(itemId)) return;   // another tab got there first
      readLedger().add(itemId);
      void sendEngagement(itemId, [{ event: 'read', delta: 1 }]);
    });
    const sync = () => (document.visibilityState === 'visible' ? dwell.show() : dwell.hide());
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      dwell.dispose();
    };
  }, [itemId]);
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

```bash
git add app/lib/readDwell.ts app/lib/readDwell.test.ts app/lib/useReadDwell.ts
git commit -m "feat(reactions): dwell-qualified read events, once per item per browser"
```

---

### Task 9: ReactionBar on article pages

**Files:**
- Create: `app/components/ReactionBar.tsx`
- Modify: `app/components/BlogPost.tsx` (imports, one hook call, the header action row near line 95)
- Modify: `app/components/TutorialReaderControls.tsx` (render reactions for everyone)
- Create: `tests/browser/reactions.spec.ts`

**Interfaces:**
- Consumes: `loadReaderState`, `setReaction`, `mergeLocalReactions`, `watchReaderAuth`, `Reaction` (Tasks 5, 7). `readLocalReactions`, `writeLocalReaction`, `clearLocalReactions` (Task 7). `nextReaction`, `reactionDeltas`, `sendEngagement` (Task 6). `useReadDwell` (Task 8). `mockReader` (existing fixture, Task 5 update).
- Produces: `default function ReactionBar({ itemId, title }: { itemId: string; title: string })`. Accessible names `Like “<title>”` and `Dislike “<title>”`, with `aria-pressed`.

- [ ] **Step 1: Write the failing browser test**

```ts
// tests/browser/reactions.spec.ts
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { mockReader } from './reader-fixture';

const posts = JSON.parse(readFileSync('public/blog/posts.json', 'utf8')) as { id: string; title: string }[];
const post = posts[0];
const article = `/ai-news/${post.id}/`;
const likeName = `Like “${post.title}”`;
const dislikeName = `Dislike “${post.title}”`;

type Logged = { body: { post_id: string; changes: { event: string; delta: number }[] }; auth: string | null; status: number };

async function stubTurnstile(page: Page, mode: 'pass' | 'blocked' = 'pass') {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    mode === 'blocked'
      ? route.abort()
      : route.fulfill({
          contentType: 'application/javascript',
          body: 'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("test-token")},0);return "w1"},remove:function(){}};',
        }));
}

/** Stands in for the Worker: 403 until cleared or authenticated, then 204. */
async function mockEngage(page: Page) {
  const log = { engage: [] as Logged[], clearance: 0 };
  let cleared = false;
  await page.route('**/api/engage/clearance', async (route) => {
    log.clearance++;
    cleared = true;
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/engage', async (route) => {
    const req = route.request();
    const auth = req.headers()['authorization'] ?? null;
    const status = auth || cleared ? 204 : 403;
    log.engage.push({ body: req.postDataJSON(), auth, status });
    await route.fulfill({ status });
  });
  return log;
}

/** Net delta for an event across requests the Worker accepted. */
const net = (log: { engage: Logged[] }, event: string) =>
  log.engage.filter((e) => e.status === 204).flatMap((e) => e.body.changes).filter((c) => c.event === event)
    .reduce((sum, c) => sum + c.delta, 0);

test('a signed-out reader likes, switches, and keeps the choice across a reload', async ({ page }) => {
  await stubTurnstile(page);
  const log = await mockEngage(page);
  await page.goto(article);
  const like = page.getByRole('button', { name: likeName });
  const dislike = page.getByRole('button', { name: dislikeName });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => net(log, 'like')).toBe(1);
  expect(log.clearance).toBe(1);
  await dislike.click();
  await expect(dislike).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => net(log, 'dislike')).toBe(1);
  expect(net(log, 'like')).toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: dislikeName })).toHaveAttribute('aria-pressed', 'true');
});

test('a signed-in reader writes reader_state and authenticates with a bearer token', async ({ page }) => {
  await stubTurnstile(page);
  const reader = await mockReader(page);
  const log = await mockEngage(page);
  await page.goto(article);
  const like = page.getByRole('button', { name: likeName });
  await expect(like).toBeEnabled();
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => reader.writes.some((w) => w.post_id === post.id && w.reaction === 1)).toBe(true);
  await expect.poll(() => log.engage.length).toBe(1);
  expect(log.engage[0].auth).toMatch(/^Bearer /);
  expect(log.clearance).toBe(0);
});

test('rapid clicks never double-count a reaction', async ({ page }) => {
  await stubTurnstile(page);
  const log = await mockEngage(page);
  await page.goto(article);
  const like = page.getByRole('button', { name: likeName });
  await like.dblclick();
  await expect(like).toBeEnabled();
  const pressed = (await like.getAttribute('aria-pressed')) === 'true';
  await expect.poll(() => net(log, 'like')).toBe(pressed ? 1 : 0);
});

test('after signing out, the page shows local state, not the account', async ({ page }) => {
  await stubTurnstile(page);
  await mockReader(page, [{ post_id: post.id, saved: false, read_at: null, reaction: 1 }]);
  await mockEngage(page);
  await page.goto(article);
  await expect(page.getByRole('button', { name: likeName })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k); });
  await page.reload();
  await expect(page.getByRole('button', { name: likeName })).toHaveAttribute('aria-pressed', 'false');
});

test('reactions work on tutorial lessons for signed-out readers', async ({ page }) => {
  await stubTurnstile(page);
  const log = await mockEngage(page);
  await page.goto('/tutorials/build-a-rag-over-your-blog/');
  await page.getByRole('button', { name: 'Like “Build a RAG Over Your Blog”' }).click();
  await expect.poll(() => log.engage.some((e) => e.status === 204 && e.body.post_id === 'tutorial-build-a-rag-over-your-blog')).toBe(true);
});

test('a blocked Turnstile never breaks the page or loops', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubTurnstile(page, 'blocked');
  const log = await mockEngage(page);
  await page.goto(article);
  const like = page.getByRole('button', { name: likeName });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => log.engage.length).toBe(1);
  await page.getByRole('button', { name: dislikeName }).click();
  await expect.poll(() => log.engage.length).toBe(2);
  expect(log.clearance).toBe(0);
  expect(errors).toEqual([]);
});

test('a read is sent once, only after 10 visible seconds', async ({ page }) => {
  await page.clock.install();
  await stubTurnstile(page);
  const log = await mockEngage(page);
  await page.goto(article);
  const reads = () => log.engage.filter((e) => e.status === 204 && e.body.changes.some((c) => c.event === 'read')).length;
  await page.clock.fastForward(9_000);
  expect(reads()).toBe(0);
  await page.clock.fastForward(2_000);
  await expect.poll(reads).toBe(1);
  await page.clock.fastForward(60_000);
  expect(reads()).toBe(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run build && pnpm exec playwright test tests/browser/reactions.spec.ts`
Expected: FAIL, no button named `Like “…”` exists.

- [ ] **Step 3: Write `app/components/ReactionBar.tsx`**

```tsx
'use client';

// Like / dislike for one article or tutorial lesson. Works signed in (state in
// reader_state) and signed out (state in localStorage). No counts, ever: the
// reader sees only their own choice.
import { useEffect, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';
import { ThumbDown, ThumbDownOutlined, ThumbUp, ThumbUpOutlined } from '@mui/icons-material';
import { ACCENT, MONO } from './blogShared';
import { loadReaderState, mergeLocalReactions, setReaction, watchReaderAuth, type Reaction } from '../lib/readerState';
import { clearLocalReactions, readLocalReactions, writeLocalReaction } from '../lib/localReactions';
import { nextReaction, reactionDeltas, sendEngagement } from '../lib/engagement';

export default function ReactionBar({ itemId, title }: { itemId: string; title: string }) {
  const [reaction, setReactionState] = useState<Reaction>(0);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  // The settled reaction, updated synchronously. Deltas are computed from this,
  // never from render state, so two fast clicks cannot both start from "none".
  const current = useRef<Reaction>(0);
  const busy = useRef(false);
  const userRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    const show = (r: Reaction) => { current.current = r; setReactionState(r); };
    const stop = watchReaderAuth((userId) => {
      if (!live) return;
      userRef.current = userId;
      if (!userId) {
        show(readLocalReactions()[itemId] ?? 0);
        setReady(true);
        return;
      }
      setReady(false);
      void (async () => {
        try {
          const account = await loadReaderState();
          const merged = await mergeLocalReactions(readLocalReactions(), account);
          clearLocalReactions(merged.settled);
          if (!live || userRef.current !== userId) return;
          show(merged.applied[itemId] ?? account.get(itemId)?.reaction ?? 0);
          setReady(true);
        } catch {
          // Unknown account state: leave the buttons disabled rather than
          // compute deltas from a guess.
        }
      })();
    });
    return () => { live = false; stop(); };
  }, [itemId]);

  const click = async (clicked: 1 | -1) => {
    if (busy.current || !ready) return;
    busy.current = true;
    setPending(true);
    const from = current.current;
    const to = nextReaction(from, clicked);
    current.current = to;
    setReactionState(to);
    let ok = true;
    if (userRef.current) ok = await setReaction(itemId, to);
    else writeLocalReaction(itemId, to);
    if (ok) {
      void sendEngagement(itemId, reactionDeltas(from, to));
    } else {
      current.current = from;
      setReactionState(from);
    }
    busy.current = false;
    setPending(false);
  };

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <ReactionButton kind="like" active={reaction === 1} title={title} disabled={!ready || pending} onClick={() => void click(1)} />
      <ReactionButton kind="dislike" active={reaction === -1} title={title} disabled={!ready || pending} onClick={() => void click(-1)} />
    </Box>
  );
}

function ReactionButton({ kind, active, title, disabled, onClick }: {
  kind: 'like' | 'dislike'; active: boolean; title: string; disabled: boolean; onClick: () => void;
}) {
  const like = kind === 'like';
  const Icon = like ? (active ? ThumbUp : ThumbUpOutlined) : (active ? ThumbDown : ThumbDownOutlined);
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<Icon />}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`${like ? 'Like' : 'Dislike'} “${title}”`}
      sx={{
        fontFamily: MONO, fontSize: 12, textTransform: 'none',
        color: active ? ACCENT : 'text.secondary',
        borderColor: active ? 'rgba(148,188,227,0.45)' : 'rgba(148,163,184,0.25)',
        background: active ? 'rgba(148,188,227,0.12)' : 'transparent',
        '&:hover': { borderColor: ACCENT, color: ACCENT, background: 'rgba(148,188,227,0.08)' },
      }}
    >
      {like ? 'Like' : 'Dislike'}
    </Button>
  );
}
```

- [ ] **Step 4: Add it to the blog article**

In `app/components/BlogPost.tsx`, add imports:

```tsx
import ReactionBar from './ReactionBar';
import { useReadDwell } from '../lib/useReadDwell';
```

Inside `BlogPost`, directly after its existing state declarations, add:

```tsx
  useReadDwell(post.id);
```

In the header action row (the `<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>` that contains `{signedIn && (<Button … onClick={toggleSaved}`), insert as its first child, before `{signedIn && (`:

```tsx
            <ReactionBar itemId={post.id} title={post.title} />
```

- [ ] **Step 5: Render reactions on tutorial lessons for everyone**

Replace the body of `app/components/TutorialReaderControls.tsx` from `export default function` to the end of the file with:

```tsx
/** Lives in the article layout so every published MDX lesson gets the controls.
 *  `lessons` arrives already gated from the server layout. Reactions show for
 *  every reader. Save and the saved link need an account. */
export default function TutorialReaderControls({ lessons }: { lessons: LessonRef[] }) {
  const slug = usePathname().replace(/\/$/, '').split('/').pop();
  const tutorial = lessons.find((t) => t.slug === slug);
  const reader = useReaderLibrary();
  const id = tutorial ? tutorialReaderId(tutorial.slug) : null;
  useEffect(() => { if (id && reader.signedIn) markRead(id); }, [id, reader.signedIn]);
  useReadDwell(id);
  if (!tutorial || !id) return null;
  return <Box sx={{ mb: 3 }}>
    {reader.signedIn && reader.status === 'error' && <ReaderStateNotice onRetry={reader.retry} />}
    {reader.signedIn && reader.writeError && <Alert severity="warning" sx={{ mb: 2 }}>This tutorial could not be saved. Please try again.</Alert>}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <ReactionBar itemId={id} title={tutorial.title} />
      {reader.signedIn && <SaveChip post={{ title: tutorial.title, isSaved: !!reader.state.get(id)?.saved }} onToggle={() => reader.toggleSaved(id)} busy={reader.status !== 'ready' || !!reader.pending[id]} />}
      {reader.signedIn && <Button component={Link} prefetch={false} href="/saved/?section=tutorials" size="small" sx={{ textTransform: 'none' }}>Saved tutorials</Button>}
    </Box>
  </Box>;
}
```

Add these imports to the file:

```tsx
import ReactionBar from './ReactionBar';
import { useReadDwell } from '../lib/useReadDwell';
```

- [ ] **Step 6: Run the new browser tests**

Run: `pnpm run build && pnpm exec playwright test tests/browser/reactions.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Run the whole suite**

Run: `pnpm run check && pnpm exec playwright test`
Expected: everything passes, including the existing tutorial sign-out test, which must still find its private controls removed.

- [ ] **Step 8: Commit**

```bash
git add app/components/ReactionBar.tsx app/components/BlogPost.tsx app/components/TutorialReaderControls.tsx tests/browser/reactions.spec.ts
git commit -m "feat(reactions): like and dislike on articles and tutorial lessons"
```

---

### Task 10: Production guard, docs, beta acceptance

**Files:**
- Modify: `scripts/assert-variant.mjs` and `scripts/assert-variant.test.mjs`
- Modify: `app/lib/authConfig.ts` (real site key)
- Modify: `CLAUDE.md` (new subsection under "Blog")

**Interfaces:**
- Consumes: everything above.
- Produces: a production deploy that refuses the Turnstile test key. Live bindings and secrets on beta. Verified rows in `cct_engagement_staging`.

- [ ] **Step 1: Write the failing guard test**

In `scripts/assert-variant.test.mjs`, change the import to:

```js
import { TURNSTILE_TEST_SITE_KEY, classifyBuild, findTestSiteKey } from './assert-variant.mjs';
```

and append inside the `describe`:

```js
  it('finds the Turnstile always-pass test key in built scripts', () => {
    const files = [
      { file: 'out/_next/a.js', text: `k="${TURNSTILE_TEST_SITE_KEY}"` },
      { file: 'out/_next/b.js', text: 'k="0x4AAAAAAAreal"' },
    ];
    expect(findTestSiteKey(files)).toEqual(['out/_next/a.js']);
    expect(findTestSiteKey([{ file: 'out/_next/b.js', text: 'nothing' }])).toEqual([]);
  });
```

Run: `pnpm exec vitest run scripts/assert-variant.test.mjs`
Expected: FAIL, `findTestSiteKey` is not exported.

- [ ] **Step 2: Implement the guard**

In `scripts/assert-variant.mjs`, change the fs import and add `path`:

```js
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
```

After `classifyBuild`, add:

```js
/** Cloudflare's always-pass invisible Turnstile TEST site key (see app/lib/authConfig.ts). */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000BB';

/** Files that still carry the test key. Pure, so it is unit-tested without a build. */
export function findTestSiteKey(files) {
  return files.filter(({ text }) => text.includes(TURNSTILE_TEST_SITE_KEY)).map(({ file }) => file);
}

function builtScripts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return builtScripts(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}
```

In `main()`, directly before the final `console.log`, add:

```js
  // A production export with the always-pass test key would accept every
  // anonymous reaction without a real challenge.
  if (want === 'production') {
    const leaks = findTestSiteKey(builtScripts('out/_next').map((file) => ({ file, text: readFileSync(file, 'utf8') })));
    if (leaks.length) {
      console.error('✗ production export still carries the Turnstile always-pass TEST site key (app/lib/authConfig.ts)');
      console.error(`  first seen in ${leaks[0]}`);
      process.exit(1);
    }
  }
```

Run: `pnpm exec vitest run scripts/assert-variant.test.mjs`
Expected: PASS.

Commit:

```bash
git add scripts/assert-variant.mjs scripts/assert-variant.test.mjs
git commit -m "ci: refuse a production deploy that carries the Turnstile test key"
```

- [ ] **Step 3: (User) Create the Turnstile widget**

Cloudflare dashboard → Turnstile → Add widget. Name `cct-engage`. Hostnames `cloudcodetree.com` and `beta.cloudcodetree.com`. Widget mode **Invisible**. Copy the site key and the secret key.

- [ ] **Step 4: Put the real site key in place**

Replace `TURNSTILE_SITE_KEY` in `app/lib/authConfig.ts` with the real key and update its comment to drop the test-key note.

```bash
git add app/lib/authConfig.ts
git commit -m "feat(reactions): real Turnstile site key"
```

- [ ] **Step 5: (User, needs `wrangler login`) Set the secrets for both environments**

```bash
openssl rand -base64 32 | pnpm exec wrangler secret put ENGAGE_HMAC_KEY
openssl rand -base64 32 | pnpm exec wrangler secret put ENGAGE_HMAC_KEY --env staging
pnpm exec wrangler secret put TURNSTILE_SECRET               # paste the widget secret
pnpm exec wrangler secret put TURNSTILE_SECRET --env staging # same secret
```

Production and staging get different HMAC keys, so a beta clearance cookie is never valid in production.

- [ ] **Step 6: Apply migration 0007**

Beta and production share one Supabase project. The migration is additive with a default, so current production code is unaffected. Apply `supabase/migrations/0007_reader_state_reaction.sql` through the Supabase MCP `apply_migration` tool (project `tgcysgioncdmtzcfknix`, name `reader_state_reaction`). Then verify:

```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'reader_state' and column_name = 'reaction';
```

Expected: one row, `smallint`, default `0`.

- [ ] **Step 7: Deploy to beta**

```bash
pnpm run build:staging && pnpm run deploy:staging
```

Expected: the deploy succeeds and lists `ENGAGEMENT` and `ENGAGE_LIMITER`. This is the check that the rate-limit binding deploys on the Workers Free plan. If it is refused, stop and report: the fallback is to drop the binding and rely on Turnstile alone, which needs a spec change.

Then clean the topic feeds the staging build leaves behind (see the `staging-build-strands-topic-feeds` memory), before any local production build.

- [ ] **Step 8: Contract checks against beta**

```bash
B=https://beta.cloudcodetree.com
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/engage -H 'origin: https://beta.cloudcodetree.com' -H 'content-type: application/json' -d '{"post_id":"BAD","changes":[]}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/engage -H 'origin: https://beta.cloudcodetree.com' -H 'content-type: application/json' -d '{"post_id":"abc","changes":[{"event":"like","delta":1}]}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/engage -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{"post_id":"abc","changes":[{"event":"like","delta":1}]}'
node scripts/check-parity.mjs --origin $B
```

Expected: `400`, `403`, `403`, and the parity contract green including the two new `405` cases.

- [ ] **Step 9: Browser acceptance on beta**

With the Chrome DevTools MCP, open a beta article signed out:
1. Click Like. The network shows `/api/engage` 403, `/api/engage/clearance` 204, `/api/engage` 204.
2. The console shows no CSP violations and no errors.
3. Stay 10 seconds. One more `/api/engage` 204 carrying `read`.
4. Sign in, open a tutorial lesson, click Dislike. One `/api/engage` 204 with an `authorization` header, no clearance call.

- [ ] **Step 10: Confirm the rows landed, and only on staging**

Run against the Analytics Engine SQL API (`POST https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql`, body is the SQL text) with a token holding Account Analytics Read. If the `.env` token lacks that scope, use the Cloudflare MCP `execute` tool instead.

```sql
SELECT index1 AS post_id, blob1 AS event, blob2 AS kind, blob3 AS auth,
       SUM(_sample_interval * double1) AS net
FROM cct_engagement_staging
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY post_id, event, kind, auth
```

Expected: rows for the likes, dislike and read from Step 9, with `auth` `anon` and `user` as performed. The same query on `cct_engagement` returns no rows from the test.

- [ ] **Step 11: Document**

In `CLAUDE.md`, directly after the **Search analytics (2026-09).** paragraph, add:

```markdown
**Reactions and engagement (2026-09).** Spec:
`docs/superpowers/specs/2026-09-24-reader-reactions-design.md`. Every reader can
like or dislike an article or tutorial lesson. Saves and reads are recorded too.
No counts are ever shown. Two stores, two jobs. `reader_state.reaction`
(migration 0007, own-rows RLS) holds a signed-in reader's own choice. Workers
Analytics Engine (`cct_engagement`, beta `cct_engagement_staging`) holds the
aggregate stream from everyone. The browser posts signed deltas to
`POST /api/engage` (`worker/engage.ts`). The event shape lives in
`scripts/lib/engagement-contract.mjs`, shared by the Worker, the browser and the
future harvester. Signed-in requests send the live Supabase access token as
`Authorization: Bearer`. They do not use `cct_session`, which expires after an
hour and is never re-minted. Anyone else gets a 403, passes invisible Turnstile
once through `/api/engage/clearance` (a 30-minute HMAC cookie, `cct_engage`),
and retries once. A read is 10 visible seconds, sent once per item per browser.
`assert-variant.mjs` refuses a production deploy that carries the Turnstile test
site key. Next specs: the harvester and editorial posts, personal
recommendations, and Slack delivery.
```

```bash
git add CLAUDE.md
git commit -m "docs: reactions and engagement"
```

- [ ] **Step 12: Hand back for merge**

Push the branch and open a PR to `main`. Do not merge. Merging deploys production, which is the owner's call.
