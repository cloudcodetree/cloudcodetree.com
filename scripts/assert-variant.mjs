#!/usr/bin/env node
/**
 * assert-variant.mjs <staging|production> — refuse to deploy the wrong build.
 *
 * Deploying a production build (assets pinned to https://cloudcodetree.com)
 * to the staging Worker yields HTML that returns 200 while every script and
 * font 404s — a blank page that passes status-code checks. It happened on
 * 2026-09-03 attaching beta. This makes the mistake impossible to repeat:
 * `pnpm run deploy:staging` / `deploy:prod` gate on the built variant.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function classifyBuild(headers, html) {
  const hasNoindex = headers.includes('X-Robots-Tag: noindex');
  const prodAssets = html.includes('https://cloudcodetree.com/_next');
  const contentPreview = html.includes('BETA PREVIEW');
  if (hasNoindex && !prodAssets && contentPreview) return 'staging';
  if (!hasNoindex && !contentPreview) return 'production';
  return 'mixed';
}

/** Cloudflare's always-pass invisible Turnstile TEST site key (see app/lib/authConfig.ts). */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000BB';

/** Files that still carry the test key. Pure, so it is unit-tested without a build. */
export function findTestSiteKey(files) {
  return files.filter(({ text }) => text.includes(TURNSTILE_TEST_SITE_KEY)).map(({ file }) => file);
}

function builtScripts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return builtScripts(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function main() {
  const want = process.argv[2];
  if (!['staging', 'production'].includes(want)) {
    console.error('usage: assert-variant.mjs <staging|production>'); process.exit(2);
  }
  if (!existsSync('out/index.html')) { console.error('✗ out/ missing — build first'); process.exit(1); }

  const headers = readFileSync('out/_headers', 'utf8');
  const html = readFileSync('out/tutorials/index.html', 'utf8');
  const is = classifyBuild(headers, html);
  if (is !== want) {
    console.error(`✗ out/ is a ${is} build; refusing to deploy as ${want}.`);
    console.error(want === 'staging' ? '  run: pnpm run build:staging' : '  run: pnpm run build && node scripts/fetch-demo-artifacts.mjs');
    process.exit(1);
  }
  // A production export with the always-pass test key would accept every
  // anonymous reaction without a real challenge.
  if (want === 'production') {
    const leaks = findTestSiteKey(builtScripts('out/_next').map((file) => ({ file, text: readFileSync(file, 'utf8') })));
    if (leaks.length) {
      console.error('✗ production export still carries the Turnstile always-pass TEST site key (app/lib/authConfig.ts)');
      console.error(`  first seen in ${leaks[0]}`);
      process.exit(1);
    }
  }
  console.log(`✓ out/ is a ${is} build`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
