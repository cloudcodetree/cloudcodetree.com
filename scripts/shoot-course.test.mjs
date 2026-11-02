import { describe, expect, it } from 'vitest';
import { parseSteps, shotEnv } from './shoot-course.mjs';

const LOCK = { '01': { sha: 'a'.repeat(40), lesson: 'dealfinder-part-01' }, '02': { sha: 'b'.repeat(40), lesson: 'dealfinder-part-02' } };

describe('parseSteps', () => {
  it('reads all and a comma list', () => {
    expect(parseSteps('all', LOCK)).toEqual(['01', '02']);
    expect(parseSteps('02,01', LOCK)).toEqual(['01', '02']);
  });

  it('rejects anything else, and a step that is not locked', () => {
    expect(() => parseSteps('1', LOCK)).toThrow(/--steps is "all" or a list like 01,02/);
    expect(() => parseSteps('01;rm', LOCK)).toThrow(/--steps is "all"/);
    expect(() => parseSteps('03', LOCK)).toThrow(/step 03 is not in content\/course\/snippets\.json/);
  });
});

describe('shotEnv', () => {
  const base = { PATH: '/usr/bin', HOME: '/h', DATABASE_URL: 'postgresql://x', OPENROUTER_API_KEY: 'k', SHELL_ONLY: '1' };

  it('is the capture baseline with the venv first on PATH and no keys', () => {
    expect(shotEnv({ needs_db: false }, base, '/w/.venv')).toEqual({
      PATH: '/w/.venv/bin:/usr/bin', HOME: '/h', VIRTUAL_ENV: '/w/.venv',
      TZ: 'UTC', LC_ALL: 'C.UTF-8', PYTHONHASHSEED: '0', COLUMNS: '100', NO_COLOR: '1', DEALFINDER_ENABLE_PAID_SOURCES: '0',
    });
  });

  it('passes DATABASE_URL only when the step needs a database, and requires it then', () => {
    expect(shotEnv({ needs_db: true }, base, '/w/.venv').DATABASE_URL).toBe('postgresql://x');
    expect(() => shotEnv({ needs_db: true, id: '05' }, { PATH: '/usr/bin' }, '/w/.venv')).toThrow(/step 05 needs a database: set DATABASE_URL/);
  });
});
