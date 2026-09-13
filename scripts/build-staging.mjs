#!/usr/bin/env node
/** Build beta with every tutorial draft visible, then restore the source tree. */
import { execFileSync } from 'node:child_process';

const previewEnv = {
  ...process.env,
  SITE_ORIGIN: '',
  NEXT_PUBLIC_CONTENT_PREVIEW: '1',
};
const releaseEnv = {
  ...process.env,
  NEXT_PUBLIC_CONTENT_PREVIEW: '0',
};

let built = false;
try {
  execFileSync('pnpm', ['run', 'build'], { stdio: 'inherit', env: previewEnv });
  built = true;
} finally {
  // The beta export is complete; return route filenames to their committed,
  // private shape even when Next fails midway through the build.
  execFileSync(process.execPath, ['scripts/apply-drafts.mjs'], { stdio: 'inherit', env: releaseEnv });
}

if (built) {
  execFileSync(process.execPath, ['scripts/fetch-demo-artifacts.mjs'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/mark-staging-build.mjs', 'out'], { stdio: 'inherit' });
}
