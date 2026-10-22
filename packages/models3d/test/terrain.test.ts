// Moved from synty-sprite-generator packages/shared/src/model3d/terrain.test.ts (P3, ali3b/sloponator#14).
import { describe, expect, it } from 'vitest';
import {
  TERRAIN_TILES, buildSkyMesh, buildTerrainMesh, entryFrame, expandSkydome, expandTerrain, expandTrackpiece, normaliseSkydome, normaliseSpec, normaliseTerrain,
  normaliseTrackpiece, placeRing, riseShape, segmentFrame, specHash, tileDiagonal, type TerrainSpec,
} from '../src/index.js';

const C = 62.42, H = 27.43;
const mesh = (t: TerrainSpec) => buildTerrainMesh(expandTerrain(normaliseTerrain(t)));
/** Every land and water vertex of a terrain (x, y, z triples). */
function verts(t: TerrainSpec) {
  const m = mesh(t);
  const out: number[][] = [];
  for (const ch of m.chunks)
    for (const s of Object.values(ch.slots)) for (let i = 0; i < s.pos.length; i += 3) out.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]);
  return out;
}
/** The vertices on a tile edge, as "x,y" (N/S edges) or "z,y" (E/W edges) strings, sorted and unique. */
function edge(t: TerrainSpec, side: 'N' | 'S' | 'E' | 'W', shift: [number, number] = [0, 0]) {
  const c = t.cell ?? 30;
  const on = (v: number[]) => (side === 'N' ? v[2] === c : side === 'S' ? v[2] === 0 : side === 'E' ? v[0] === c / 2 : v[0] === -c / 2);
  return [...new Set(verts(t).filter(on).map((v) => (side === 'N' || side === 'S' ? `${v[0] + shift[0]},${v[1]}` : `${v[2] + shift[1]},${v[1]}`)))].sort();
}
/** A tile's corner heights [SW, SE, NW, NE] in steps. */
const corners = (t: TerrainSpec) => {
  const ex = expandTerrain(normaliseTerrain(t));
  return [ex.heights[0][0], ex.heights[0][1], ex.heights[1][0], ex.heights[1][1]];
};

const ALL: TerrainSpec[] = [
  { tile: 'flat' }, { tile: 'plateau' }, { tile: 'water' },
  ...(['N', 'E', 'S', 'W'] as const).map((dir) => ({ tile: 'slope' as const, dir })),
  ...(['NE', 'NW', 'SE', 'SW'] as const).flatMap((dir) => [{ tile: 'corner-outer' as const, dir }, { tile: 'corner-inner' as const, dir }, { tile: 'coast' as const, dir }]),
];

