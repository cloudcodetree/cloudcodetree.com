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
