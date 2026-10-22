// Moved from synty-sprite-generator apps/server/test/modelMaterials.test.ts (P3, ali3b/sloponator#14); the preview page tests stayed (previews are deferred).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO, type Material, type Node } from '@gltf-transform/core';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { normaliseSpec } from '../src/index.js';
import { analysePaint, buildModel, fallbackPaintMaterials, lodLevelOf, modelIO, paintLocalName, paintTint, pickLodSource } from '../src/build/modelBuild.js';
import { natureMaterialsFor, parseMaterialSlots } from '../src/build/natureMaterials.js';
import { applyNatureMaterials, leafTriangles, triplanarFace, triplanarUv } from '../src/build/modelNature.js';
import { looseComponents, simplifyMeshList } from '../src/build/modelSimplify.js';
import { dashboardOf, eigen3, principalAxes } from '../src/build/modelDashboard.js';
import { TextureOptionError, textureExportOptions } from '../src/textures.js';

/**
 * Wave 3 materials, textures, roles and LODs (CS-FB-021/022/023/025/026/028 and the nature-pack follow-up), on small
 * documents built here.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssg-materials-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const pngOf = async (w: number, h: number, px: (x: number, y: number) => number[]) => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return new Uint8Array(await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
};

/** A primitive from triangles: positions and UVs per corner (non-indexed). */
function triPrim(doc: Document, tris: { p: number[][]; uv: number[][] }[], material?: Material) {
  const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos = tris.flatMap((t) => t.p.flat()), uv = tris.flatMap((t) => t.uv.flat());
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf));
  if (material) prim.setMaterial(material);
  return prim;
}

/** A quad card (two triangles) at x, spanning the whole UV square. */
const card = (x: number, y = 0, z = 0, s = 1) => [
  { p: [[x, y, z], [x + s, y, z], [x + s, y + s, z]], uv: [[0, 1], [1, 1], [1, 0]] },
  { p: [[x, y, z], [x + s, y + s, z], [x, y + s, z]], uv: [[0, 1], [1, 0], [0, 0]] },
];
/** A palette triangle (UVs inside one small swatch). */
const swatchTri = (x: number) => ({ p: [[x, 0, 0], [x + 1, 0, 0], [x, 1, 0]], uv: [[0.1, 0.1], [0.11, 0.1], [0.1, 0.11]] });