describe('terrain tiles (CS-FB-003)', () => {
  it('every tile kind at the game\'s dimensions: corners on the grid, 27.43 m a step', () => {
    for (const t of ALL) {
      const m = mesh({ ...t, cell: C, height: H });
      expect(m.bounds.min[0]).toBeCloseTo(-C / 2, 6);
      expect(m.bounds.max[0]).toBeCloseTo(C / 2, 6);
      expect(m.bounds.max[2]).toBeCloseTo(C, 6);
      expect(m.collider.idx.length).toBeGreaterThan(0);
    }
    expect(corners({ tile: 'slope' })).toEqual([0, 0, 1, 1]); // uphill to N (+Z)
    expect(corners({ tile: 'slope', dir: 'E' })).toEqual([0, 1, 0, 1]); // uphill to E (+X)
    expect(corners({ tile: 'corner-outer', dir: 'SW' })).toEqual([1, 0, 0, 0]);
    expect(corners({ tile: 'corner-inner', dir: 'NE' })).toEqual([0, 1, 1, 1]);
    expect(mesh({ tile: 'plateau', cell: C, height: H }).bounds.min[1]).toBeCloseTo(H, 6);
    expect(TERRAIN_TILES).toContain('coast');
  });

  it('neighbouring tiles exported apart share bit-identical edge vertices (planar and track shapes, subdivided)', () => {
    let pairs = 0;
    for (const shape of [{}, { shape: 'track' as const }, { subdiv: 4 }]) {
      const g = (t: TerrainSpec): TerrainSpec => ({ ...t, cell: C, height: H, ...shape });
      for (const a of ALL)
        for (const b of ALL) {
          const ca = corners(a), cb = corners(b);
          // b north of a: a's NW, NE are b's SW, SE.
          if (ca[2] === cb[0] && ca[3] === cb[1]) {
            expect(edge(g(a), 'N')).toEqual(edge(g(b), 'S'));
            pairs++;
          }
          // b east of a: a's SE, NE are b's SW, NW.
          if (ca[1] === cb[0] && ca[3] === cb[2]) {
            expect(edge(g(a), 'E')).toEqual(edge(g(b), 'W'));
            pairs++;
          }
        }
    }
    expect(pairs).toBeGreaterThan(200);
  });

  it('a grid is the tiles side by side: its vertex heights match single tiles exactly', () => {
    // A hill: plateau in the middle, slopes and corners round it, flat outside (3×3 tiles).
    const heights = [[0, 0, 0, 0], [0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0]];
    for (const shape of ['planar', 'track'] as const) {
      const grid = mesh({ heights, cell: C, height: H, shape });
      const vc = grid.vertexCols, n = shape === 'track' ? 8 : 1;
      // Tile (1, 0) is a slope up to N; tile (0, 0) an outer corner (NE up); tile (1, 1) a plateau.
      const single = (t: TerrainSpec) => mesh({ ...t, cell: C, height: H, shape }).vertexHeights;
      const check = (ti: number, tj: number, t: TerrainSpec) => {
        const s = single(t);
        for (let kv = 0; kv <= n; kv++) for (let ku = 0; ku <= n; ku++) expect(grid.vertexHeights[(tj * n + kv) * vc + ti * n + ku]).toBe(s[kv * (n + 1) + ku]);
      };
      check(1, 0, { tile: 'slope', dir: 'N' });
      check(0, 0, { tile: 'corner-outer', dir: 'NE' });
      check(2, 2, { tile: 'corner-outer', dir: 'SW' });
      check(1, 1, { tile: 'plateau' });
      expect(grid.chunks).toHaveLength(1);
    }
  });

  it('an outer corner keeps its high corner alone in one triangle; an inner corner its low one', () => {
    expect(tileDiagonal([0, 0, 0, 1], '')).toBe('b'); // NE high: the SE–NW diagonal
    expect(tileDiagonal([1, 0, 0, 0], '')).toBe('b');
    expect(tileDiagonal([0, 1, 0, 0], '')).toBe('a');
    expect(tileDiagonal([0, 1, 1, 1], '')).toBe('b');
    // The outer corner's flat triangle sits on the ground: half the tile is level.
    const m = mesh({ tile: 'corner-outer', dir: 'NE', cell: C, height: H });
    const s = m.chunks[0].slots;
    const level = [...s.ground.nrm, ...s.slope.nrm].filter((_, i) => i % 9 === 1).filter((ny) => ny > 0.9999).length;
    expect(level).toBe(1);
  });

  it('the track shape follows the slope-up piece: level at both ends, the deck\'s heights along the tile', () => {
    const ex = expandTerrain(normaliseTerrain({ tile: 'slope', cell: C, height: H, shape: 'track' }));
    const S = riseShape(ex);
    expect(S(0)).toBe(0);
    expect(S(1)).toBe(1);
    expect(S(0.5)).toBeCloseTo(0.5, 9);
    expect(S(0.3) + S(0.7)).toBeCloseTo(1, 12);
    // The slope-up piece's path, sampled: at each point the terrain shape gives its height.
    const tp = expandTrackpiece(normaliseTrackpiece({ preset: 'slope-up', cell: C, height: H, width: 14.63 }));
    let f = entryFrame(tp);
    for (const seg of tp.path) {
      for (const x of [0.25, 0.5, 0.75, 1]) {
        const p = segmentFrame(f, seg, seg.length * x).p;
        expect(H * S(p[2] / C)).toBeCloseTo(p[1], 6);
      }
      f = segmentFrame(f, seg, seg.length);
    }
    expect(() => normaliseTerrain({ tile: 'slope', cell: 2, height: 500, shape: 'track' })).toThrow(/too steep/);
  });

  it('CS-FB-020: shape track with transition 0 is a constant grade, as slope-up with transition 0', () => {
    const ex = expandTerrain(normaliseTerrain({ tile: 'slope', cell: C, height: H, shape: 'track', transition: 0 }));
    const S = riseShape(ex);
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.95, 1]) expect(S(t)).toBeCloseTo(t, 9);
    const tp = expandTrackpiece(normaliseTrackpiece({ preset: 'slope-up', cell: C, height: H, width: 14.63, transition: 0 }));
    let f = entryFrame(tp);
    for (const seg of tp.path) {
      for (const x of [0.1, 0.25, 0.75, 0.95, 1]) {
        const p = segmentFrame(f, seg, seg.length * x).p;
        expect(H * S(p[2] / C)).toBeCloseTo(p[1], 6);
      }
      f = segmentFrame(f, seg, seg.length);
    }
  });

  it('water and coasts: a water surface at the level over the wet triangles; the bed sinks inside open water', () => {
    const w = mesh({ tile: 'water', cell: C });
    expect(w.chunks[0].water.pos.length / 9).toBe(2);
    expect(w.waterTiles).toBe(1);
    const coast = mesh({ tile: 'coast', dir: 'NE', cell: C });
    const tri = coast.chunks[0].water.pos;
    expect(tri.length / 9).toBe(1);
    // The water triangle has the NE corner and the shore on the SE–NW diagonal.
    const pts = [0, 1, 2].map((k) => `${tri[k * 3]},${tri[k * 3 + 2]}`).sort();
    expect(pts).toEqual([`${-C / 2},${C}`, `${C / 2},${0}`, `${C / 2},${C}`].sort());
    expect(tri[1]).toBe(0.02);
    // A lake in a grid: the middle corner (all four tiles wet) sinks to the bed; the shore corners stay.
    const lake = mesh({ heights: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], water: ['ww', 'ww'], cell: C, depth: 2 });
    expect(lake.vertexHeights[1 * 3 + 1]).toBeCloseTo(0.02 - 2, 9);
    expect(lake.vertexHeights[0]).toBe(0);
    // Shore and seabed slots: the coast's land half is shore (sand).
    expect(coast.chunks[0].slots.shore.pos.length).toBeGreaterThan(0);
    expect(coast.chunks[0].slots.seabed.pos.length).toBeGreaterThan(0);
    expect(() => normaliseTerrain({ heights: [[0, 0], [0, 0]], water: ['x'] })).toThrow(/water/);
  });

  it('a grid in chunks: 25×25 tiles in 10×10 chunks; skirts close the edges', () => {
    const N = 25;
    const heights = Array.from({ length: N + 1 }, (_, j) => Array.from({ length: N + 1 }, (_, i) => (i > 5 && i < 12 && j > 5 && j < 12 ? 1 : 0)));
    const m = mesh({ heights, cell: C, height: H, skirt: 5 });
    expect(m.chunks.map((c) => c.name)).toEqual(['terrain_0_0', 'terrain_1_0', 'terrain_2_0', 'terrain_0_1', 'terrain_1_1', 'terrain_2_1', 'terrain_0_2', 'terrain_1_2', 'terrain_2_2']);
    expect(m.chunks[8].tiles).toEqual([20, 20, 25, 25]);
    expect(m.bounds.min[1]).toBe(-5);
    expect(m.chunks.reduce((n, c) => n + c.slots.skirt.pos.length / 9, 0)).toBe(4 * N * 2);
    // The collider is welded on the vertex grid.
    expect(m.collider.pos.length / 3).toBe((N + 1) * (N + 1));
  });

  it('scatter: seeded, per tile, off water, steep ground and cleared tiles', () => {
    // 4×4 tiles: water in the corner, a hill (steep: 23.7°) on the far side, one tile cleared for the track.
    const heights = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 1, 1], [0, 0, 0, 1, 1]];
    const t: TerrainSpec = { heights, water: ['w...', '....', '....', '....'], cell: C, height: H, scatter: [{ asset: 'Rock', density: 10, maxSlope: 20 }], clear: [[2, 1]] };
    const a = mesh(t), b = mesh(t);
    expect(a.spots).toEqual(b.spots);
    expect(a.spots.length).toBeGreaterThan(5);
    for (const s of a.spots) {
      const i = Math.floor(s.pos[0] / C + 0.5), j = Math.floor(s.pos[2] / C);
      expect([i, j]).not.toEqual([2, 1]);
      expect([i, j]).not.toEqual([0, 0]); // the water tile
      expect([i, j]).not.toEqual([3, 2]); // a slope tile of the hill (23.7°, steeper than maxSlope)
      expect(s.scale).toBeGreaterThanOrEqual(0.8);
    }
    expect(mesh({ ...t, seed: 2 }).spots).not.toEqual(a.spots);
  });

  it('specs normalise, hash and refuse what does not fit', () => {
    expect(normaliseTerrain({ tile: 'slope', dir: 'N', shape: 'planar', biome: 'meadow' })).toEqual({ tile: 'slope' });
    const s = normaliseSpec({ terrain: { tile: 'slope', cell: C, height: H }, compress: 'meshopt' });
    expect(s).toMatchObject({ name: 'terrain_slope', terrain: { tile: 'slope', cell: C, height: H }, compress: 'meshopt' });
    expect(specHash({ terrain: { tile: 'slope', dir: 'N' } })).toBe(specHash({ terrain: { tile: 'slope' } }));
    expect(normaliseSpec({ terrain: { tile: 'corner-outer', dir: 'SW' } }).name).toBe('terrain_corner_outer_sw');
    expect(() => normaliseTerrain({ tile: 'flat', dir: 'N' })).toThrow(/does not take dir/);
    expect(() => normaliseTerrain({ tile: 'slope', dir: 'NE' })).toThrow(/dir must be one of N, E, S, W/);
    expect(() => normaliseTerrain({ tile: 'flat', heights: [[0, 0], [0, 0]] })).toThrow(/not both/);
    expect(() => normaliseTerrain({ heights: [[0, 0], [0]] })).toThrow(/same number/);
    expect(() => normaliseSpec({ terrain: { tile: 'flat' }, tint: '#ff0000' })).toThrow(/terrain is built/);
    expect(() => normaliseSpec({ terrain: { tile: 'flat' }, trackpiece: { preset: 'straight' } })).toThrow(/not trackpiece and terrain/);
  });
});

