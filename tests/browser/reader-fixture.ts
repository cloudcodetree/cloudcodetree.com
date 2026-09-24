import type { Page } from '@playwright/test';

type Row = { post_id: string; saved: boolean; read_at: string | null; reaction?: -1 | 0 | 1 };
/** A browser-only account: every Supabase and session request is intercepted. */
export async function mockReader(page: Page, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [row.post_id, row]));
  const control = { rows, failWrites: false, failReads: false, writes: [] as Record<string, unknown>[] };
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'browser-test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', exp: expires_at })).toString('base64url'), 'mock-signature'].join('.');
  await page.addInitScript((session) => {
    // Set only once: later navigations must preserve sign-out and preference tests.
    if (!sessionStorage.getItem('reader-fixture')) {
      localStorage.setItem('sb-tgcysgioncdmtzcfknix-auth-token', JSON.stringify(session));
      sessionStorage.setItem('reader-fixture', '1');
    }
  }, { access_token: token, refresh_token: 'mock-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user });
  await page.route('**/api/session', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/rest/v1/reader_state') {
      if (request.method() === 'GET') {
        if (control.failReads) return route.fulfill({ status: 503, json: { message: 'offline' } });
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || 500);
        return route.fulfill({ json: Array.from(rows.values()).sort((a, b) => a.post_id.localeCompare(b.post_id)).slice(offset, offset + limit) });
      }
      const data = request.postDataJSON();
      control.writes.push(data);
      if (control.failWrites) return route.fulfill({ status: 503, json: { message: 'offline' } });
      rows.set(data.post_id, { post_id: data.post_id, saved: false, read_at: null, reaction: 0, ...rows.get(data.post_id), ...data });
      return route.fulfill({ status: 201, body: '' });
    }
    return route.fulfill({ json: url.pathname.startsWith('/auth/') ? { user } : [] });
  });
  return control;
}
