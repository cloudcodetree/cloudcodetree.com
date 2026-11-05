import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Split a workflow into its jobs by the two-space job keys under `jobs:`.
function jobs(file) {
  const text = readFileSync(file, 'utf8');
  const body = text.slice(text.indexOf('\njobs:\n') + 7);
  return Object.fromEntries(body.split(/\n(?=  [a-z][\w-]*:\n)/).map((chunk) => [chunk.match(/^\s*([\w-]+):/)[1], chunk]));
}

describe('course-shots.yml', () => {
  const { shoot, pr } = jobs('.github/workflows/course-shots.yml');

  it('runs companion code with a read-only token, no stored credentials and no shared cache', () => {
    expect(shoot).toMatch(/permissions:\n\s+contents: read\n/);
    expect(shoot).toMatch(/persist-credentials: false/);
    // A cache the shoot job saves is restored by deploy.yml, next to the Cloudflare secrets.
    expect(shoot).not.toMatch(/cache:/);
  });

  it('keeps the write token in a job that runs nothing from the companion', () => {
    expect(pr).toMatch(/contents: write/);
    expect(pr).not.toMatch(/pnpm|node |pip |python|shoot-course/);
  });
});
