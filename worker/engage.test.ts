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
