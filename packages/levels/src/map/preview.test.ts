// Moved from the old generator's packages/shared/src/map/preview.test.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { describe, expect, it } from 'vitest';
import {
  addTerrain, addWangset, composeMap, createImage, defaultMapBody, defaultTilesetBody, groundPixel, renderMapPreview, renderMinimap, renderTilesetAtlas,
  resolveGround, splitGid, ZONE_COLORS, hexToRgba, placeLabels, boxesOverlap,
  type GroundLayer, type MapBody, type MapObject, type ObjectLayer, type ObjectPicture, type PreviewTileset, type RgbaImage, type TilesetBody, type ZoneLayer,
} from '../index.js';

const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

function tileset(o: Partial<TilesetBody> = {}): PreviewTileset {
  let b = defaultTilesetBody('Ground', o);
  b = addTerrain(b, { name: 'Grass' }).body;
  b = addTerrain(b, { name: 'Dirt' }).body;
  b = addWangset(b, { pairs: [['grass', 'dirt']], variants: 1 }).body;
  const a = renderTilesetAtlas(b);
  return { body: b, atlas: a.image, columns: a.columns };
}

/** A 4×3 map with a patch of dirt corners. */
function map(ts: PreviewTileset, o: Partial<MapBody> = {}): MapBody {
  const m = defaultMapBody('Test', { width: 4, height: 3, tilesets: [1], terrain: 'grass', tileWidth: ts.body.tileWidth, tileHeight: ts.body.tileHeight, orientation: ts.body.orientation, ...o });
  const g = m.layers.find((l) => l.type === 'ground') as GroundLayer;
  for (const [x, y] of [[1, 1], [2, 1], [2, 2]]) g.corners[y * 5 + x] = 'dirt';
  return m;
}
const objectsOf = (m: MapBody) => (m.layers.find((l) => l.type === 'objects') as ObjectLayer).objects;

/** A fake export frame: a page with a solid trimmed rect (w×h at page (2, 2)), untrimmed size sw×sh, its top-left at (trimX, trimY). */
function picture(colour: number[], o: { w?: number; h?: number; trimX?: number; trimY?: number; sw?: number; sh?: number; anchor?: { x: number; y: number }; flipX?: boolean; firstCol?: number[]; strips?: ObjectPicture['strips'] } = {}): ObjectPicture {
  const w = o.w ?? 4, h = o.h ?? 20;
  const page = createImage(w + 4, h + 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) page.data.set(x === 0 && o.firstCol ? o.firstCol : colour, ((y + 2) * page.width + x + 2) * 4);
  return {
    page, frame: { x: 2, y: 2, w, h }, trimX: o.trimX ?? 3, trimY: o.trimY ?? 0, sourceW: o.sw ?? 10, sourceH: o.sh ?? h,
    flipX: !!o.flipX, anchor: o.anchor ?? { x: 5, y: h - 1 }, pixelsPerMetre: null, ...(o.strips ? { strips: o.strips } : {}),
  };
}
const RED = [220, 30, 30, 255], BLUE = [30, 60, 220, 255], GREEN = [40, 200, 60, 255];
const ob = (id: string, x: number, y: number, extra: Partial<MapObject> = {}): MapObject => ({ id, spriteId: 1, x, y, properties: {}, ...extra });

