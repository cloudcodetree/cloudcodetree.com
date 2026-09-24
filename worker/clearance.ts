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
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
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
