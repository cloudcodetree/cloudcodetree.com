#!/usr/bin/env node
// Copy the companion code and outputs that DealFinder lessons include into
// content/course/snippets.json, the one file the remark plugin reads at build time.
//
//   node scripts/sync-course-snippets.mjs                 # rewrite the file from the locked steps
//   node scripts/sync-course-snippets.mjs --update-lock   # first re-lock steps to the course tip
//   node scripts/sync-course-snippets.mjs --check         # write nothing; exit 1 on drift (CI)
//   node scripts/sync-course-snippets.mjs --strict        # every series lesson needs a step (release gate)
//
// Every file is read with `git show <step sha>:<path>`, so a lesson shows its code
// exactly as it was at its own step. The companion is --companion, else
// companions/dealfinder, else a blobless clone in .cache/course-companion. Node
// never parses TOML: the lock comes from the companion's own `steps.py matrix --json`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CourseAnchorError, extractAnchor } from './lib/course-anchors.mjs';
import { parseFenceMeta } from './lib/remark-course-include.mjs';
import { readTutorials } from './lib/tutorials-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'content/course/snippets.json';
const REPO = 'https://github.com/cloudcodetree/tutorial-dealfinder';
const SERIES = 'Become a Full-Stack AI Engineer';
const LESSONS = 'app/tutorials/(article)';
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MANUAL = /^# manual: (.+?) · captured (\S+)\s*$/;
const LANGS = {
  py: 'python', ts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', jsx: 'jsx', sql: 'sql', toml: 'toml', md: 'md',
  html: 'html', css: 'css', json: 'json', jsonc: 'jsonc', yml: 'yaml', yaml: 'yaml', sh: 'bash',
};

export class CourseSyncError extends Error {
  constructor(problems) {
    super(problems.join('\n'));
    this.name = 'CourseSyncError';
    this.problems = problems;
  }
}

/** Every include/output fence in the lessons, scanned line by line as mdast would split them. */
export function collectRefs(lessons) {
  const refs = [];
  const problems = [];
  for (const { slug, path: file, text } of lessons) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const open = FENCE_OPEN.exec(lines[i]);
      if (!open) continue;
      const [, marker, rest] = open;
      const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      const where = `${file}:${i + 1}`;
      const info = rest.trim();
      const lang = info.split(/\s/, 1)[0];
      const meta = parseFenceMeta(info.slice(lang.length).trim());
      if (/^(include|output|step)=/.test(lang)) {
        problems.push(`${where} a course fence needs a language before include= or output=`);
      } else if (meta) {
        if (lines.slice(i + 1, j).some((l) => l.trim())) problems.push(`${where} include fence must be empty`);
        else if (meta.include) refs.push({ kind: 'include', slug, step: meta.step ?? null, path: meta.include.path, anchor: meta.include.anchor, where });
        else refs.push({ kind: 'output', slug, step: meta.step ?? null, name: meta.output, where });
      }
      i = j;
    }
  }
  if (problems.length) throw new CourseSyncError(problems);
  return refs;
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const langFor = (p) => LANGS[p.split('.').pop()] ?? 'text';

/** The snippet file for these refs at these locked steps. Pure: every file comes through read(sha, path). */
export function buildSnippets({ refs, steps, read, strictLessons = [] }) {
  const problems = [];
  const stepFor = new Map(Object.entries(steps).map(([nn, s]) => [s.lesson, nn]));
  const snippets = {};
  const outputs = {};
  const seen = new Set();
  const noStep = new Set();
  for (const ref of refs) {
    const nn = ref.step ?? stepFor.get(ref.slug);
    if (!nn) {
      if (!noStep.has(ref.slug)) problems.push(`${ref.slug} uses course includes but has no step in the lock (${ref.where})`);
      noStep.add(ref.slug);
      continue;
    }
    const step = steps[nn];
    if (!step) {
      problems.push(`${ref.where} step ${nn} is not in the lock`);
      continue;
    }
    if (ref.kind === 'include') {
      const target = ref.anchor ? `${ref.path}#${ref.anchor}` : ref.path;
      const key = `${nn}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = read(step.sha, ref.path);
      if (text === null) {
        problems.push(`step ${nn} has no file ${ref.path} (${ref.where})`);
        continue;
      }
      try {
        snippets[key] = { lang: langFor(ref.path), text: extractAnchor(text, ref.anchor, `step ${nn} ${ref.path}`) };
      } catch (e) {
        if (!(e instanceof CourseAnchorError)) throw e;
        problems.push(`${e.message} (${ref.where})`);
      }
    } else {
      const key = `${nn}:${ref.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const file = `course/outputs/${nn}/${ref.name}.txt`;
      const raw = read(step.sha, file);
      if (raw === null) {
        problems.push(`step ${nn} has no output ${ref.name} (${file}) (${ref.where})`);
        continue;
      }
      const lines = raw.split('\n');
      const header = MANUAL.exec(lines[0]);
      const text = (header ? lines.slice(1) : lines).join('\n').replace(/\n+$/, '');
      outputs[key] = { text, manual: header ? { reason: header[1], captured: header[2] } : null };
    }
  }
  for (const slug of strictLessons) if (!stepFor.has(slug)) problems.push(`${slug} has no step`);
  if (problems.length) throw new CourseSyncError(problems);
  return { version: 1, repo: REPO, branch: 'course', steps: sorted(steps), snippets: sorted(snippets), outputs: sorted(outputs) };
}

export const serialize = (file) => `${JSON.stringify(file, null, 2)}\n`;

/** "<section> <key>: added|removed|changed" for every entry that differs between two snippet files. */
export function diffSnippets(a, b) {
  const out = [];
  for (const k of ['version', 'repo', 'branch']) if (a[k] !== b[k]) out.push(`${k}: changed`);
  for (const section of ['steps', 'snippets', 'outputs']) {
    const x = a[section] ?? {};
    const y = b[section] ?? {};
    for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (!(key in y)) out.push(`${section} ${key}: removed`);
      else if (!(key in x)) out.push(`${section} ${key}: added`);
      else if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) out.push(`${section} ${key}: changed`);
    }
  }
  return out;
}