describe('nature materials (MaterialList foliage and triplanar)', () => {
  it('parses MaterialList slots with their texture properties; first listing of a mesh wins', () => {
    const slots = parseMaterialSlots(
      [
        'Prefab Name: SM_Env_Tree_01',
        '    Mesh Name: SM_Env_Tree_01_LOD0',
        '        Slot: Tree_Mat_03',
        '            _Leaf_Texture: leafPatch_04.tga (_Leaf_Texture)',
        '            _Trunk_Texture: Meadow_Texture_01.png (_Trunk_Texture)',
        'Prefab Name: SM_Env_Cliff_01',
        '    Mesh Name: SM_Env_Cliff_01',
        '        Slot: Rock_Grass_Triplanar (Uses custom shader)',
        '            _Triplanar_Texture_Top: Grass_Texture_01.png (_Triplanar_Texture_Top)',
        '            _Triplanar_Texture_Side: RockWall_01.png (_Triplanar_Texture_Side)',
        'Prefab Name: Again',
        '    Mesh Name: SM_Env_Tree_01_LOD0',
        '        Slot: Other',
      ].join('\n'),
    );
    expect(slots.get('SM_Env_Tree_01_LOD0')).toEqual([{ slot: 'Tree_Mat_03', props: { _Leaf_Texture: 'leafPatch_04.tga', _Trunk_Texture: 'Meadow_Texture_01.png' } }]);
    expect(slots.get('SM_Env_Cliff_01')![0].slot).toBe('Rock_Grass_Triplanar');
  });

  it('resolves a pack\'s foliage and triplanar textures (list in a subfolder), and a placeholder leaf for unlisted meshes', () => {
    const pack = path.join(tmp, 'POLYGON_Nature_v1');
    fs.mkdirSync(path.join(pack, 'SourceFiles', 'Textures', 'Plants'), { recursive: true });
    for (const f of ['Textures/Plants/leafPatch_04.tga', 'Textures/Meadow_Texture_01.png', 'Textures/Grass_Texture_01.png', 'Textures/RockWall_01.png'])
      fs.writeFileSync(path.join(pack, 'SourceFiles', f), 'x');
    fs.writeFileSync(
      path.join(pack, 'SourceFiles', 'MaterialList_Nature.txt'),
      [
        'Prefab Name: SM_Env_Tree_01',
        '    Mesh Name: SM_Env_Tree_01_LOD0',
        '        Slot: Tree_Mat_03',
        '            _Leaf_Texture: leafPatch_04.tga (_Leaf_Texture)',
        '            _Trunk_Texture: Meadow_Texture_01.png (_Trunk_Texture)',
        '    Mesh Name: SM_Env_Cliff_01',
        '        Slot: Cliff',
        '            _Triplanar_Texture_Top: Grass_Texture_01.png (_Triplanar_Texture_Top)',
        '            _Triplanar_Texture_Side: RockWall_01.png (_Triplanar_Texture_Side)',
        '    Mesh Name: SM_Prop_Crate_01',
        '        Slot: Crate',
        '            _Albedo_Map: Crate.png (_Albedo_Map)',
      ].join('\n'),
    );
    const m = natureMaterialsFor(pack, ['SM_Env_Tree_01_LOD0', 'SM_Env_Cliff_01', 'SM_Prop_Crate_01', 'Swamp_Tree_04'], ['Swamp_Tree_04']);
    expect(m.SM_Env_Tree_01_LOD0.leaf).toMatch(/leafPatch_04\.tga$/);
    expect(m.SM_Env_Tree_01_LOD0.trunk).toMatch(/Meadow_Texture_01\.png$/);
    expect(m.SM_Env_Cliff_01).toMatchObject({ slot: 'Cliff' });
    expect(m.SM_Env_Cliff_01.top).toMatch(/Grass_Texture_01/);
    expect(m.SM_Prop_Crate_01).toBeUndefined();
    // Not in the list, on the FX circle placeholder: the pack's usual leaf texture, on those triangles only.
    expect(m.Swamp_Tree_04).toMatchObject({ slot: 'Foliage', only: 'FX_Circle_Tex' });
    expect(m.Swamp_Tree_04.leaf).toMatch(/leafPatch_04/);
    expect(natureMaterialsFor(path.join(tmp, 'nope'), ['SM_Env_Tree_01_LOD0'])).toEqual({});
  });

  it('foliage: leaf cards go to the leaf texture (cut out, both sides), palette triangles to the trunk atlas', async () => {
    const doc = new Document();
    doc.createBuffer();
    const fx = doc.createMaterial('FX_Circle_Tex.png').setBaseColorTexture(doc.createTexture('FX_Circle_Tex').setImage(await pngOf(2, 2, () => [255, 255, 255, 255])).setMimeType('image/png'));
    const prim = triPrim(doc, [...card(0), ...card(2), swatchTri(5), swatchTri(7)], fx);
    const node = doc.createNode('Tree_LOD0').setMesh(doc.createMesh('t').addPrimitive(prim));
    expect(leafTriangles(prim)).toEqual([true, true, true, true, false, false]);
    const leaf = await pngOf(4, 4, () => [40, 120, 30, 255]), trunk = await pngOf(4, 4, () => [90, 60, 30, 255]);
    const files: Record<string, Uint8Array> = { '/p/leaf.tga': leaf, '/p/trunk.png': trunk };
    const changed = applyNatureMaterials(doc, [node], { Tree_LOD0: { slot: 'Tree_Mat', leaf: '/p/leaf.tga', trunk: '/p/trunk.png' } }, { scale: 1, read: (f) => files[f] });
    expect(changed).toEqual(['Tree_LOD0']);
    const prims = node.getMesh()!.listPrimitives();
    const byMat = Object.fromEntries(prims.map((p) => [p.getMaterial()!.getName(), p]));
    expect(Object.keys(byMat).sort()).toEqual(['Tree_Mat_Leaf', 'Tree_Mat_Trunk']);
    expect(byMat.Tree_Mat_Leaf.getIndices()!.getCount()).toBe(12);
    expect(byMat.Tree_Mat_Trunk.getIndices()!.getCount()).toBe(6);
    expect(byMat.Tree_Mat_Leaf.getMaterial()!.getAlphaMode()).toBe('MASK');
    expect(byMat.Tree_Mat_Leaf.getMaterial()!.getDoubleSided()).toBe(true);
    expect(byMat.Tree_Mat_Trunk.getMaterial()!.getBaseColorTexture()!.getName()).toBe('trunk');
    // A one-texture entry whose texture the ingest already used is left alone.
    const grass = doc.createMaterial('Grass_01.tga').setBaseColorTexture(doc.createTexture('Grass_01').setImage(leaf).setMimeType('image/png'));
    const g = doc.createNode('Grass').setMesh(doc.createMesh('g').addPrimitive(triPrim(doc, card(0), grass)));
    expect(applyNatureMaterials(doc, [g], { Grass: { slot: 'Grass', leaf: '/p/Grass_01.tga' } }, { scale: 1, read: (f) => files[f] })).toEqual([]);
    // A placeholder-only entry leaves the mesh's other materials alone.
    const other = doc.createMaterial('Bark.png');
    const mixed = doc.createNode('Swamp').setMesh(doc.createMesh('s').addPrimitive(triPrim(doc, card(0), fx)).addPrimitive(triPrim(doc, [swatchTri(0)], other)));
    applyNatureMaterials(doc, [mixed], { Swamp: { slot: 'Foliage', leaf: '/p/leaf.tga', only: 'FX_Circle_Tex' } }, { scale: 1, read: (f) => files[f] });
    expect(mixed.getMesh()!.listPrimitives().map((p) => p.getMaterial()!.getName())).toEqual(['Foliage_Leaf', 'Bark.png']);
  });

  it('triplanar: faces projected along the world axes, tops on the top texture and sides on the side texture', async () => {
    expect(triplanarFace([0, 1, 0])).toBe(0);
    expect(triplanarFace([1, 0.2, 0])).toBe(1);
    expect(triplanarFace([0, -1, 0])).toBe(2);
    expect(triplanarUv([3, 0, 6], [0, 1, 0], 6)).toEqual([0.5, 1]);
    expect(triplanarUv([0, 3, 6], [1, 0, 0], 6)).toEqual([1, -0.5]);
    const doc = new Document();
    doc.createBuffer();
    const top = { p: [[0, 1, 0], [0, 1, 1], [1, 1, 0]], uv: [[0, 0], [0, 0], [0, 0]] };
    const side = { p: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], uv: [[0, 0], [0, 0], [0, 0]] };
    // Centimetres under a node scaled 0.01: the scale fix gives metres.
    const node = doc.createNode('Cliff').setMesh(doc.createMesh('c').addPrimitive(triPrim(doc, [top, side], doc.createMaterial('Palette'))));
    const files: Record<string, Uint8Array> = { '/g.png': await pngOf(2, 2, () => [60, 140, 40, 255]), '/r.png': await pngOf(2, 2, () => [110, 100, 90, 255]) };
    applyNatureMaterials(doc, [node], { Cliff: { slot: 'Cliff', top: '/g.png', side: '/r.png' } }, { scale: 6, read: (f) => files[f] });
    const prims = node.getMesh()!.listPrimitives();
    expect(prims.map((p) => p.getMaterial()!.getName())).toEqual(['Cliff_g', 'Cliff_r']);
    const uv = prims[0].getAttribute('TEXCOORD_0')!;
    // The top face's second corner (0, 1, 1) × 6 m: z 6 m = one repeat.
    expect(Array.from(uv.getElement(1, []))).toEqual([0, 1]);
    expect(prims[1].getMaterial()!.getBaseColorTextureInfo()!.getWrapS()).toBe(10497);
  });
});

