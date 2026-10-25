import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import { beat, runKeepalive } from './keepalive';

const SUPABASE_URL = 'https://demo-ref.supabase.co';
const base = { SUPABASE_URL, SUPABASE_ANON_KEY: 'anon-key' };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('supabase keepalive', () => {
  it('calls the throttled heartbeat RPC with the public key and reports the beat time', async () => {
    const fetchFn = stubFetch(async () => Response.json('2026-10-25T21:00:00+00:00'));
    const r = await beat(base);
    expect(r).toEqual({ ok: true, status: 200, beatAt: '2026-10-25T21:00:00+00:00' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/rest/v1/rpc/keepalive_beat`);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-key');
    expect(headers.authorization).toBe('Bearer anon-key');
  });

  it('reports a non-2xx answer as a failure with its status', async () => {
    stubFetch(async () => new Response('function not found', { status: 404 }));
    const r = await beat(base);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toContain('function not found');
  });

  it('reports an unreachable project (a paused project stops resolving) as status 0', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND'); });
    const r = await beat(base);
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(r.error).toContain('ENOTFOUND');
  });

  it('does not call anything when the Supabase config is missing', async () => {
    const fetchFn = stubFetch(async () => new Response(null));
    const r = await beat({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '' });
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('pings the dead-man switch on success and its /fail endpoint on failure', async () => {
    const hc = 'https://hc-ping.com/abc';
    let fetchFn = stubFetch(async (url) => (url === hc ? new Response('OK') : Response.json('t')));
    await beat({ ...base, HEALTHCHECK_URL: hc });
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([`${SUPABASE_URL}/rest/v1/rpc/keepalive_beat`, hc]);

    fetchFn = stubFetch(async (url) => (url.startsWith(hc) ? new Response('OK') : new Response('down', { status: 503 })));
    await beat({ ...base, HEALTHCHECK_URL: hc });
    expect(fetchFn.mock.calls[1][0]).toBe(`${hc}/fail`);
  });

  it('never lets a broken dead-man switch hide a good heartbeat', async () => {
    stubFetch(async (url) => {
      if (url.startsWith('https://hc-ping.com')) throw new TypeError('hc down');
      return Response.json('t');
    });
    await expect(beat({ ...base, HEALTHCHECK_URL: 'https://hc-ping.com/abc' })).resolves.toMatchObject({ ok: true });
  });

  it('throws from the cron entry point when the heartbeat fails, so the invocation is marked as an error', async () => {
    stubFetch(async () => new Response('down', { status: 503 }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runKeepalive(base)).rejects.toThrow('status 503');
  });

  it('is wired to the Worker scheduled() handler', async () => {
    const fetchFn = stubFetch(async () => Response.json('t'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = { ...base, PRODUCTION_HOSTNAME: 'cloudcodetree.com' } as unknown as Env;
    await worker.scheduled!({ cron: '17 9 * * *', scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env);
    expect(fetchFn).toHaveBeenCalledWith(`${SUPABASE_URL}/rest/v1/rpc/keepalive_beat`, expect.anything());
  });
});