describe('map preview: ground', () => {
  it('at scale 1 the ground is exactly composeMap of the resolved tiles (iso and orthogonal)', () => {
    for (const geo of [{}, { orientation: 'orthogonal' as const, tileWidth: 32, tileHeight: 32 }]) {
      const ts = tileset(geo);
      const m = map(ts);
      const gids = resolveGround(m, m.layers[0] as GroundLayer, ts.body).gids;
      const cells = Array.from({ length: m.height }, (_, y) => Array.from({ length: m.width }, (_, x) => splitGid(gids[y * m.width + x])?.id ?? null));
      const want = composeMap(ts.body, ts.atlas, cells, ts.columns);
      expect(want.overlaps).toBe(0);
      const got = renderMapPreview(m, [ts], () => null);
      expect(got.origin).toEqual([0, 0]);
      expect([got.image.width, got.image.height]).toEqual([want.image.width, want.image.height]);
      expect(Buffer.from(got.image.data).equals(Buffer.from(want.image.data))).toBe(true);
    }
  });

  it('decoration tiles draw over the ground; layers= picks layers by name or type', () => {
    const ts = tileset();
    const m = map(ts);
    const dirtTile = ts.body.tiles.find((t) => t.terrainCorners?.every((c) => c === 'dirt'))!;
    const deco = m.layers.find((l) => l.type === 'decoration')!;
    if (deco.type === 'decoration') deco.cells[0] = 1 + dirtTile.id;
    const [cx, cy] = groundPixel(m, 0.5, 0.5).map(Math.floor);
    const plain = renderMapPreview(m, [ts], () => null, { layers: ['ground'] });
    const withDeco = renderMapPreview(m, [ts], () => null);
    const onlyDeco = renderMapPreview(m, [ts], () => null, { layers: ['decoration'] });
    expect(px(withDeco.image, cx, cy)).toEqual(px(onlyDeco.image, cx, cy));
    expect(px(withDeco.image, cx, cy)).not.toEqual(px(plain.image, cx, cy));
    expect(px(onlyDeco.image, ...(groundPixel(m, 2.5, 2.5).map(Math.floor) as [number, number]))[3]).toBe(0); // no ground in that render
  });

  it('scale and the size cap; shrinking averages without seams', () => {
    const ts = tileset();
    const m = map(ts);
    const half = renderMapPreview(m, [ts], () => null, { scale: 0.5 });
    expect([half.image.width, half.image.height, half.scale]).toEqual([112, 56, 0.5]);
    const capped = renderMapPreview(m, [ts], () => null, { scale: 2, maxSize: 100 });
    expect(capped.image.width).toBe(100);
    expect(capped.scale).toBeCloseTo(100 / 224, 6);
    // Inside the diamond every pixel is opaque (no gaps between tiles), whatever the scale.
    for (const r of [half, capped, renderMapPreview(m, [ts], () => null, { scale: 1.7 })]) {
      const [x, y] = groundPixel(m, 2, 1.5).map((v) => Math.floor(v * r.scale));
      for (let dy = -6; dy <= 6; dy++) for (let dx = -12; dx <= 12; dx++) expect(px(r.image, x + dx, y + dy)[3]).toBe(255);
    }
  });
});

describe('map preview: objects', () => {
  const ts = tileset();
  it('a frame is placed by its anchor at the object position, and the front object (larger ground y) wins', () => {
    const m = map(ts);
    // A at (2.5, 1.5) → native (128, 64); B in front at (3, 2) → (128, 80). Frames 4×20, anchor (5, 19), trim x 3.
    objectsOf(m).push(ob('b', 3, 2, { name: 'B' }), ob('a', 2.5, 1.5, { name: 'A' }));
    const pics: Record<string, ObjectPicture> = { a: picture(RED), b: picture(BLUE) };
    const r = renderMapPreview(m, [ts], (o) => pics[o.id]);
    expect(r.sprites.sort()).toEqual(['a', 'b']);
    expect(r.origin).toEqual([0, 0]);
    // A's frame: left 128 − 5 = 123, drawn columns 126…129, rows 45…64.
    expect(px(r.image, 126, 46)).toEqual(RED);
    expect(px(r.image, 129, 60)).toEqual(RED);
    expect(px(r.image, 125, 50)).not.toEqual(RED);
    expect(px(r.image, 130, 50)).not.toEqual(RED);
    // Overlap rows 61…64: B is in front.
    expect(px(r.image, 127, 62)).toEqual(BLUE);
    expect(px(r.image, 127, 80)).toEqual(BLUE);
  });

  it('mirrored directions flip the untrimmed frame', () => {
    const m = map(ts);
    objectsOf(m).push(ob('a', 2.5, 1.5));
    const plain = renderMapPreview(m, [ts], () => picture(RED, { firstCol: GREEN }));
    const flipped = renderMapPreview(m, [ts], () => picture(RED, { firstCol: GREEN, flipX: true }));
    // Untrimmed column 3 is green: at 123 + 3 unflipped, at 123 + (10 − 1 − 3) flipped.
    expect(px(plain.image, 126, 50)).toEqual(GREEN);
    expect(px(plain.image, 129, 50)).toEqual(RED);
    expect(px(flipped.image, 129, 50)).toEqual(GREEN);
    expect(px(flipped.image, 126, 50)).toEqual(RED);
  });

  it('column slices are sorted strip by strip', () => {
    const m = map(ts);
    // C at A's spot, its left strip sorted at the top of the frame (45), its right one at 85: B (80) is between.
    objectsOf(m).push(ob('c', 2.5, 1.5), ob('b', 3, 2));
    const strips = [{ x: 0, y: 0, w: 5, h: 20, sortY: 0 }, { x: 5, y: 0, w: 5, h: 20, sortY: 40 }];
    const r = renderMapPreview(m, [ts], (o) => (o.id === 'c' ? picture(RED, { strips }) : picture(BLUE)));
    expect(px(r.image, 127, 62)).toEqual(BLUE); // left strip, behind B
    expect(px(r.image, 128, 62)).toEqual(RED); // right strip, in front of B
    expect(px(r.image, 127, 50)).toEqual(RED);
  });

  it('scales frames by the map\'s pixels per metre over the export\'s; tall objects grow the picture', () => {
    const m = map(ts);
    objectsOf(m).push(ob('a', 0.5, 0.5));
    const pic = { ...picture(RED, { h: 40, anchor: { x: 5, y: 39 } }), pixelsPerMetre: 45.254834 / 2 };
    const r = renderMapPreview(m, [ts], () => pic);
    // (0.5, 0.5) → native (96, 16); frame twice as big: top 16 − 78 = −62 → the picture starts 62 px higher.
    expect(r.origin).toEqual([0, -62]);
    expect(r.image.height).toBe(112 + 62);
    const [x, y] = [96 - 10 + 3 * 2 + 1, 16 - 78 + 2 + 62];
    expect(px(r.image, x, y)).toEqual(RED);
  });

  it('objects without a picture are footprint diamonds with their name', () => {
    const m = map(ts);
    objectsOf(m).push(ob('p', 1.5, 0.5, { name: 'Bunker', footprint: { w: 1, h: 1 } }));
    const r = renderMapPreview(m, [ts], () => null);
    expect(r.placeholders).toEqual(['p']);
    const [x, y] = groundPixel(m, 1.5, 0.5);
    const c = px(r.image, x, y + 4);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(c[1]).toBeGreaterThan(c[2]);
    const unlabelled = renderMapPreview(m, [ts], () => null, { labels: false });
    expect(Buffer.from(unlabelled.image.data).equals(Buffer.from(r.image.data))).toBe(false);
  });
});

