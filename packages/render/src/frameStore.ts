/**
 * The frame cache store (FB-121): one directory per clip × direction entry under `<cacheDir>/frames/<kk>/<key>/`,
 * holding `meta.json` (@slop/sprites `FrameUnitMeta`: per-frame opaque boxes, sockets, body boxes) and the PNG
 * strips (`body.png`, `body.<layer>.png`; frames left to right, top to bottom in `cols` columns). The key is
 * @slop/sprites `frameUnitKey`: it names the render backend and the bundle hash, so nothing here ever has to be
 * invalidated by hand. The old generator kept the same entries zipped in its server (apps/server/src/frameCache.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { FRAME_CACHE_VERSION, type FrameUnitMeta } from '@slop/sprites';

export interface FrameEntry {
  meta: FrameUnitMeta;
  /** PNG bytes per strip name. */
  strips: Record<string, Uint8Array>;
}

export class FrameStore {
  constructor(readonly dir: string) {}

  private entryDir(key: string) {
    return path.join(this.dir, key.slice(0, 2), key);
  }

  /** The entry's meta when it is held, is of this version and has every strip it names; else null. */
  get(key: string): FrameEntry | null {
    const d = this.entryDir(key);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8')) as FrameUnitMeta;
      if (meta.v !== FRAME_CACHE_VERSION || meta.key !== key) return null;
      const strips: Record<string, Uint8Array> = {};
      for (const s of meta.strips) strips[s] = new Uint8Array(fs.readFileSync(path.join(d, s)));
      return { meta, strips };
    } catch {
      return null;
    }
  }

  has(key: string): boolean {
    return fs.existsSync(path.join(this.entryDir(key), 'meta.json'));
  }

  /** Writes the entry atomically (a temp dir renamed into place); a concurrent writer of the same key wins or loses whole. */
  put(key: string, entry: FrameEntry): void {
    const d = this.entryDir(key);
    const tmp = `${d}.tmp-${process.pid}-${Date.now()}`;
    fs.mkdirSync(tmp, { recursive: true });
    for (const [name, bytes] of Object.entries(entry.strips)) fs.writeFileSync(path.join(tmp, name), bytes);
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(entry.meta));
    fs.rmSync(d, { recursive: true, force: true });
    try {
      fs.renameSync(tmp, d);
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Number of entries held (a directory listing, for `slop doctor`-style reports). */
  count(): number {
    if (!fs.existsSync(this.dir)) return 0;
    let n = 0;
    for (const a of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, a);
      if (fs.statSync(p).isDirectory()) n += fs.readdirSync(p).filter((k) => fs.existsSync(path.join(p, k, 'meta.json'))).length;
    }
    return n;
  }
}
