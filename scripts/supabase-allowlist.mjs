#!/usr/bin/env node
/**
 * supabase-allowlist.mjs — ADD patterns to the shared Supabase project's auth
 * redirect allowlist, keeping every existing entry.
 *
 *   node scripts/supabase-allowlist.mjs --add 'http://127.0.0.1:8000/**' [--add …] [--dry-run]
 *
 * The project (cct-demos) is shared by cloudcodetree.com and DealFinder, so this
 * never replaces the list and never touches site_url or providers. Use it instead
 * of configure-auth.mjs, which rewrites the whole list.
 *
 * Reads the Management API token from .env itself, the same way configure-auth.mjs
 * does (SUPABASE_ACCESS_TOKEN, or the sbp_ value under GOOGLE_ACCESS_TOKEN). It
 * prints only the before and after allowlists, which are public URLs.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Comma-joined union of `current` and `add`: existing order kept, no duplicates. */
export function mergeAllowList(current, add) {
  const out = (current || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of add) if (p && !out.includes(p)) out.push(p);
  return out.join(',');
}

function parseEnv(p) {
  const out = {};
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

function parseArgs(argv) {
  const add = [];
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--add' && argv[i + 1]) add.push(argv[++i]);
    else if (argv[i] === '--dry-run') dryRun = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!add.length) throw new Error('nothing to add: pass --add <pattern>');
  return { add, dryRun };
}

async function main() {
  const { add, dryRun } = parseArgs(process.argv.slice(2));
  const env = { ...parseEnv('.env'), ...parseEnv('.env.local') };
  const token = [env.SUPABASE_ACCESS_TOKEN, env.GOOGLE_ACCESS_TOKEN].find((t) => t?.startsWith('sbp_'));
  const ref = env.SUPABASE_PROJECT_ID ?? (env.SUPABASE_PROJECT_URL && new URL(env.SUPABASE_PROJECT_URL).hostname.split('.')[0]);
  if (!token || !ref) {
    console.error('✗ missing an sbp_ Management API token or the project ref in .env');
    process.exit(1);
  }
  const API = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const before = await (await fetch(API, { headers })).json();
  if (before.message) { console.error(`✗ management API: ${before.message}`); process.exit(1); }
  const after = mergeAllowList(before.uri_allow_list, add);
  console.log('before:', before.uri_allow_list || '(empty)');
  console.log('after: ', after);
  if (after === (before.uri_allow_list || '')) { console.log('· nothing to change'); return; }
  if (dryRun) { console.log('· dry run: nothing written'); return; }

  const res = await fetch(API, { method: 'PATCH', headers, body: JSON.stringify({ uri_allow_list: after }) });
  if (!res.ok) { console.error(`✗ PATCH failed: HTTP ${res.status}`); process.exit(1); }
  const check = await (await fetch(API, { headers })).json();
  console.log(check.uri_allow_list === after ? '✓ allowlist updated' : '✗ allowlist did not take the new value');
  if (check.uri_allow_list !== after) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => { console.error(`✗ ${err.message}`); process.exit(1); });
}
