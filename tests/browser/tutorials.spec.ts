import { test, expect } from '@playwright/test';
import { mockReader } from './reader-fixture';

const slug = 'build-a-rag-over-your-blog';
const id = `tutorial-${slug}`;
const title = 'Build a RAG Over Your Blog';
const saveLabel = `Save “${title}” for later`;
const unsaveLabel = `Remove “${title}” from saved`;

test('tutorial topics filter courses and link to their own static landing pages and feeds', async ({ page, request }) => {
  const preview = process.env.EXPECT_TUTORIAL_PREVIEW === '1'
    || (process.env.PLAYWRIGHT_BASE_URL?.includes('beta.cloudcodetree.com') ?? false);
  let privateRequests = 0;
  page.on('request', (request) => { if (request.url().includes('.supabase.co')) privateRequests++; });
  await page.goto('/tutorials/');
  await expect(page.getByRole('heading', { name: /Become a full-stack AI engineer/ })).toHaveCount(preview ? 1 : 0);
  expect((await request.get('/tutorials/dealfinder-part-01/')).status()).toBe(preview ? 200 : 404);
  if (preview) await expect(page.getByRole('status')).toContainText('BETA PREVIEW');
  await page.getByRole('button', { name: 'Topics', exact: true }).click();
  await page.getByRole('textbox', { name: 'Filter topics' }).fill('RAG');
  await page.getByRole('button', { name: /^RAG \d+$/ }).click();
  await expect(page).toHaveURL(/topics=RAG/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: /Become a full-stack AI engineer/ })).toBeHidden();
  await page.getByRole('button', { name: 'Topics · 1', exact: true }).click();
  await page.getByRole('link', { name: 'Open the RAG topic page' }).click();
  await expect(page).toHaveURL(/\/tutorials\/topic\/rag\//);
  await expect(page.getByRole('heading', { name: 'RAG tutorials', exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://cloudcodetree.com/tutorials/topic/rag/');
  const feed = await request.get('/tutorials/topic/rag/feed.xml');
  expect(feed.ok()).toBe(true);
  const xml = await feed.text();
  expect(xml).toContain('RAG · Tutorials · CloudCodeTree');
  expect(xml).toContain('tutorial-build-a-rag-over-your-blog');
  expect(xml).not.toContain('/ai-news/');
  const merged = await request.get('/tutorials/feed.xml?topics=rag,python');
  expect(merged.ok()).toBe(true);
  expect(await merged.text()).toContain('Tutorials ·');
  expect(privateRequests).toBe(0);
});

test('tutorial search, pagination and layout preferences survive reload', async ({ page }) => {
  await page.goto('/tutorials/all/');
  await page.getByRole('combobox', { name: 'Tutorials per page' }).click();
  await page.getByRole('option', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: 'Go to page 2', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'page 2', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('combobox', { name: 'Tutorials per page' })).toHaveText('5');
  await page.getByRole('button', { name: 'Compact list', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search tutorials' }).fill('embeddings');
  await expect(page).toHaveURL(/q=embeddings/);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search tutorials' })).toHaveValue('embeddings');
  await expect(page.getByRole('button', { name: 'Compact list', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('searchbox', { name: 'Search tutorials' }).fill('no-such-tutorial-xyz');
  await expect(page.getByText('No tutorials match. Try another search or clear your topics.')).toBeVisible();
});

test('tutorial saves persist, opening records read state, and saved tabs keep each content type separate', async ({ page, request }) => {
  const home = await (await request.get('/')).text();
  const blogId = /href="\/ai-news\/(20[^/]+)\//.exec(home)![1];
  const reader = await mockReader(page, [{ post_id: blogId, saved: true, read_at: null }]);
  await page.goto('/tutorials/all/');
  await page.getByRole('button', { name: saveLabel, exact: true }).click();
  await expect.poll(() => reader.rows.get(id)?.saved).toBe(true);
  await page.goto(`/tutorials/${slug}/`);
  await expect.poll(() => reader.rows.get(id)?.read_at).toBeTruthy();
  await expect(page.getByRole('button', { name: unsaveLabel, exact: true })).toBeVisible();
  await page.goto('/tutorials/all/');
  await page.getByRole('button', { name: 'Hide read', exact: true }).click();
  await expect(page.locator(`main a[href="/tutorials/${slug}/"]`)).toHaveCount(0);
  await page.getByRole('link', { name: 'Saved tutorials', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Tutorials', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`main a[href="/tutorials/${slug}/"]`).first()).toBeVisible();
  await expect(page.locator('main a[href^="/ai-news/20"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Blog', exact: true }).click();
  await expect(page.locator(`main a[href="/ai-news/${blogId}/"]`).first()).toBeVisible();
  await expect(page.locator(`main a[href="/tutorials/${slug}/"]`)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Tutorials', exact: true }).click();
  await page.getByRole('button', { name: unsaveLabel, exact: true }).click();
  await expect.poll(() => reader.rows.get(id)?.saved).toBe(false);
  await expect(page.getByText('No saved tutorials yet — use Save on a lesson to keep it here.')).toBeVisible();
});

test('tutorial write failures roll back and sign-out removes private reader controls', async ({ page }) => {
  const reader = await mockReader(page);
  await page.goto('/tutorials/all/');
  reader.failWrites = true;
  await page.getByRole('button', { name: saveLabel, exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('could not be saved');
  await expect(page.getByRole('button', { name: saveLabel, exact: true })).toBeEnabled();
  reader.failWrites = false;
  await page.getByRole('button', { name: saveLabel, exact: true }).click();
  await expect.poll(() => reader.rows.get(id)?.saved).toBe(true);
  await page.goto('/saved/?section=tutorials');
  await expect(page.getByRole('button', { name: unsaveLabel, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account: browser-test@example.invalid', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Sign in to save tutorials and find them here.')).toBeVisible();
  await expect(page.getByRole('button', { name: unsaveLabel, exact: true })).toBeHidden();
});
