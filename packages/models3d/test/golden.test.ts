/**
 * Golden: the models the old generator exported for Off Road (`ssg model apply`, exporter v8, 21 Oct 19:08) and
 * 4D Stunts (exporter v9, 21 Oct 22:40) rebuilt here from the same ssg.models.json fixtures and the same library,
 * and compared with the files in those games' public/models (read-only). Byte-identical GLBs and deep-equal
 * manifests where the exporter has not changed since; a structural comparison (nodes, meshes, materials, accessors,
 * vertex counts) where it has. Skipped with a message when the old data dir or a game checkout is absent.
 *
 * Known differences, all from changes to the old generator that postdate the Off Road export (and that the old
 * server itself would now produce):
 * - truck: CS-FB-009 (21 Oct 19:14) gave steering wheels the role `steering` and gear sticks `lever`; the v8 export
 *   has the steering wheel as a `wheel` part (with a radius and spin axis) and the gear stick `static`.
 * - models with `simplify` (fan_*, crowd_*): exporter v9 simplifies with locked borders and card thinning, so the
 *   triangles kept differ slightly (manifests equal, GLB bytes not).
 * - cactus_tall: exporter v9 keeps LOD0 only of a file that ships its own LOD meshes, so the GLB is smaller and the
 *   bounds a little tighter.
 * 4D Stunts' files were made by v9 and rebuild byte for byte: a vehicle with eight paint variants and a fit, a posed
 * character, a composite, LODs over nature materials, a skydome with its panorama, a terrain.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MeshoptDecoder } from 'meshoptimizer';
import { openLibrary, type Library } from '@slop/library';
import { ssgModel } from '@slop/formats';
import { MODEL_EXPORTER_VERSION, exportModel, modelIO, parseModelsFile, type ModelDecl, type ModelManifest } from '../src/index.js';

const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const GAMES = { offroad: '/home/andrew/projects/offroad', '4dstunts': '/home/andrew/projects/4dstunts' } as const;
const fixture = (game: keyof typeof GAMES) => fileURLToPath(new URL(`../../schema/test/fixtures/${game}.models.json`, import.meta.url));
const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));
const haveGame = (game: keyof typeof GAMES) => fs.existsSync(path.join(GAMES[game], 'public/models/models.json'));
if (!haveData) console.warn(`golden.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);
for (const g of Object.keys(GAMES) as (keyof typeof GAMES)[]) if (!haveGame(g)) console.warn(`golden.test.ts: ${g} skipped, no ${GAMES[g]}/public/models`);

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-golden-cache-'));
afterAll(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

/** Structure of a GLB: what a loader sees, without the bytes. */
async function structure(file: string) {
  await MeshoptDecoder.ready;
  const doc = await modelIO().readBinary(new Uint8Array(fs.readFileSync(file)));
  const root = doc.getRoot();
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
  return {
    nodes: root.listNodes().map((n) => n.getName()).sort(),
    meshes: root.listMeshes().length,
    primitives: prims.length,
    materials: root.listMaterials().map((m) => m.getName()).sort(),
    textures: root.listTextures().length,
    accessors: root.listAccessors().length,
    animations: root.listAnimations().map((a) => a.getName()).sort(),
    skins: root.listSkins().length,
    vertices: prims.reduce((n, p) => n + (p.getAttribute('POSITION')?.getCount() ?? 0), 0),
    triangles: prims.reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName).sort(),
  };
}

const old = (game: keyof typeof GAMES, name: string) => ({
  glb: path.join(GAMES[game], 'public/models', `${name}.glb`),
  manifest: JSON.parse(fs.readFileSync(path.join(GAMES[game], 'public/models', `${name}.model.json`), 'utf8')) as ModelManifest,
  index: (JSON.parse(fs.readFileSync(path.join(GAMES[game], 'public/models/models.json'), 'utf8')) as { models: Record<string, { id: string; rev: string }> }).models[name],
});

