#!/usr/bin/env node
/**
 * validate-csp.mjs — guard public/_headers against silently breaking a
 * third-party integration.
 *
 * GitHub Pages ignores _headers entirely, so this policy was never enforced
 * until the site moved to Cloudflare Workers. That migration is exactly when a
 * missing script-src entry turns into a broken page, so the origins the site
 * actually loads at runtime are asserted here and checked in CI.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Origins the site FETCHES at runtime. Each must be allowed by its directive. */
export const REQUIRED = [
  { origin: 'https://static.cloudflareinsights.com', directive: 'script-src' },
  { origin: 'https://cloudflareinsights.com', directive: 'connect-src' },
  { origin: 'https://api.web3forms.com', directive: 'script-src' },   // contact form
  { origin: 'https://api.web3forms.com', directive: 'connect-src' },  // form POST
  { origin: 'https://assets.calendly.com', directive: 'script-src' }, // scheduling widget
  { origin: 'https://calendly.com', directive: 'frame-src' },         // scheduling iframe
  { origin: 'https://tgcysgioncdmtzcfknix.supabase.co', directive: 'connect-src' }, // supabase auth + PostgREST (sign-in, profiles)
  { origin: 'https://challenges.cloudflare.com', directive: 'script-src' }, // Turnstile, anonymous reactions
  { origin: 'https://challenges.cloudflare.com', directive: 'frame-src' },  // Turnstile widget iframe: an explicit frame-src overrides default-src
];

export function parseCsp(headersText) {
  const line = headersText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith('content-security-policy:'));
  const map = new Map();
  if (!line) return map;
  const value = line.slice(line.indexOf(':') + 1).trim();
  for (const directive of value.split(';')) {
    const parts = directive.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    map.set(parts[0], parts.slice(1));
  }
  return map;
}

export function findViolations(csp, required = REQUIRED) {
  const problems = [];
  for (const { origin, directive } of required) {
    const sources = csp.get(directive) ?? [];
    if (!sources.includes(origin)) problems.push(`${directive} is missing ${origin}`);
  }
  return problems;
}

async function main() {
  const file = path.join(process.cwd(), 'public', '_headers');
  const csp = parseCsp(await readFile(file, 'utf8'));
  if (csp.size === 0) {
    console.error('✗ no Content-Security-Policy found in public/_headers');
    process.exit(1);
  }
  const problems = findViolations(csp);
  if (problems.length > 0) {
    console.error('✗ CSP would block origins the site actually uses:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\n  Add the origin to public/_headers, or remove it from REQUIRED');
    console.error('  in this script if the integration is gone.');
    process.exit(1);
  }
  console.log(`✓ CSP allows all ${REQUIRED.length} required origins`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
