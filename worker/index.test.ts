import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

function stubEnv() {
  const assetFetch = vi.fn(
    async (_request: Request) =>
      new Response('<!doctype html><title>ok</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  );
  const env = {
    ASSETS: { fetch: assetFetch },
    PRODUCTION_HOSTNAME: 'cloudcodetree.com',
  } as unknown as Env;
  return { env, assetFetch };
}

describe('pass-through worker', () => {
  it('returns the asset response unchanged', async () => {
    const { env } = stubEnv();
    const res = await worker.fetch(new Request('https://cloudcodetree.com/about/'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>ok</title>');
  });

  it('forwards non-gated requests to the assets binding verbatim', async () => {
    // Demo paths are gated as of Phase 2 (see gate.test.ts); pass-through now
    // covers only ordinary asset misses.
    const { env, assetFetch } = stubEnv();
    const request = new Request('https://cloudcodetree.com/some-missing-page/');
    await worker.fetch(request, env, ctx);
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(assetFetch.mock.calls[0][0]).toBe(request);
  });
});

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