describe('levels of detail and simplification (CS-FB-025)', () => {
  it('names and picks Synty LOD levels', () => {
    expect(lodLevelOf('SM_Env_Tree_Meadow_02_LOD2')).toEqual({ key: 'SM_Env_Tree_Meadow_02', level: 2 });
    expect(lodLevelOf('SM_Env_Tree_Meadow_02')).toBeNull();
    const levels = [{ level: 1, triangles: 6083 }, { level: 2, triangles: 3283 }, { level: 3, triangles: 12 }];
    // Half: LOD1 is near (within 25 %): used as it is.
    expect(pickLodSource(levels, 5470)).toEqual({ level: 1 });
    // A fifth: LOD2 then simplified on to the share.
    expect(pickLodSource(levels, 2188)).toEqual({ level: 2, simplify: 0.666 });
    // A far level: the billboard card beats simplifying LOD2 a long way.
    expect(pickLodSource(levels, 218)).toEqual({ level: 3 });
    expect(pickLodSource([], 100)).toBeNull();
  });

  it('cards: loose leaf cards are thinned evenly to the share and grown; a solid piece is simplified with its borders kept', async () => {
    const doc = new Document();
    doc.createBuffer();
    const cards = Array.from({ length: 100 }, (_, i) => card((i % 10) * 2, Math.floor(i / 10) * 2)).flat();
    const prim = triPrim(doc, cards);
    const mesh = doc.createMesh('leaves').addPrimitive(prim);
    expect(looseComponents(prim).sizes).toHaveLength(100);
    const r = await simplifyMeshList(doc, [mesh], 0.3);
    expect(r.before).toBe(200);
    expect(r.after).toBeGreaterThanOrEqual(56);
    expect(r.after).toBeLessThanOrEqual(64);
    const p = mesh.listPrimitives()[0];
    expect(p.getAttribute('NORMAL')).toBeTruthy();
    // Cards kept are grown about their centres: a card is now larger than 1 m.
    const a = p.getAttribute('POSITION')!;
    const xs = [0, 1, 2].map((i) => a.getElement(i, [])[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.2);
    // The kept cards spread over the grid (not all from one corner).
    const ys = Array.from({ length: a.getCount() }, (_, i) => a.getElement(i, [])[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(14);
  });

  it('a stacked trunk (two tube segments with a UV seam between them) stays closed: both sides keep the same seam ring', async () => {
    const doc = new Document();
    doc.createBuffer();
    const ring = (y: number, k: number, n = 12, r = 0.3) => [Math.cos((2 * Math.PI * k) / n) * r, y, Math.sin((2 * Math.PI * k) / n) * r];
    const tris: { p: number[][]; uv: number[][] }[] = [];
    const tube = (y0: number, y1: number, u: number, rows = 8) => {
      for (let j = 0; j < rows; j++)
        for (let k = 0; k < 12; k++) {
          const a = y0 + ((y1 - y0) * j) / rows, b = y0 + ((y1 - y0) * (j + 1)) / rows;
          const uv = [[u, 0.5], [u, 0.5], [u, 0.5]];
          tris.push({ p: [ring(a, k), ring(a, k + 1), ring(b, k + 1)], uv }, { p: [ring(a, k), ring(b, k + 1), ring(b, k)], uv });
        }
    };
    tube(0, 2, 0.25);
    tube(2, 4, 0.75);
    const mesh = doc.createMesh('trunk').addPrimitive(triPrim(doc, tris));
    const r = await simplifyMeshList(doc, [mesh], 0.25);
    expect(r.after).toBeLessThan(r.before * 0.6);
    const pos = mesh.listPrimitives()[0].getAttribute('POSITION')!;
    const below = new Set<string>(), above = new Set<string>();
    for (let f = 0; f < pos.getCount() / 3; f++) {
      const vs = [0, 1, 2].map((k) => pos.getElement(f * 3 + k, [] as number[]));
      const cy = (vs[0][1] + vs[1][1] + vs[2][1]) / 3;
      for (const v of vs) if (Math.abs(v[1] - 2) < 1e-4) (cy < 2 ? below : above).add(v.map((x) => x.toFixed(3)).join(','));
    }
    // The seam ring is the same seen from either segment: no gap opened between them.
    expect([...below].sort()).toEqual([...above].sort());
    expect(below.size).toBeGreaterThanOrEqual(3);
  });

  it('an export keeps LOD0 of a file that carries its own LODs; lods adds a node per level from them', async () => {
    const doc = new Document();
    doc.createBuffer();
    const mat = doc.createMaterial('M').setBaseColorTexture(doc.createTexture('t').setImage(await pngOf(4, 4, () => [100, 100, 100, 255])).setMimeType('image/png'));
    /** A flat plane of cols × rows quads (two triangles each), UVs in one swatch. */
    const grid = (cols: number, rows: number) =>
      Array.from({ length: cols * rows }, (_, q) => {
        const x = q % cols, z = Math.floor(q / cols), uv = [[0.1, 0.1], [0.1, 0.1], [0.1, 0.1]];
        return [
          { p: [[x, 0, z], [x + 1, 0, z + 1], [x + 1, 0, z]], uv },
          { p: [[x, 0, z], [x, 0, z + 1], [x + 1, 0, z + 1]], uv },
        ];
      }).flat();
    const root = doc.createNode('SM_Env_Rock_01');
    for (const [lvl, c, r] of [[0, 5, 4], [1, 5, 2], [2, 2, 2]] as const) root.addChild(doc.createNode(`SM_Env_Rock_01_LOD${lvl}`).setMesh(doc.createMesh(`l${lvl}`).addPrimitive(triPrim(doc, grid(c, r), mat))));
    doc.createScene('s').addChild(root);
    const file = path.join(tmp, 'rock.glb');
    await new NodeIO().write(file, doc);
    const input = { name: 'rock', source: { pack: 'P', asset: 'SM_Env_Rock_01', assetId: 1 }, kind: 'prop', glb: file, scaleFix: 1, origin: 'bottom-centre' as const, texFormat: 'keep' as const };
    const plain = await buildModel(input);
    const d0 = await modelIO().readBinary(plain.glb);
    expect(d0.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => n.getName())).toEqual(['SM_Env_Rock_01_LOD0']);
    expect(plain.manifest.lods).toBeUndefined();
    const lod = await buildModel({ ...input, lods: [0.5, 0.2] });
    expect(lod.manifest.lods).toEqual([
      { level: 0, node: 'LOD0', ratio: 1, triangles: 40, source: 'model' },
      { level: 1, node: 'LOD1', ratio: 0.5, triangles: 20, source: 'synty' },
      { level: 2, node: 'LOD2', ratio: 0.2, triangles: 8, source: 'synty' },
    ]);
    const d1 = await modelIO().readBinary(lod.glb);
    const names = (n: Node) => n.listChildren().map((c) => c.getName());
    const r = d1.getRoot().listNodes().find((n) => n.getName() === 'rock')!;
    expect(names(r)).toEqual(['LOD0', 'LOD1', 'LOD2']);
    expect(names(r.listChildren()[1])).toEqual(['SM_Env_Rock_01_LOD1']);
    // Every level stands on the same origin as LOD0.
    const t0 = r.listChildren()[0].listChildren()[0].getTranslation(), t1 = r.listChildren()[1].listChildren()[0].getTranslation();
    expect(t1).toEqual(t0);
    // A model without its own levels is simplified.
    const one = new Document();
    one.createBuffer();
    const m1 = one.createMaterial('M');
    one.createScene('s').addChild(one.createNode('SM_Prop_Box_01').setMesh(one.createMesh('b').addPrimitive(triPrim(one, grid(10, 10), m1))));
    const file1 = path.join(tmp, 'box.glb');
    await new NodeIO().write(file1, one);
    const flat = await buildModel({ ...input, glb: file1, source: { ...input.source, asset: 'SM_Prop_Box_01' }, lods: [0.5] });
    expect(flat.manifest.lods?.[1]).toMatchObject({ node: 'LOD1', source: 'simplified' });
    expect(flat.manifest.lods![1].triangles).toBeLessThanOrEqual(130);
    expect(normaliseSpec({ asset: 1, lods: [0.5, 0.2] }).lods).toEqual([0.5, 0.2]);
    expect(() => normaliseSpec({ asset: 1, lods: [0.2, 0.5] })).toThrow(/fall/);
    expect(() => normaliseSpec({ asset: 1, lods: [1.2] })).toThrow(/0\.01–0\.95/);
  });
});

describe('paint (CS-FB-026, CS-FB-028)', () => {
  /** A node with one box-like quad whose UVs span the given texel box of a W×W texture. */
  const quad = (doc: Document, name: string, mat: Material, u0: number, v0: number, u1: number, v1: number) =>
    doc.createNode(name).setMesh(
      doc.createMesh(name).addPrimitive(
        triPrim(doc, [
          { p: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], uv: [[u0, v1], [u1, v1], [u1, v0]] },
          { p: [[0, 0, 0], [1, 1, 0], [0, 1, 0]], uv: [[u0, v1], [u1, v0], [u0, v0]] },
        ], mat),
      ),
    );

  it('part names are read without the model\'s: an OpenWheeler body is not a wheel', async () => {
    expect(paintLocalName('SM_Veh_OpenWheeler_01', 'SM_Veh_OpenWheeler_01')).toBe('');
    expect(paintLocalName('SM_Veh_OpenWheeler_01_Halo_01', 'SM_Veh_OpenWheeler_01')).toBe('Halo_01');
    expect(paintLocalName('SM_Veh_OpenWheeler_01_Wheel_FL', 'SM_Veh_OpenWheeler_01')).toBe('Wheel_FL');
    const doc = new Document();
    doc.createBuffer();
    const tex = doc.createTexture('livery').setMimeType('image/png').setImage(await pngOf(8, 8, (x) => (x < 6 ? [230, 180, 40, 255] : [20, 20, 20, 255])));
    const mat = doc.createMaterial('M').setBaseColorTexture(tex);
    const body = quad(doc, 'SM_Veh_OpenWheeler_01', mat, 0.05, 0.05, 0.7, 0.95);
    expect(await analysePaint(doc, [body], 0.16)).toBeNull(); // the old rule: "OpenWheeler" reads as a wheel
    const p = await analysePaint(doc, [body], 0.16, { asset: 'SM_Veh_OpenWheeler_01' });
    expect(p?.paint.map((v) => Math.round(v * 255))).toEqual([230, 180, 40]);
  });

  it('decals: false paints a livery\'s design over (a decal reaching the texture edge too); paint names the swatch', async () => {
    const W = 32;
    const make = async (stripe = [180, 80, 120]) => {
      const doc = new Document();
      doc.createBuffer();
      // A pink livery with a grey "puppy" touching the top edge and a darker pink stripe.
      const tex = doc.createTexture('livery').setMimeType('image/png').setImage(
        await pngOf(W, W, (x, y) => (x >= 10 && x <= 20 && y <= 8 ? [190, 190, 185, 255] : y >= 28 ? [...stripe, 255] : [200, 128, 155, 255])),
      );
      const mat = doc.createMaterial('M').setBaseColorTexture(tex);
      return { doc, tex, node: quad(doc, 'Body', mat, 0, 0, 1, 1) };
    };
    const px = async (t: { getImage(): Uint8Array | null }, x: number, y: number) => [...(await sharp(Buffer.from(t.getImage()!)).raw().toBuffer()).subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
    const keep = await make();
    expect(await paintTint(keep.doc, [keep.node], [0, 0.5, 1])).toBe(true);
    expect(await px(keep.tex, 15, 2)).toEqual([190, 190, 185]); // the decal stays by default
    const drop = await make();
    expect(await paintTint(drop.doc, [drop.node], [0, 0.5, 1], 0.16, { decals: false })).toBe(true);
    expect(await px(drop.tex, 15, 2)).toEqual([0, 128, 255]);
    // The darker stripe is a shade of the paint: tinted, keeping its shade.
    const stripe = await px(drop.tex, 15, 30);
    expect(stripe[0]).toBe(0);
    expect(stripe[2]).toBeGreaterThan(150);
    expect(stripe[2]).toBeLessThan(255);
    // No tint: the decals go in the paint's own colour.
    const own = await make();
    expect(await paintTint(own.doc, [own.node], null, 0.16, { decals: false })).toBe(true);
    expect(await px(own.tex, 15, 2)).toEqual([200, 128, 155]);
    // paint names the second colour (a green stripe no triangle centre lands on): only it is recoloured.
    const named = await make([40, 160, 60]);
    expect(await paintTint(named.doc, [named.node], [0, 0.5, 1], 0.16, { paint: '#28a03c' })).toBe(true);
    expect(await px(named.tex, 15, 30)).toEqual([0, 128, 255]);
    expect(await px(named.tex, 15, 16)).toEqual([200, 128, 155]);
  });

  it('without textured paint, only the body\'s materials take the tint: tyres, rims and glass do not', () => {
    const doc = new Document();
    doc.createBuffer();
    const paint = doc.createMaterial('Body_Paint'), tyre = doc.createMaterial('Tyre_Rubber'), rim = doc.createMaterial('Chrome');
    const n = (name: string, m: Material) => doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(triPrim(doc, [swatchTri(0)], m)));
    const own = [n('SM_Veh_Kart_01', paint), n('SM_Veh_Kart_01_Wheel_FL', tyre), n('SM_Veh_Kart_01_Hub', rim)];
    expect([...fallbackPaintMaterials(own, { asset: 'SM_Veh_Kart_01' })].map((m) => m.getName())).toEqual(['Body_Paint']);
    expect([...fallbackPaintMaterials(own, { asset: 'SM_Veh_Kart_01', paint: 'chrome' })].map((m) => m.getName())).toEqual(['Chrome']);
    expect(normaliseSpec({ asset: 1, paint: '#E3B52F', decals: false })).toMatchObject({ paint: '#e3b52f', decals: false });
    expect(normaliseSpec({ asset: 1, decals: true }).decals).toBeUndefined();
    expect(() => normaliseSpec({ asset: 1, paint: '#zz' })).toThrow(/paint/);
  });
});

describe('dashboard (CS-FB-023)', () => {
  it('principal axes of a disc: its normal is the least spread', () => {
    const e = eigen3([[4, 0, 0], [0, 1, 0], [0, 0, 9]]);
    expect(e.values).toEqual([9, 4, 1]);
    const pts = Array.from({ length: 24 }, (_, i) => [Math.cos(i / 3.8) * 0.05, 1 + Math.sin(i / 3.8) * 0.05, 0.5]);
    expect(Math.abs(principalAxes(pts).vectors[2][2])).toBeCloseTo(1, 5);
  });

  it('a dial and its needle: centre, normal towards the needle side, pivot and axis; an unpivoted needle turns at the centre', () => {
    const doc = new Document();
    doc.createBuffer();
    const disc: { p: number[][]; uv: number[][] }[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (2 * Math.PI * k) / 12, b = (2 * Math.PI * (k + 1)) / 12;
      disc.push({ p: [[0, 1, 0.5], [Math.cos(a) * 0.05, 1 + Math.sin(a) * 0.05, 0.5], [Math.cos(b) * 0.05, 1 + Math.sin(b) * 0.05, 0.5]], uv: [[0, 0], [0, 0], [0, 0]] });
    }
    const dial = doc.createNode('Car_Speedometer_01').setMesh(doc.createMesh('d').addPrimitive(triPrim(doc, disc)));
    // The needle: a thin sliver from 1 cm behind the centre to 4 cm left of it, 2 mm in front of the face (-Z).
    const needle = doc.createNode('Car_Speedometer_Needle_01').setMesh(
      doc.createMesh('n').addPrimitive(triPrim(doc, [{ p: [[-0.01, 1, 0.498], [0.04, 1.002, 0.498], [0.04, 0.998, 0.498]], uv: [[0, 0], [0, 0], [0, 0]] }])),
    );
    const parts = [
      { node: dial.getName(), role: 'gauge', pivot: [0, 0, 0] as [number, number, number] },
      { node: needle.getName(), role: 'needle', pivot: [0, 0, 0] as [number, number, number] },
    ];
    const moved: [string, number[]][] = [];
    const d = dashboardOf([dial, needle], parts, new Set(), (n, at) => moved.push([n.getName(), at]))!;
    expect(d.gauges).toHaveLength(1);
    const g = d.gauges[0];
    expect(g.center.map((v) => +v.toFixed(3))).toEqual([0, 1, 0.5]);
    expect(g.normal).toEqual([0, 0, -1]);
    expect(g.radius).toBeCloseTo(0.05, 3);
    expect(g.needle!.pivot.map((v) => +v.toFixed(3))).toEqual([0, 1, 0.498]);
    expect(g.needle!.axis).toEqual([0, 0, 1]);
    expect(g.needle!.rest[0]).toBeCloseTo(1, 2);
    expect(g.needle!.length).toBeCloseTo(0.04, 3);
    expect(moved.map((m) => m[0])).toEqual(['Car_Speedometer_Needle_01']);
    expect(parts[1]).toMatchObject({ axis: [0, 0, 1] });
  });
});

describe('texture export options (CS-FB-021)', () => {
  it('texture export options: size and format checked', () => {
    expect(textureExportOptions({ size: '512', format: 'webp' })).toEqual({ size: 512, format: 'webp' });
    expect(textureExportOptions({})).toEqual({});
    expect(() => textureExportOptions({ size: '3' })).toThrow(TextureOptionError);
    expect(() => textureExportOptions({ format: 'jpg' })).toThrow(/png, webp/);
  });
});

