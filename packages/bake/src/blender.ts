/**
 * Blender, headless: the binary, its version, and one worker script run at a time. Ported from synty-sprite-generator
 * apps/server/src/blender.ts (P2, ali3b/sloponator#69): the same command line (`blender -b --factory-startup -P
 * <worker>/<script> -- @args.json`, arguments through a temp file because texture lists exceed the command-line
 * limit), the same `SSG_EXTRA_RIGS` for user-confirmed rig profiles, the same tagged result lines (`RETARGET_OK
 * {...}`). Changed here: one lane instead of two (no ingest runs in the Sloponator yet), a timeout, and the queue is
 * a class so tests can stub Blender.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** packages/bake/worker: retarget.py, synty/*.py, rigs/*.json, roles.json. */
export const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../worker');

/** `$SLOP_BLENDER`, else the old generator's `$SSG_BLENDER`, else `blender` on PATH. */
export function defaultBlender(env: NodeJS.ProcessEnv = process.env): string {
  return env.SLOP_BLENDER || env.SSG_BLENDER || 'blender';
}

const versions = new Map<string, string | null>();

/** `Blender 4.0.2` (the first line of `blender --version`), or null when the binary does not run. Asked once per binary. */
export function blenderVersion(bin: string = defaultBlender()): string | null {
  if (versions.has(bin)) return versions.get(bin)!;
  let v: string | null = null;
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 });
    const line = (r.stdout ?? '').split('\n').find((l) => /^Blender \d/.test(l.trim()));
    v = r.status === 0 && line ? line.trim() : null;
  } catch {
    v = null;
  }
  versions.set(bin, v);
  return v;
}

export interface WorkerResult {
  code: number;
  lines: string[];
  stderr: string;
  ms: number;
}

/** Parse worker result lines like `INGEST_OK {...}` / `RETARGET_OK {...}`. */
export function parseTagged(line: string): { tag: string; data: Record<string, unknown> } | null {
  const m = line.match(/^([A-Z_]+_(?:OK|FAIL))\s+(\{.*\})\s*$/);
  if (!m) return null;
  try {
    return { tag: m[1]!, data: JSON.parse(m[2]!) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export interface WorkerRun {
  /** The script in the worker dir (retarget.py). */
  script: string;
  args: unknown;
  /** Extra environment (SSG_EXTRA_RIGS). */
  env?: Record<string, string>;
  onLine?: (line: string) => void;
  /** Kill Blender after this long (default 10 min). */
  timeoutMs?: number;
}

/**
 * One Blender at a time in this process: every run waits for the one before it. The shared machine's CPU (and the
 * render runner, which `slop build` only starts once every bake is done) never sees two.
 */
export class BlenderQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /** Runs started, for tests and progress. */
  started = 0;

  constructor(readonly bin: string = defaultBlender(), readonly workerDir: string = WORKER_DIR) {}

  run(job: WorkerRun): Promise<WorkerResult> {
    const go = () => this.spawnOnce(job);
    const p = this.tail.then(go, go);
    this.tail = p.catch(() => undefined);
    return p;
  }

  private spawnOnce(job: WorkerRun): Promise<WorkerResult> {
    this.started++;
    const t0 = performance.now();
    return new Promise<WorkerResult>((resolve) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-bake-'));
      const argFile = path.join(tmp, 'args.json');
      fs.writeFileSync(argFile, JSON.stringify(job.args));
      const lines: string[] = [];
      let buf = '';
      let stderr = '';
      let done = false;
      const finish = (code: number, extra = '') => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (buf) lines.push(buf);
        fs.rmSync(tmp, { recursive: true, force: true });
        resolve({ code, lines, stderr: (stderr + extra).slice(-4000), ms: Math.round(performance.now() - t0) });
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(this.bin, ['-b', '--factory-startup', '-P', path.join(this.workerDir, job.script), '--', `@${argFile}`], {
          // The worker dir stays clean (and may be read-only): no __pycache__ next to the scripts.
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...job.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        return finish(-1, String(e));
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(-1, `\nBlender killed after ${Math.round((job.timeoutMs ?? 600_000) / 1000)} s`);
      }, job.timeoutMs ?? 600_000);
      child.stdout!.on('data', (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          lines.push(line);
          job.onLine?.(line);
        }
      });
      child.stderr!.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      child.on('error', (e) => finish(-1, String(e)));
      child.on('close', (code) => finish(code ?? -1));
    });
  }
}