describe('map preview: overlays and minimap', () => {
  const ts = tileset();
  const withZone = () => {
    const m = map(ts);
    (m.layers.find((l) => l.type === 'zones') as ZoneLayer).zones.push(
      { id: 'z1', kind: 'spawn', name: 'Drop', shape: 'point', points: [[0.5, 2.5]], properties: {} },
      { id: 'z2', kind: 'objective', name: 'Radio', shape: 'rect', points: [[2, 0], [4, 2]], properties: {} },
    );
    return m;
  };
  it('zones: a marker in the kind\'s colour, rect outlines; zones=false leaves them out', () => {
    const m = withZone();
    const on = renderMapPreview(m, [ts], () => null);
    const off = renderMapPreview(m, [ts], () => null, { zones: false });
    const [x, y] = groundPixel(m, 0.5, 2.5);
    const green = hexToRgba(ZONE_COLORS.spawn);
    const c = px(on.image, x, y);
    expect(Math.abs(c[1] - green[1])).toBeLessThan(40);
    expect(c[1]).toBeGreaterThan(c[0]);
    // The rect's corner (2, 0) on the outline is objective yellow.
    const [rx, ry] = groundPixel(m, 3, 0).map(Math.floor);
    const yellow = hexToRgba(ZONE_COLORS.objective);
    px(on.image, rx, ry).slice(0, 3).forEach((v, i) => expect(Math.abs(v - yellow[i])).toBeLessThan(12));
    expect(px(off.image, rx, ry)).not.toEqual(px(on.image, rx, ry));
  });

  it('grid and collision overlays change only when asked', () => {
    const m = map(ts);
    const base = renderMapPreview(m, [ts], () => null);
    const grid = renderMapPreview(m, [ts], () => null, { grid: true });
    const changed = (a: RgbaImage, b: RgbaImage) => { let n = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) n++; return n; };
    expect(changed(base.image, grid.image)).toBeGreaterThan(200);
    const col = m.layers.find((l) => l.type === 'collision')!;
    if (col.type === 'collision') col.cells[5] = 1;
    expect(changed(base.image, renderMapPreview(m, [ts], () => null).image)).toBe(0);
    const red = renderMapPreview(m, [ts], () => null, { collision: true });
    const [x, y] = groundPixel(m, 1.5, 1.5);
    expect(px(red.image, x, y)[0]).toBeGreaterThan(px(base.image, x, y)[0]);
  });

  it('minimap: one block per cell in the tile\'s average colour, object dots, zones', () => {
    const m = withZone();
    objectsOf(m).push(ob('a', 1.5, 1.5, { footprint: { w: 1, h: 1 } }));
    const r = renderMinimap(m, [ts], { cellPx: 4 });
    expect([r.image.width, r.image.height, r.cellPx]).toEqual([16, 12, 4]);
    // Cell (3, 2) is pure grass (its corners are all grass): the average of the grass tile.
    const grass = ts.body.tiles.find((t) => t.terrainCorners?.every((c) => c === 'grass'))!;
    let s = [0, 0, 0], n = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 64; x++) {
        const c = px(ts.atlas, (grass.id % ts.columns) * 64 + x, Math.floor(grass.id / ts.columns) * 32 + y);
        if (c[3] >= 128) (s = s.map((v, i) => v + c[i])), n++;
      }
    const got = px(r.image, 3 * 4 + 1, 2 * 4 + 2);
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - s[i] / n)).toBeLessThanOrEqual(1);
    expect(px(r.image, 6, 6)).toEqual([255, 244, 214, 255]); // the object's dot at (1.5, 1.5) · 4
    expect(px(r.image, 2, 10)).toEqual(hexToRgba(ZONE_COLORS.spawn).slice(0, 3).concat(255)); // spawn point at (0.5, 2.5) · 4
    expect(renderMinimap(defaultMapBody('Big', { width: 100, height: 50 }), []).cellPx).toBe(2);
  });

  it('minimap: blocked cells are shaded only with collision or a collision layer in layers (FB-064); layers is honoured', () => {
    const m = withZone();
    objectsOf(m).push(ob('a', 1.5, 1.5, { footprint: { w: 1, h: 1 } }));
    const col = m.layers.find((l) => l.type === 'collision')!;
    if (col.type === 'collision') col.cells[2 * m.width + 3] = 1; // cell (3, 2)
    const at = (img: RgbaImage) => px(img, 3 * 4 + 1, 2 * 4 + 2);
    const plain = renderMinimap(m, [ts], { cellPx: 4 });
    const noCol = structuredClone(m);
    const c2 = noCol.layers.find((l) => l.type === 'collision')!;
    if (c2.type === 'collision') c2.cells.fill(0);
    expect(at(plain.image)).toEqual(at(renderMinimap(noCol, [ts], { cellPx: 4 }).image));
    const red = renderMinimap(m, [ts], { cellPx: 4, collision: true });
    expect(at(red.image)[0]).toBeGreaterThan(at(red.image)[1] + 40);
    expect(at(renderMinimap(m, [ts], { cellPx: 4, layers: ['ground', 'collision'] }).image)).toEqual(at(red.image));
    expect(at(renderMinimap(m, [ts], { cellPx: 4, layers: ['ground', 'collision'], collision: false }).image)).toEqual(at(plain.image));
    // layers: ground only leaves out the object's dot and the zones.
    const ground = renderMinimap(m, [ts], { cellPx: 4, layers: ['ground'] });
    expect(px(ground.image, 6, 6)).not.toEqual([255, 244, 214, 255]);
    expect(px(ground.image, 2, 10)).not.toEqual(hexToRgba(ZONE_COLORS.spawn).slice(0, 3).concat(255));
    const go = renderMinimap(m, [ts], { cellPx: 4, layers: ['ground', 'objects'] });
    expect(px(go.image, 6, 6)).toEqual([255, 244, 214, 255]);
  });
});

