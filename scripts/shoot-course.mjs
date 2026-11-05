#!/usr/bin/env node
// Regenerate DealFinder lesson screenshots from each step's own manifest.
//
//   node scripts/shoot-course.mjs --steps 01          # or 01,02, or all
//   node scripts/shoot-course.mjs --steps all --companion ~/Development/tutorial-dealfinder --port 8710
//
// Per step: a git worktree of the companion at the locked SHA (content/course/snippets.json),
// a venv with `pip install -e .`, the manifest's setup commands, then uvicorn in the
// capture baseline env. Per shot: the viewport, the route, the ready selector, an
// amber ring on each highlight match, then a screenshot with the masks applied.
// A PNG is written only when it really changed (scripts/lib/screen-diff.mjs). A failed
// shot never replaces or deletes an existing PNG. Exits 1 when any shot failed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenDiffers } from './lib/screen-diff.mjs';
import { companion, ensureCommits, mustGit } from './sync-course-snippets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNIPPETS = 'content/course/snippets.json';
const SCREENS = 'public/tutorials/screens';
const PYTHON = process.env.PYTHON ?? 'python3';
// Task 3's clean env (course/tools/capture.py BASELINE and KEEP).
// PYTHON_DOTENV_DISABLED: the step's worktree sits inside this checkout, and load_dotenv()
// searches parent directories, so without it the step would read this repo's .env.
const BASELINE = {
  TZ: 'UTC', LC_ALL: 'C.UTF-8', PYTHONHASHSEED: '0', COLUMNS: '100', NO_COLOR: '1', DEALFINDER_ENABLE_PAID_SOURCES: '0',
  PYTHON_DOTENV_DISABLED: '1',
};

export const RING_CSS = '[data-course-ring]{outline:3px solid #f59f00 !important;outline-offset:3px !important;border-radius:6px}';

/** The selected step ids, sorted. `all` is every locked step. */
export function parseSteps(arg, lock) {
  if (arg === 'all') return Object.keys(lock).sort();
  if (!/^\d{2}(,\d{2})*$/.test(arg ?? '')) throw new Error('--steps is "all" or a list like 01,02');
  const ids = [...new Set(arg.split(','))].sort();
  for (const id of ids) if (!lock[id]) throw new Error(`step ${id} is not in ${SNIPPETS}`);
  return ids;
}

/** The highlight selectors that matched no element. A shot with any is not the lesson's screen. */
export function missingHighlights(selectors, counts) {
  return selectors.filter((_, i) => counts[i] === 0);
}

/** The env the step's server runs in: the capture baseline, the venv first on PATH, no keys. */
export function shotEnv(manifest, base, venv) {
  const env = { PATH: `${venv}/bin:${base.PATH ?? ''}`, ...(base.HOME ? { HOME: base.HOME } : {}), VIRTUAL_ENV: venv, ...BASELINE };
  if (manifest.needs_db) {
    if (!base.DATABASE_URL) throw new Error(`step ${manifest.id} needs a database: set DATABASE_URL`);
    env.DATABASE_URL = base.DATABASE_URL;
  }
  return env;
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}:\n${(r.stdout ?? '') + (r.stderr ?? '')}`.slice(0, 4000));
  return r.stdout;
}

async function waitForHealth(url, server, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`the server exited ${server.exitCode} before ${url} answered`);
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s`);
}

async function shootStep(nn, step, repo, port, results) {
  const { chromium } = await import('@playwright/test');
  const tree = path.join(ROOT, '.cache/course-shots', nn);
  let server = null;
  let browser = null;
  rmSync(tree, { recursive: true, force: true });
  mustGit(repo, ['worktree', 'prune']);
  mustGit(repo, ['worktree', 'add', '--quiet', '--detach', tree, step.sha]);
  try {
    const manifest = JSON.parse(run(PYTHON, ['course/tools/steps.py', 'manifest', nn, '--json', '--repo', '.'], { cwd: tree }));
    // Both become path segments under public/.
    if (manifest.lesson !== step.lesson) throw new Error(`manifest lesson ${manifest.lesson} is not the locked ${step.lesson}`);
    const bad = manifest.shots.find((s) => !/^[a-z0-9-]+$/.test(s.name));
    if (bad) throw new Error(`shot name ${JSON.stringify(bad.name)} is not lowercase letters, digits and hyphens`);
    if (!manifest.shots.length) {
      console.log(`step ${nn}: no shots`);
      return;
    }
    const venv = path.join(tree, '.venv');
    const env = shotEnv(manifest, process.env, venv);
    run(PYTHON, ['-m', 'venv', venv], { cwd: tree });
    run(path.join(venv, 'bin/pip'), ['install', '--quiet', '-e', '.'], { cwd: tree, env });
    for (const cmd of manifest.setup) run('bash', ['-o', 'pipefail', '-c', cmd], { cwd: tree, env });

    server = spawn(path.join(venv, 'bin/uvicorn'), ['dealfinder.serve:app', '--host', '127.0.0.1', '--port', String(port)],
      { cwd: tree, env, stdio: ['ignore', 'ignore', 'inherit'] });
    const origin = `http://127.0.0.1:${port}`;
    await waitForHealth(`${origin}/healthz`, server, 60_000);

    browser = await chromium.launch();
    for (const shot of manifest.shots) {
      const label = `step ${nn} ${shot.name}`;
      const out = path.join(SCREENS, manifest.lesson, `${shot.name}.png`);
      const context = await browser.newContext({ viewport: shot.viewport });
      try {
        const page = await context.newPage();
        await page.goto(origin + shot.route);
        await page.waitForSelector(shot.ready, { timeout: 30_000 });
        const counts = [];
        for (const sel of shot.highlight) {
          counts.push(await page.$$eval(sel, (els) => {
            els.forEach((el) => el.setAttribute('data-course-ring', ''));
            return els.length;
          }));
        }
        const missing = missingHighlights(shot.highlight, counts);
        if (missing.length) throw new Error(`highlight matched nothing: ${missing.join(', ')}`);
        await page.addStyleTag({ content: RING_CSS });
        // Web fonts settle layout; the two frames let the ring paint.
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const png = await page.screenshot({ fullPage: shot.full_page, mask: shot.mask.map((sel) => page.locator(sel)) });
        const abs = path.join(ROOT, out);
        const old = existsSync(abs) ? readFileSync(abs) : null;
        if (await screenDiffers(old, png)) {
          mkdirSync(path.dirname(abs), { recursive: true });
          writeFileSync(abs, png);
          results.push(['written', label, out]);
        } else {
          results.push(['unchanged', label, out]);
        }
      } catch (e) {
        results.push(['failed', label, e.message.split('\n')[0]]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) server.kill('SIGTERM');
    mustGit(repo, ['worktree', 'remove', '--force', tree]);
  }
}

async function main(argv) {
  const value = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
  const lock = JSON.parse(readFileSync(path.join(ROOT, SNIPPETS), 'utf8')).steps;
  const ids = parseSteps(value('--steps'), lock);
  const port = Number(value('--port', '8710'));
  const repo = companion(value('--companion', null));
  ensureCommits(repo, Object.fromEntries(ids.map((id) => [id, lock[id]])));
  const results = [];
  for (const nn of ids) {
    try {
      await shootStep(nn, lock[nn], repo, port, results);
    } catch (e) {
      results.push(['failed', `step ${nn}`, e.message.split('\n').slice(0, 6).join('\n')]);
    }
  }
  for (const [status, label, detail] of results) console.log(`${status} ${label}: ${detail}`);
  return results.some(([status]) => status === 'failed') ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.log(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}
