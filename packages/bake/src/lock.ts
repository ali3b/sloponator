/**
 * A lock other processes can see: a directory made with mkdir (atomic on every local file system), holding the
 * owner's pid. Two `slop build`s that both need the same clip: the first bakes it, the second waits and then finds
 * it in the store. A lock whose owner died (no such pid on this host) or that is older than `staleMs` is taken over.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LockOptions {
  /** Poll interval while waiting (ms). */
  pollMs?: number;
  /** A lock older than this is stale whoever holds it (default 30 min: longer than any bake). */
  staleMs?: number;
  /** Called once when the lock is held by someone else and we start waiting. */
  onWait?: (owner: LockOwner | null) => void;
}

export interface LockOwner {
  pid: number;
  host: string;
  at: number;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function owner(dir: string): LockOwner | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')) as LockOwner;
  } catch {
    return null;
  }
}

function stale(dir: string, staleMs: number): boolean {
  const o = owner(dir);
  let at = o?.at;
  if (at === undefined) {
    try {
      at = fs.statSync(dir).mtimeMs;
    } catch {
      return false; // gone already
    }
  }
  if (Date.now() - at > staleMs) return true;
  return !!o && o.host === os.hostname() && !alive(o.pid);
}

/** Try once: true when this process now holds the lock. */
export function tryLock(dir: string): boolean {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now() } satisfies LockOwner));
  return true;
}

export function unlock(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Wait for the lock, run `fn` holding it, release it (also when `fn` throws). */
export async function withLock<T>(dir: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const pollMs = opts.pollMs ?? 250;
  const staleMs = opts.staleMs ?? 30 * 60_000;
  let told = false;
  while (!tryLock(dir)) {
    if (stale(dir, staleMs)) {
      unlock(dir);
      continue;
    }
    if (!told) {
      told = true;
      opts.onWait?.(owner(dir));
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  try {
    return await fn();
  } finally {
    unlock(dir);
  }
}
