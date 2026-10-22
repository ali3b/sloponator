/**
 * Render goldens (ali3b/sloponator#11): `slop build` on Monty's ssg.assets.json must give, pixel for pixel, what the
 * old generator gave for the same file, and the same bytes when built again.
 *
 * The reference is the old generator's own output (make-reference.mjs: its CLI against a private copy of its
 * database, rendered by its own web app), kept under ~/.cache/slop/goldens/<backend>/monty, never committed (Synty
 * art). What is committed is monty.<backend>.json: the SHA-256 of every reference PNG and of every manifest with its
 * maker's name taken out. One reference per backend: a GPU and SwiftShader rasterise differently (spike 1), so the
 * sheets — and, through the trim boxes, even the atlas layout — differ.
 *
 * Skips, with a message, when the old data dir or the reference files are not on this machine; the GPU golden also
 * skips when the page renders in software (no GPU here). Downloads nothing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { openLibrary, type Library } from '@slop/library';
import { chromiumLaunch } from '@slop/render';
import { build, type BuildResult } from '../../src/index.js';
import { normalizeManifest, sha256 } from './normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../../..');
const FIXTURE = path.join(ROOT, 'packages/schema/test/fixtures/monty.assets.json');
const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const GOLDENS = process.env.SLOP_GOLDENS_DIR ?? path.join(process.env.SLOP_CACHE_DIR ?? path.join(os.homedir(), '.cache/slop'), 'goldens');
/** Bundle and frame cache of the tests: under test-results (git-ignored), so a test never reads frames a build left in ~/.cache. */
const CACHE_DIR = path.join(ROOT, 'test-results/goldens/cache');
const OUT = path.join(ROOT, 'test-results/goldens/out');
const SPRITES = ['joe', 'skull'];

interface Golden {
  backend: 'software' | 'gpu';
  gpu: string;
  sprites: Record<string, { asset: string; files: Record<string, { sha256?: string; normalizedSha256?: string; bytes: number }> }>;
}

const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));
if (!haveData) console.warn(`goldens.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);

function pixels(file: string) {
  const p = PNG.sync.read(fs.readFileSync(file));
  return { width: p.width, height: p.height, data: p.data };
}

/** Pixels that differ between two PNGs (and the largest channel difference), or a size mismatch. */
function comparePng(a: string, b: string): { differ: number; max: number; total: number } | { size: string } {
  const p = pixels(a), q = pixels(b);
  if (p.width !== q.width || p.height !== q.height) return { size: `${p.width}×${p.height} vs ${q.width}×${q.height}` };
  let differ = 0, max = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const d = Math.max(Math.abs(p.data[i]! - q.data[i]!), Math.abs(p.data[i + 1]! - q.data[i + 1]!), Math.abs(p.data[i + 2]! - q.data[i + 2]!), Math.abs(p.data[i + 3]! - q.data[i + 3]!));
    if (d) {
      differ++;
      max = Math.max(max, d);
    }
  }
  return { differ, max, total: p.data.length / 4 };
}

for (const backend of ['software', 'gpu'] as const) {
  const golden = JSON.parse(fs.readFileSync(path.join(here, `monty.${backend}.json`), 'utf8')) as Golden;
  const refDir = path.join(GOLDENS, backend, 'monty');
  const haveRef = SPRITES.every((s) => Object.keys(golden.sprites[s]?.files ?? {}).every((f) => fs.existsSync(path.join(refDir, s, f))));
  if (haveData && !haveRef) console.warn(`goldens.test.ts (${backend}): skipped, no reference under ${refDir}: node packages/cli/test/goldens/make-reference.mjs --gpu ${golden.gpu}`);
  // The GPU golden needs the GPU: on a machine without the NVIDIA EGL driver the runner would render in software.
  const canGpu = backend !== 'gpu' || chromiumLaunch('auto').mode !== 'software';
  if (haveData && haveRef && !canGpu) console.warn('goldens.test.ts (gpu): skipped, no GPU driver on this machine');

  describe.skipIf(!haveData || !haveRef || !canGpu)(`render golden against the old generator (${backend})`, () => {
    let lib: Library;
    let first: BuildResult;
    const out1 = path.join(OUT, backend, '1'), out2 = path.join(OUT, backend, '2');

    it('the reference on disk is the one the golden file describes', () => {
      for (const s of SPRITES) {
        for (const [f, want] of Object.entries(golden.sprites[s]!.files)) {
          const bytes = fs.readFileSync(path.join(refDir, s, f));
          if (want.sha256) expect(sha256(bytes), `${s}/${f}`).toBe(want.sha256);
          else expect(sha256(normalizeManifest(bytes.toString('utf8'))), `${s}/${f}`).toBe(want.normalizedSha256);
        }
      }
    });

    it(`slop build renders ${SPRITES.join(' and ')} on ${backend}`, async () => {
      lib = openLibrary({ dataDir: DATA_DIR });
      fs.rmSync(out1, { recursive: true, force: true });
      first = await build({ file: FIXTURE, out: out1, only: SPRITES, gpu: backend === 'gpu' ? 'auto' : 'software', cacheDir: CACHE_DIR, lib, force: true });
      expect(first.ok, JSON.stringify(first.sprites.map((s) => s.error).filter(Boolean))).toBe(true);
      expect(first.backend).toBe(backend);
      expect(first.sprites.map((s) => s.name).sort()).toEqual([...SPRITES].sort());
      for (const s of first.sprites) expect(s.files.sort()).toEqual(Object.keys(golden.sprites[s.name]!.files).sort());
    });

    it('every sheet matches the old generator pixel for pixel, every manifest apart from its maker', () => {
      for (const s of SPRITES) {
        for (const f of Object.keys(golden.sprites[s]!.files)) {
          const mine = path.join(out1, s, f), ref = path.join(refDir, s, f);
          if (f.endsWith('.png')) {
            const r = comparePng(mine, ref);
            expect(r, `${s}/${f}`).toEqual({ differ: 0, max: 0, total: (r as { total?: number }).total });
          } else {
            expect(normalizeManifest(fs.readFileSync(mine, 'utf8')), `${s}/${f}`).toBe(normalizeManifest(fs.readFileSync(ref, 'utf8')));
          }
        }
      }
    });

    it('built again, every file is byte-identical (frames from the cache this time)', async () => {
      fs.rmSync(out2, { recursive: true, force: true });
      const again = await build({ file: FIXTURE, out: out2, only: SPRITES, gpu: backend === 'gpu' ? 'auto' : 'software', cacheDir: CACHE_DIR, lib });
      expect(again.ok).toBe(true);
      expect(again.bundle).toBe(first.bundle);
      for (const s of again.sprites) expect(s.cached, `${s.name} from the cache`).toBe(s.frames);
      for (const s of SPRITES) {
        for (const f of Object.keys(golden.sprites[s]!.files)) {
          expect(Buffer.compare(fs.readFileSync(path.join(out1, s, f)), fs.readFileSync(path.join(out2, s, f))), `${s}/${f}`).toBe(0);
        }
      }
      lib.close();
    });
  });
}
