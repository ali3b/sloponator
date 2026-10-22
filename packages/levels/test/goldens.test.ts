/**
 * Level goldens (ali3b/sloponator#17, #18): buildLevels on a game's real ssg.assets.json must write what the old
 * generator wrote for it.
 *
 * - Monty's `tomb` tileset (colour/noise terrains; packages/schema/test/fixtures/monty.assets.json) against Monty's
 *   own output, ~/projects/monty/public/assets/tilesets/tomb: the atlas pixel for pixel (and byte for byte) and the
 *   .tsj deep-equal.
 * - Solitary Strike (~/projects/airborne-ranger): its four tilesets (texture terrains: grass, sand, rock, snow…
 *   read from the old generator's packs) and its 14 maps replayed from maps/*.ops.json, stamps included; every
 *   tileset atlas and .tsj and every exported mission .tmj (with the atlas next to it) against the game's
 *   public/assets, byte for byte. The game's files are only read: the declaration and its ops are copied into
 *   test-results, the previous build's .tsj files (the tile ids its maps were made with) seed the output folder, and
 *   the sprites are read from the game's built folders. Sprite ids are the old project's (read from its database,
 *   read-only), the only number a file-based build cannot know; every other byte is the replay's.
 *
 * Each skips with a message when its game, its old output or the old generator's data dir is not on this machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ssgMap } from '@slop/formats';
import { buildLevels, decodePng, readMapFile } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const MONTY = process.env.SLOP_MONTY_DIR ?? '/home/andrew/projects/monty';
const SS = process.env.SLOP_SOLITARY_STRIKE_DIR ?? '/home/andrew/projects/airborne-ranger';
const OUT = path.join(ROOT, 'test-results/levels-goldens');

const skip = (what: string, why: string) => {
  console.warn(`goldens.test.ts: ${what} skipped, ${why}`);
  return true;
};

const tomb = path.join(MONTY, 'public/assets/tilesets/tomb');
const noMonty = !fs.existsSync(path.join(tomb, 'tomb.tsj')) && skip("Monty's tomb", `no old output at ${tomb} (set SLOP_MONTY_DIR)`);

describe.skipIf(noMonty)("Monty's tomb tileset", () => {
  it('the atlas pixel for pixel and the .tsj deep-equal to the old generator\'s', async () => {
    const out = path.join(OUT, 'monty');
    fs.rmSync(out, { recursive: true, force: true });
    const r = await buildLevels(path.join(ROOT, 'packages/schema/test/fixtures/monty.assets.json'), { out });
    expect(r.tilesets.map((t) => t.name)).toEqual(['tomb']);
    const mine = decodePng(fs.readFileSync(path.join(out, 'tilesets/tomb/tomb.png')));
    const old = decodePng(fs.readFileSync(path.join(tomb, 'tomb.png')));
    expect([mine.width, mine.height]).toEqual([old.width, old.height]);
    let differ = 0;
    for (let i = 0; i < old.data.length; i += 4) if (mine.data.subarray(i, i + 4).some((v, k) => v !== old.data[i + k])) differ++;
    expect(differ).toBe(0);
    expect(fs.readFileSync(path.join(out, 'tilesets/tomb/tomb.png')).equals(fs.readFileSync(path.join(tomb, 'tomb.png')))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'tilesets/tomb/tomb.tsj'), 'utf8'))).toEqual(JSON.parse(fs.readFileSync(path.join(tomb, 'tomb.tsj'), 'utf8')));
  });
});

const ssAssets = path.join(SS, 'public/assets');
const noSS =
  (!fs.existsSync(path.join(SS, 'ssg.assets.json')) && skip('Solitary Strike', `no game at ${SS} (set SLOP_SOLITARY_STRIKE_DIR)`)) ||
  (!fs.existsSync(path.join(ssAssets, 'maps/mission1/mission1.tmj')) && skip('Solitary Strike', `no old output in ${ssAssets}`)) ||
  (!fs.existsSync(path.join(DATA_DIR, 'library.db')) && skip('Solitary Strike', `no old generator data dir at ${DATA_DIR} (its packs hold the textures; set SLOP_OLD_DATA_DIR)`));

/** The old project's sprite ids by name (its database, read-only). */
function oldSpriteIds(project: string): Record<string, number> {
  const db = new Database(path.join(DATA_DIR, 'library.db'), { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare('SELECT s.name AS name, s.id AS id FROM sprites s JOIN projects p ON p.id = s.project_id WHERE p.name = ?').all(project) as { name: string; id: number }[];
    return Object.fromEntries(rows.map((r) => [r.name, r.id]));
  } finally {
    db.close();
  }
}

describe.skipIf(noSS)('Solitary Strike tilesets and maps', () => {
  it('every tileset and every exported map byte for byte as the old generator wrote them', async () => {
    const game = path.join(OUT, 'solitary-strike');
    fs.rmSync(game, { recursive: true, force: true });
    fs.mkdirSync(game, { recursive: true });
    // The declaration with a `map` document per mission, so the documents get checked against ssg-map/1 too.
    const spec = JSON.parse(fs.readFileSync(path.join(SS, 'ssg.assets.json'), 'utf8'));
    spec.maps = spec.maps.map((m: { name: string; export?: string }) => (m.export ? { ...m, map: `maps/${m.name}.map.json` } : m));
    fs.writeFileSync(path.join(game, 'ssg.assets.json'), JSON.stringify(spec));
    fs.cpSync(path.join(SS, 'maps'), path.join(game, 'maps'), { recursive: true });
    const out = path.join(game, 'public/assets');
    for (const t of spec.tilesets) {
      fs.mkdirSync(path.join(out, 'tilesets', t.name), { recursive: true });
      fs.copyFileSync(path.join(ssAssets, 'tilesets', t.name, `${t.name}.tsj`), path.join(out, 'tilesets', t.name, `${t.name}.tsj`));
    }
    const r = await buildLevels(path.join(game, 'ssg.assets.json'), { out, sprites: ssAssets, spriteIds: oldSpriteIds(spec.project), dataDir: DATA_DIR });
    expect(r.tilesets.map((t) => [t.name, t.changes])).toEqual(spec.tilesets.map((t: { name: string }) => [t.name, []]));
    expect(r.maps.map((m) => m.name)).toEqual(spec.maps.map((m: { name: string }) => m.name));
    const files = [...r.tilesets.flatMap((t) => t.files), ...r.maps.flatMap((m) => m.files)];
    expect(files.filter((f) => f.endsWith('.tmj'))).toHaveLength(12);
    const differ: string[] = [];
    for (const f of files) {
      const old = path.join(ssAssets, path.relative(out, f));
      const a = fs.readFileSync(f), b = fs.readFileSync(old);
      if (a.equals(b)) continue;
      differ.push(f.endsWith('.json') || f.endsWith('.tmj') || f.endsWith('.tsj') ? `${old} (${isDeepStrictEqual(JSON.parse(a.toString()), JSON.parse(b.toString())) ? 'deep-equal' : 'differs'})` : old);
    }
    expect(differ).toEqual([]);
    for (const m of r.maps) if (m.document) expect(ssgMap.safeParse(readMapFile(m.document)).success).toBe(true);
  });
});
