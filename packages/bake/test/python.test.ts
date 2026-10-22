/**
 * The worker's own Python tests (worker/tests: rig detection, part roles, texture rules, ingest material resolution
 * with bpy stubbed), run with `python3 -m unittest` exactly as the old generator ran them. Skipped with a message
 * when python3 is not installed.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { WORKER_DIR } from '../src/index.js';

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const havePython = python.status === 0;
if (!havePython) console.warn('python.test.ts: skipped, python3 is not installed (the worker\'s unittest suite needs it)');

describe.skipIf(!havePython)('the worker\'s Python unittest suite', () => {
  it('passes', () => {
    const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], { cwd: WORKER_DIR, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out, out).toMatch(/\nOK\s*$/);
    expect(r.status).toBe(0);
    const ran = Number(out.match(/Ran (\d+) tests?/)?.[1] ?? 0);
    expect(ran).toBeGreaterThanOrEqual(36);
  });
});