// ── CLI ────────────────────────────────────────────────────────────────────
function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function mustGit(repo, args) {
  const out = git(repo, args);
  if (out === null) throw new CourseSyncError([`git -C ${repo} ${args.join(' ')} failed`]);
  return out;
}

function companion(explicit) {
  if (explicit) return path.resolve(explicit);
  const local = path.join(ROOT, 'companions/dealfinder');
  if (existsSync(local)) return local;
  const dir = path.join(ROOT, '.cache/course-companion');
  if (!existsSync(dir)) {
    mkdirSync(path.dirname(dir), { recursive: true });
    mustGit(ROOT, ['clone', '--quiet', '--filter=blob:none', '--no-checkout', REPO, dir]);
  }
  mustGit(dir, ['fetch', '--quiet', '--filter=blob:none', 'origin', '+refs/heads/course:refs/remotes/origin/course']);
  return dir;
}

function courseRef(repo) {
  return git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/course']) !== null ? 'course' : 'origin/course';
}

/** The lock at the course tip, from the tip's own steps.py. */
function readLock(repo) {
  const ref = courseRef(repo);
  const tool = path.join(ROOT, '.cache/course-steps.py');
  mkdirSync(path.dirname(tool), { recursive: true });
  writeFileSync(tool, mustGit(repo, ['show', `${ref}:course/tools/steps.py`]));
  const r = spawnSync(process.env.PYTHON ?? 'python3', [tool, 'matrix', '--json', '--repo', repo, '--branch', ref], { encoding: 'utf8' });
  if (r.status !== 0) throw new CourseSyncError([`steps.py matrix failed:\n${r.stdout}${r.stderr}`]);
  return Object.fromEntries(JSON.parse(r.stdout).map((s) => [s.id, { sha: s.sha, lesson: s.lesson, subject: s.subject }]));
}

function ensureCommits(repo, steps) {
  const missing = [];
  for (const [nn, { sha }] of Object.entries(steps)) {
    if (git(repo, ['cat-file', '-e', `${sha}^{commit}`]) !== null) continue;
    git(repo, ['fetch', '--quiet', '--filter=blob:none', 'origin', sha]);
    if (git(repo, ['cat-file', '-e', `${sha}^{commit}`]) === null) missing.push(`step ${nn} commit ${sha.slice(0, 7)} is not in ${repo}`);
  }
  if (missing.length) throw new CourseSyncError(missing);
}

function readLessons() {
  const dir = path.join(ROOT, LESSONS);
  return readdirSync(dir).flatMap((slug) => ['page.mdx', 'page.draft.mdx']
    .map((name) => path.join(LESSONS, slug, name))
    .filter((rel) => existsSync(path.join(ROOT, rel)))
    .map((rel) => ({ slug, path: rel, text: readFileSync(path.join(ROOT, rel), 'utf8') })));
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const at = argv.indexOf('--companion');
  const explicit = at === -1 ? null : argv[at + 1];
  for (const f of flags) if (!['--companion', '--update-lock', '--check', '--strict'].includes(f)) throw new CourseSyncError([`unknown flag ${f}`]);

  const committedText = readFileSync(path.join(ROOT, OUT), 'utf8');
  const committed = JSON.parse(committedText);
  const refs = collectRefs(readLessons());
  let steps = committed.steps;
  let read = () => null;
  if (refs.length || flags.has('--update-lock')) {
    const repo = companion(explicit);
    if (flags.has('--update-lock')) steps = readLock(repo);
    ensureCommits(repo, steps);
    read = (sha, file) => git(repo, ['show', `${sha}:${file}`]);
  }
  const strictLessons = flags.has('--strict') ? readTutorials().filter((t) => t.series === SERIES).map((t) => t.slug) : [];
  const result = buildSnippets({ refs, steps, read, strictLessons });
  const summary = `${Object.keys(result.steps).length} steps, ${Object.keys(result.snippets).length} snippets, ${Object.keys(result.outputs).length} outputs`;

  if (flags.has('--check')) {
    const diff = diffSnippets(committed, result);
    if (diff.length || committedText !== serialize(result)) {
      console.log(`✗ ${OUT} is out of date:`);
      for (const line of diff.length ? diff : ['not in canonical form']) console.log(`  ${line}`);
      console.log('  run node scripts/sync-course-snippets.mjs and commit the result');
      return 1;
    }
    console.log(`✓ course snippets in sync (${summary})`);
    return 0;
  }
  writeFileSync(path.join(ROOT, OUT), serialize(result));
  console.log(`✓ wrote ${OUT} (${summary})`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof CourseSyncError)) throw e;
    for (const p of e.problems) console.log(`✗ ${p}`);
    process.exitCode = 1;
  }
}
