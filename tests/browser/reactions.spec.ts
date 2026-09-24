// tests/browser/reactions.spec.ts
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { mockReader } from './reader-fixture';

const posts = JSON.parse(readFileSync('public/blog/posts.json', 'utf8')) as { id: string; title: string }[];
const post = posts[0];
const article = `/ai-news/${post.id}/`;
// exact: true on every lookup, because role names match as case-insensitive
// substrings and "Like “X”" is inside "Dislike “X”".
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
  const like = page.getByRole('button', { name: likeName, exact: true });
  const dislike = page.getByRole('button', { name: dislikeName, exact: true });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => net(log, 'like')).toBe(1);
  expect(log.clearance).toBe(1);
  await dislike.click();
  await expect(dislike).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => net(log, 'dislike')).toBe(1);
  expect(net(log, 'like')).toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: dislikeName, exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a signed-in reader writes reader_state and authenticates with a bearer token', async ({ page }) => {
  await stubTurnstile(page);
  const reader = await mockReader(page);
  const log = await mockEngage(page);
  await page.goto(article);
  const like = page.getByRole('button', { name: likeName, exact: true });
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
  const like = page.getByRole('button', { name: likeName, exact: true });
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
  await expect(page.getByRole('button', { name: likeName, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k); });
  await page.reload();
  await expect(page.getByRole('button', { name: likeName, exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('reactions work on tutorial lessons for signed-out readers', async ({ page }) => {
  await stubTurnstile(page);
  const log = await mockEngage(page);
  await page.goto('/tutorials/build-a-rag-over-your-blog/');
  await page.getByRole('button', { name: 'Like “Build a RAG Over Your Blog”', exact: true }).click();
  await expect.poll(() => log.engage.some((e) => e.status === 204 && e.body.post_id === 'tutorial-build-a-rag-over-your-blog')).toBe(true);
});

test('a blocked Turnstile never breaks the page or loops', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubTurnstile(page, 'blocked');
  const log = await mockEngage(page);
  await page.goto(article);
  const like = page.getByRole('button', { name: likeName, exact: true });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => log.engage.length).toBe(1);
  await page.getByRole('button', { name: dislikeName, exact: true }).click();
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