describe('skydomes (CS-FB-004)', () => {
  it('normalises presets and rings', () => {
    expect(normaliseSkydome({ preset: 'desert', ring: true })).toEqual({ preset: 'desert' });
    expect(normaliseSkydome({ ring: false })).toEqual({ ring: false });
    expect(() => normaliseSkydome({ preset: 'moon' })).toThrow(/preset must be one of/);
    expect(() => normaliseSkydome({ colors: { zenith: 'blue' } })).toThrow(/#rrggbb/);
    expect(normaliseSpec({ skydome: { preset: 'alpine', radius: 1500 } })).toMatchObject({ name: 'skydome_alpine', skydome: { preset: 'alpine', radius: 1500 } });
    expect(() => normaliseSpec({ skydome: {}, collider: 'trimesh' })).toThrow(/no collider/);
  });

  it('the dome faces in, its colour runs from the zenith to the horizon', () => {
    const ex = expandSkydome({ preset: 'desert', radius: 500 });
    const m = buildSkyMesh(ex);
    for (let i = 0; i < m.idx.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => m.pos.slice(m.idx[i + k] * 3, m.idx[i + k] * 3 + 3));
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const mid = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
      if (Math.hypot(...n) < 1e-6) continue;
      expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]).toBeLessThan(0);
    }
    const top = m.pos.findIndex((_, i) => i % 3 === 1 && m.pos[i] > 499.99);
    expect(m.col.slice(top - 1, top + 2).map((v) => Math.round(v * 255))).toEqual([0x3f, 0x7f, 0xcf]);
  });

  it('the ring goes all the way round without gaps', () => {
    const ex = expandSkydome({ preset: 'alpine', radius: 1000 });
    const props = [{ width: 400, depth: 100, height: 60 }, { width: 250, depth: 80, height: 50 }];
    const pl = placeRing(ex, props);
    for (const layer of [0, 1]) {
      // Each prop's angular half-width: neighbours overlap (centres closer than their half-widths summed).
      const on = pl.filter((p) => p.layer === layer).map((p) => ({ az: Math.atan2(p.pos[0], p.pos[2]), half: (props[p.prop].width * p.scale) / 2 / Math.hypot(p.pos[0], p.pos[2]) })).sort((a, b) => a.az - b.az);
      on.forEach((p, i) => {
        const q = on[(i + 1) % on.length];
        const gap = (q.az - p.az + 2 * Math.PI) % (2 * Math.PI);
        expect(gap).toBeLessThan(p.half + q.half);
      });
      // Its tallest silhouette stays near the elevation asked for.
      const p = pl.find((q) => q.layer === layer)!;
      expect(Math.atan2(60 * p.scale, Math.hypot(p.pos[0], p.pos[2])) * (180 / Math.PI)).toBeLessThan(ex.ring!.elevation + 0.01);
    }
  });
});