describe('map preview: label placement (FB-046)', () => {
  /** A crowded 12×10 map: guard spawns, pods and a patrol bunched around an objective, plus objects without exports. */
  function crowded(): MapBody {
    const m = defaultMapBody('Crowded', { width: 12, height: 10, terrain: '' });
    const zl = m.layers.find((l) => l.type === 'zones') as ZoneLayer;
    const pt = (id: string, kind: ZoneLayer['zones'][number]['kind'], name: string, x: number, y: number) => zl.zones.push({ id, kind, name, shape: 'point', points: [[x, y]], properties: {} });
    zl.zones.push({ id: 'radar', kind: 'objective', name: 'Radar array', shape: 'rect', points: [[3, 2], [8, 7]], properties: {} });
    zl.zones.push({ id: 'loop', kind: 'patrol', name: 'radar loop', shape: 'polyline', points: [[3, 2], [3, 7], [8, 7]], properties: {} });
    pt('g1', 'spawn', 'guard', 5.5, 4.5);
    pt('g2', 'spawn', 'guard', 6.5, 4.5);
    pt('g3', 'spawn', 'guard tower', 5.5, 5.5);
    pt('p1', 'custom', 'supply pod', 6.5, 5.5);
    pt('p2', 'custom', 'supply pod', 4.5, 4.5);
    pt('t1', 'trigger', 'alarm', 5.5, 3.5);
    pt('e1', 'extraction', 'pickup', 7.5, 6.5);
    objectsOf(m).push(ob('a', 5.5, 5, { spriteId: undefined, assetRef: 'SM_Prop_Crate_01', footprint: { w: 1, h: 1 } }));
    objectsOf(m).push(ob('b', 6, 4.5, { spriteId: undefined, assetRef: 'SM_Prop_Barrel_01', footprint: { w: 1, h: 1 } }));
    return m;
  }

  it('no two label boxes intersect on a crowded map; moved ones get a leader line', () => {
    for (const scale of [1, 0.5]) {
      const r = renderMapPreview(crowded(), [], () => null, { scale });
      expect(r.labels).toHaveLength(11);
      for (let i = 0; i < r.labels.length; i++)
        for (let j = i + 1; j < r.labels.length; j++) expect(boxesOverlap(r.labels[i].box, r.labels[j].box), `${r.labels[i].text} / ${r.labels[j].text}`).toBe(false);
      for (const l of r.labels) {
        expect(l.box.x).toBeGreaterThanOrEqual(0);
        expect(l.box.y).toBeGreaterThanOrEqual(0);
        expect(l.box.x + l.box.w).toBeLessThanOrEqual(r.image.width);
        expect(l.box.y + l.box.h).toBeLessThanOrEqual(r.image.height);
      }
      expect(r.labels.some((l) => l.leader)).toBe(true);
    }
  });

  it('labels: all (default) / zones / none; true and false still work', () => {
    const texts = (labels?: 'zones' | 'all' | 'none' | boolean) => renderMapPreview(crowded(), [], () => null, { labels }).labels.map((l) => l.text);
    expect(texts()).toEqual(expect.arrayContaining(['objective: Radar array', 'spawn: guard', 'SM_Prop_Crate_01']));
    expect(texts('all')).toEqual(texts());
    expect(texts(true)).toEqual(texts());
    expect(texts('zones')).toHaveLength(9);
    expect(texts('zones')).not.toContain('SM_Prop_Crate_01');
    expect(texts('none')).toEqual([]);
    expect(texts(false)).toEqual([]);
  });

  it('placeLabels: a label that fits where it wants stays there; the same spot twice moves the second', () => {
    const white: [number, number, number, number] = [255, 255, 255, 1];
    const [a, b] = placeLabels([{ text: 'one', x: 50, y: 10, color: white }, { text: 'two', x: 50, y: 60, color: white }], { width: 100, height: 100 });
    expect(a).toMatchObject({ leader: false, box: { x: Math.round(50 - a.box.w / 2), y: 10 } });
    expect(b.box.y).toBe(60);
    const [c, d] = placeLabels([{ text: 'same', x: 50, y: 50, color: white }, { text: 'same', x: 50, y: 50, color: white }], { width: 100, height: 100 });
    expect(c.box).toMatchObject({ y: 50 });
    expect(boxesOverlap(c.box, d.box)).toBe(false);
  });

  it('placeLabels: measured box sizes (another font) replace the 3×5 font size', () => {
    const white: [number, number, number, number] = [255, 255, 255, 1];
    const [a, b] = placeLabels([{ text: 'x', x: 100, y: 50, color: white, w: 60, h: 15 }, { text: 'y', x: 100, y: 50, color: white, w: 60, h: 15 }], { width: 300, height: 200 });
    expect(a.box).toEqual({ x: 70, y: 50, w: 60, h: 15 });
    expect(b.box).toMatchObject({ w: 60, h: 15 });
    expect(boxesOverlap(a.box, b.box)).toBe(false);
  });
});
