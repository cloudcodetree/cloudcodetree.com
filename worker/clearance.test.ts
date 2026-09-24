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
