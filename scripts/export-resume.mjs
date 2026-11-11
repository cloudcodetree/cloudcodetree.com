#!/usr/bin/env node
// Regenerate the resume downloads (PDF, DOCX, ODT, RTF) from the Markdown source,
// so every format says the same thing as public/resume/chris_harper-resume.md.
// macOS only: headless Google Chrome prints the PDF, textutil writes the rest.
//
//   node scripts/export-resume.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const DIR = resolve('public/resume');
const BASE = 'chris_harper-resume';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const md = readFileSync(join(DIR, `${BASE}.md`), 'utf8');
const body = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, md));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Chris Harper Resume</title>
<style>
  @page { size: Letter; margin: 0.5in 0.6in; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.35; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2pt; text-align: center; }
  h1 + p { text-align: center; font-size: 8.5pt; margin: 0 0 4pt; }
  h1 + p + p { text-align: center; font-size: 10.5pt; margin: 0 0 6pt; }
  h2 { font-size: 11.5pt; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #999; margin: 10pt 0 4pt; padding-bottom: 1pt; }
  h3 { font-size: 10.5pt; margin: 7pt 0 0; break-after: avoid; }
  h3 + p { margin: 0 0 2pt; color: #444; }
  p { margin: 0 0 4pt; }
  ul { margin: 0 0 4pt; padding-left: 14pt; }
  li { margin: 0 0 1.5pt; }
  a { color: #111; text-decoration: none; }
</style></head><body>
${body}
</body></html>
`;

const tmp = mkdtempSync(join(tmpdir(), 'resume-'));
try {
  const htmlPath = join(tmp, `${BASE}.html`);
  writeFileSync(htmlPath, html);

  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--user-data-dir=${join(tmp, 'chrome')}`,
    `--print-to-pdf=${join(DIR, `${BASE}.pdf`)}`,
    `file://${htmlPath}`,
  ], { stdio: 'ignore' });

  for (const format of ['docx', 'odt', 'rtf']) {
    execFileSync('textutil', [
      '-convert', format,
      '-output', join(DIR, `${BASE}.${format}`),
      htmlPath,
    ]);
  }
  console.log(`wrote ${BASE}.{pdf,docx,odt,rtf} in public/resume/`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
