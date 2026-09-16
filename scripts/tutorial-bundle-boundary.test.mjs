import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every .tsx under app/, plus the MDX component map at the repo root. */
function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (full.endsWith('.tsx')) found.push(full);
  }
  return found;
}

const isClientModule = (src) => /^\s*(['"])use client\1/.test(src);

/** Imports of runtime VALUES from the tutorials manifest. `import type` is erased
 *  by the compiler and never reaches the bundle, so it does not count. */
function manifestValueImports(src) {
  return [...src.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+'[^']*tutorials\/manifest';/gm)]
    .filter(([, typeOnly, clause]) => !typeOnly && !/^\{\s*type\s/.test(clause.trim()))
    .map(([, , clause]) => clause.trim());
}

describe('tutorial bundle boundary', () => {
  it('keeps the tutorial manifest out of client components', () => {
    // The manifest holds every lesson, released or held, as a literal array, and the
    // publish gate is a runtime .filter() over it — so a bundler cannot drop the held
    // entries. Any client module importing a runtime value from it ships the titles and
    // excerpts of unreleased courses to the browser. Server components must read the
    // manifest and pass only gated data down as props.
    const offenders = [...sourceFiles('app'), 'mdx-components.tsx']
      .map((file) => ({ file, src: readFileSync(file, 'utf8') }))
      .filter(({ src }) => isClientModule(src))
      .flatMap(({ file, src }) => manifestValueImports(src).map((clause) => `${file}: ${clause}`));
    expect(offenders).toEqual([]);
  });
});
