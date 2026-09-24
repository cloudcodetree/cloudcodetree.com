/// <reference types="@cloudflare/workers-types" />

import { InvalidTokenError, JwksUnavailableError, readCookie, verifyToken } from './auth';
import { handleSession } from './session';
import { isNavigation, logDemoOpen } from './events';
import { handleSearch } from './search';
import { handleFeed } from './feed';
import { handleEngage } from './engage';
import { handleClearance } from './clearance';

export interface Env {
  ASSETS: Fetcher;
  /** Canonical production hostname. Any other hostname is a staging origin. */
  PRODUCTION_HOSTNAME: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Supabase user id of the site owner — the only account /admin/* answers to. */
  OWNER_USER_ID?: string;
  /** Workers AI + Vectorize — the search endpoint. Optional so a missing binding degrades to 503, never a crash. */
  AI?: Ai;
  VECTORIZE?: Vectorize;
  /** Engagement events: reactions, saves, reads. Optional so a missing binding drops events, never a page. */
  ENGAGEMENT?: AnalyticsEngineDataset;
  ENGAGE_LIMITER?: RateLimit;
  /** Comma-separated origins allowed to call /api/engage*. */
  ENGAGE_ORIGINS?: string;
  TURNSTILE_SECRET?: string;
  ENGAGE_HMAC_KEY?: string;
}

// Gated: the live demos only — /projects/<slug>/demo/*. Landing pages, the
// gallery, and covers are public (owner decision 2026-09-03).
const GATED_PATH = /^\/projects\/([a-z0-9-]+)\/demo\//;
// Owner-only: /admin/* (the analytics dashboard). Anyone else gets a 404, not
// a 403 — the pages should not be discoverable. The database applies the same
// owner check again inside owner_analytics(), so the Worker is not the only wall.
const ADMIN_PATH = /^\/admin(\/|$)/;

/**
 * This handler runs only for `run_worker_first` paths (/api/*, the demo
 * gate, /ai-news/feed.xml) and asset misses; every ordinary page is served
 * at the edge.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/session' || url.pathname === '/api/session/') {
      return handleSession(request, env);
    }
    if (url.pathname === '/api/search' || url.pathname === '/api/search/') {
      return handleSearch(request, env, ctx);
    }
    if (url.pathname === '/api/engage/clearance') return handleClearance(request, env);
    if (url.pathname === '/api/engage') return handleEngage(request, env);
    if (url.pathname.startsWith('/api/')) {
      return new Response('not found', { status: 404 });
    }
    // The one static asset the Worker may rewrite: ?topics= merges the
    // per-topic feeds. Without the parameter it hands back the file untouched.
    if (url.pathname === '/ai-news/feed.xml' || url.pathname === '/tutorials/feed.xml') {
      return handleFeed(request, env, ctx);
    }

    const gated = url.pathname.match(GATED_PATH);
    if (gated) return gate(request, env, ctx, url, gated[1]);

    if (ADMIN_PATH.test(url.pathname)) return ownerGate(request, env, url);

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

const notFound = () => new Response('not found', { status: 404 });

async function ownerGate(request: Request, env: Env, url: URL): Promise<Response> {
  // Fail closed: no owner configured, or no auth backend, means no admin at all.
  if (!env.SUPABASE_URL || !env.OWNER_USER_ID) return notFound();

  const token = readCookie(request);
  if (!token) {
    // Signed out: let the site-wide sign-in handler bring them back here.
    const dest = new URL('/', url);
    dest.searchParams.set('signin', '1');
    dest.searchParams.set('next', url.pathname);
    return Response.redirect(dest.toString(), 302);
  }

  try {
    const payload = await verifyToken(token, env.SUPABASE_URL);
    if (payload.sub !== env.OWNER_USER_ID) return notFound();
    return env.ASSETS.fetch(request);
  } catch (err) {
    if (err instanceof InvalidTokenError) return notFound();
    if (err instanceof JwksUnavailableError) return new Response('auth unavailable', { status: 503 });
    throw err;
  }
}

// Bounce to the project's (public) landing page — it hosts the launch button
// and the site-wide ?signin=1 handler continues to the demo after sign-in.
function signinRedirect(url: URL, slug: string): Response {
  const dest = new URL(`/projects/${slug}/`, url);
  dest.searchParams.set('signin', '1');
  dest.searchParams.set('next', url.pathname);
  return Response.redirect(dest.toString(), 302);
}

async function gate(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  slug: string,
): Promise<Response> {
  // Misconfiguration must fail closed, never open.
  if (!env.SUPABASE_URL) return new Response('auth unavailable', { status: 503 });

  const token = readCookie(request);
  if (!token) return signinRedirect(url, slug);

  try {
    const payload = await verifyToken(token, env.SUPABASE_URL);
    if (isNavigation(request) && typeof payload.sub === 'string') {
      logDemoOpen(env, ctx, { token, userId: payload.sub, slug, request });
    }
    return env.ASSETS.fetch(request);
  } catch (err) {
    if (err instanceof InvalidTokenError) return signinRedirect(url, slug);
    if (err instanceof JwksUnavailableError) return new Response('auth unavailable', { status: 503 });
    throw err;
  }
}