describe.skipIf(!haveData)('golden against the old generator\'s exports', () => {
  let lib: Library;
  let decls: Record<keyof typeof GAMES, ModelDecl[]>;
  beforeAll(() => {
    lib = openLibrary({ dataDir: DATA_DIR });
    decls = {
      offroad: haveGame('offroad') ? parseModelsFile(JSON.parse(fs.readFileSync(fixture('offroad'), 'utf8'))) : [],
      '4dstunts': haveGame('4dstunts') ? parseModelsFile(JSON.parse(fs.readFileSync(fixture('4dstunts'), 'utf8'))) : [],
    };
  });
  afterAll(() => lib?.close());
  const decl = (game: keyof typeof GAMES, name: string) => decls[game].find((d) => d.name === name)!;

  it('the exporter version is the one 4D Stunts was built with', () => {
    expect(MODEL_EXPORTER_VERSION).toBe(9);
  });

  describe.skipIf(!haveGame('offroad'))('Off Road (exporter v8 files)', () => {
    it.each(['barrel', 'cone', 'hay_bale'])('%s: the same id, byte-identical GLB, deep-equal manifest', async (name) => {
      const r = await exportModel(decl('offroad', name).spec, { lib, cacheDir });
      const o = old('offroad', name);
      expect(r.id).toBe(o.index.id);
      expect(r.manifest).toEqual(o.manifest);
      expect(fs.readFileSync(r.glb).equals(fs.readFileSync(o.glb))).toBe(true);
      expect(ssgModel.safeParse(r.manifest).success).toBe(true);
    }, 60000);

    it('driver_grey: a character with six clips merged from the existing bakes, byte-identical', async () => {
      const r = await exportModel(decl('offroad', 'driver_grey').spec, { lib, cacheDir });
      const o = old('offroad', 'driver_grey');
      expect(r.id).toBe(o.index.id);
      expect(r.manifest).toEqual(o.manifest);
      expect(r.manifest.clips.map((c) => c.name)).toEqual(['POLY_IDL_Base@Masculine', 'POLY_EMOT_Celebrate_BeatChest@Masculine', 'Driver_Trophy', 'POLY_EMOT_Celebrate_Clapping_Polite@Masculine', 'POLY_EMOT_Happy_FistPump@Masculine', 'Driver_Defeated']);
      expect(fs.readFileSync(r.glb).equals(fs.readFileSync(o.glb))).toBe(true);
    }, 120000);

    it('truck: the lifted pickup (attachment, fit, four variants, meshopt) matches structurally; only the two re-ruled parts differ (CS-FB-009)', async () => {
      const r = await exportModel(decl('offroad', 'truck').spec, { lib, cacheDir });
      const o = old('offroad', 'truck');
      expect(r.id).toBe(o.index.id);
      const reRuled = (p: { node: string }) => /Steering_Wheel|Gearstick/i.test(p.node);
      const without = (m: ModelManifest) => ({ ...m, parts: m.parts.filter((p) => !reRuled(p)) });
      expect(without(r.manifest)).toEqual(without(o.manifest));
      expect(r.manifest.parts.filter(reRuled).map((p) => [p.node, p.role])).toEqual([['SM_Veh_Pickup_01_Gearstick', 'lever'], ['SM_Veh_Pickup_01_Steering_Wheel', 'steering']]);
      expect(o.manifest.parts.filter(reRuled).map((p) => [p.node, p.role])).toEqual([['SM_Veh_Pickup_01_Gearstick', 'static'], ['SM_Veh_Pickup_01_Steering_Wheel', 'wheel']]);
      const [a, b] = await Promise.all([structure(r.glb), structure(o.glb)]);
      expect(a).toEqual(b);
      expect(a.vertices).toBe(32347);
      expect(a.extensions).toContain('KHR_materials_variants');
      // The bytes differ only by the steering wheel's pivot (re-ruled, no longer pivoted as a wheel): the files are within 0.1 % in size.
      expect(Math.abs(fs.statSync(r.glb).size - fs.statSync(o.glb).size)).toBeLessThan(fs.statSync(o.glb).size / 1000);
    }, 120000);

    it('determinism: building barrel again (forced) gives the same bytes and revision', async () => {
      const a = await exportModel(decl('offroad', 'barrel').spec, { lib, cacheDir });
      const bytes = fs.readFileSync(a.glb);
      const b = await exportModel(decl('offroad', 'barrel').spec, { lib, cacheDir, force: true });
      expect(b.cached).toBe(false);
      expect(b.rev).toBe(a.rev);
      expect(fs.readFileSync(b.glb).equals(bytes)).toBe(true);
    }, 60000);
  });

  describe.skipIf(!haveGame('4dstunts'))('4D Stunts (exporter v9 files)', () => {
    it.each(['driver-a', 'sc-gas-station', 'ramp', 'car-rally'])('%s: the same id, byte-identical GLB, deep-equal manifest', async (name) => {
      const r = await exportModel(decl('4dstunts', name).spec, { lib, cacheDir });
      const o = old('4dstunts', name);
      expect(r.id).toBe(o.index.id);
      expect(r.manifest).toEqual(o.manifest);
      expect(fs.readFileSync(r.glb).equals(fs.readFileSync(o.glb))).toBe(true);
      expect(ssgModel.safeParse(r.manifest).success).toBe(true);
    }, 120000);
  });
});
