// Moved from the old generator's packages/shared/src/map/plan.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import type { Terrain } from '../tileset/types.js';
import { BIOMES, pickTerrain, type Biome, type GenObject, type PathObject, type Region, type TerrainWish } from './generate.js';
import { rng, mapSeed, seedStep } from './noise.js';
import type { MapOp } from './ops.js';

/**
 * A whole map from a biome, a seed and a list of features, as plain ops (so it is one save and one undo, and the
 * same request gives the same map). Order: terrain, rivers, roads/tracks, trenches, stamps, then scatters, which keep
 * off the paths' terrains and away from the stamps.
 */

export type PathFeatureType = 'road' | 'river' | 'trench' | 'track';

export interface PathFeature {
  type: PathFeatureType;
  terrain?: TerrainWish;
  /** Metres (defaults: road 3, river 4, trench 1.5, track 1.5). */
  width?: number;
  /** Control points in cells; default: a seeded route from one edge to the opposite one. */
  points?: [number, number][];
  /** "x" runs along the map's columns (west → east in the overview), "y" down its rows. Default: alternates. */
  axis?: 'x' | 'y';
  jitter?: number;
  /** Objects along it (wire along a trench…). */
  objects?: PathObject[];
  edge?: TerrainWish;
  collision?: boolean;
}

export interface ScatterFeature extends Omit<GenObject, 'weight'> {
  type: 'scatter';
  objects?: GenObject[];
  density?: number;
  count?: number;
  spacing?: number;
  spacingOther?: number;
  retries?: number;
  relax?: boolean | number;
  terrains?: string[];
  avoidTerrains?: string[];
  cluster?: number;
  region?: Region;
}

export interface StampFeature {
  type: 'stamp';
  stamp: string;
  /** Top-left cell; default: a seeded spot off the paths. */
  x?: number;
  y?: number;
  rotate?: 0 | 90 | 180 | 270;
  /** The stamp's size, so a free spot can be found (the CLI/MCP fill it in from the saved stamp). */
  width?: number;
  height?: number;
}

export type MapFeature = PathFeature | ScatterFeature | StampFeature;

export interface PlanInput {
  width: number;
  height: number;
  metresPerTile?: number;
  seed?: number | string;
  biome?: string | Biome;
  /** Feature size of the terrain noise in metres. */
  scale?: number;
  features?: (MapFeature | PathFeatureType)[];
  /** The ground tileset's terrains, to pick each feature's terrain (by id, name or kind). */
  terrains?: Pick<Terrain, 'id' | 'name' | 'kind'>[] | null;
}

export interface Plan {
  ops: MapOp[];
  /** What was decided (routes, spots) and what was skipped and why. */
  notes: string[];
}

const PATH_DEFAULTS: Record<PathFeatureType, { terrain: string[]; width: number; jitter: number; collision?: boolean }> = {
  road: { terrain: ['road', 'dirt'], width: 3, jitter: 1 },
  river: { terrain: ['water'], width: 4, jitter: 2.5 },
  trench: { terrain: ['mud', 'dirt'], width: 1.5, jitter: 0.5 },
  track: { terrain: ['dirt', 'mud', 'sand'], width: 1.5, jitter: 1.5 },
};
const ORDER: Record<string, number> = { river: 0, road: 1, track: 2, trench: 3, stamp: 4, scatter: 5 };

const segDist = (px: number, py: number, a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
};

export function planGeneration(input: PlanInput): Plan {
  const { width: W, height: H } = input;
  const mpt = input.metresPerTile ?? 1;
  // The ops carry the seed as given (text stays text: "mission2", "mission2+31"), so a dry run's ops read as written
  // and replay to the same map; the numbers they stand for are the same either way (mapSeed).
  const given = input.seed ?? 0;
  const seed = mapSeed(given);
  const rand = rng(seed ^ 0x51a7);
  const ops: MapOp[] = [];
  const notes: string[] = [];
  const biome = input.biome ?? 'temperate';
  if (typeof biome === 'string' && !BIOMES[biome.toLowerCase()]) throw new Error(`no biome "${biome}" (biomes: ${Object.keys(BIOMES).join(', ')})`);
  ops.push({ op: 'generate', biome, seed: typeof given === 'number' ? seed : given, ...(input.scale !== undefined ? { scale: input.scale } : {}) });
  const features = (input.features ?? []).map((f): MapFeature => (typeof f === 'string' ? ({ type: f } as PathFeature) : f));
  for (const f of features) if (!f || !(f.type in ORDER)) throw new Error(`unknown feature "${(f as { type?: unknown })?.type}" (features: road, river, track, trench, scatter, stamp)`);
  const sorted = features.map((f, i) => ({ f, i })).sort((a, b) => ORDER[a.f.type] - ORDER[b.f.type] || a.i - b.i).map((x) => x.f);
  const lines: { pts: [number, number][]; half: number }[] = [];
  const pathTerrains = new Set<string>();
  const stampsAt: [number, number, number, number][] = [];
  let lastAxis: 'x' | 'y' | null = null;
  for (const f of sorted) {
    if (f.type === 'scatter') {
      const avoid = f.avoidTerrains ?? [...pathTerrains];
      const objects = f.objects ?? (f.spriteId !== undefined || f.assetRef ? [{ spriteId: f.spriteId, assetRef: f.assetRef, name: f.name, states: f.states, facings: f.facings, footprint: f.footprint, properties: f.properties }] : []);
      if (!objects.length) throw new Error('a scatter feature needs objects or a spriteId / assetRef');
      ops.push({
        op: 'scatter', seed: seedStep(given, 101 + ops.length), objects: objects.map((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as GenObject),
        ...(f.density !== undefined ? { density: f.density } : {}), ...(f.count !== undefined ? { count: f.count } : {}),
        spacing: f.spacing ?? 2, ...(f.spacingOther !== undefined ? { spacingOther: f.spacingOther } : {}),
        ...(f.retries !== undefined ? { retries: f.retries } : {}), ...(f.relax !== undefined ? { relax: f.relax } : {}), ...(f.terrains ? { terrains: f.terrains } : {}), ...(avoid.length ? { avoidTerrains: avoid } : {}),
        ...(f.cluster !== undefined ? { cluster: f.cluster } : {}), ...(f.region ? { region: f.region } : {}),
      });
      continue;
    }
    if (f.type === 'stamp') {
      const w = f.width ?? 4, h = f.height ?? 4;
      const turned = f.rotate === 90 || f.rotate === 270;
      const sw = turned ? h : w, sh = turned ? w : h;
      let x = f.x, y = f.y;
      if (x === undefined || y === undefined) {
        // A seeded spot in the middle of the map, clear of the paths and earlier stamps.
        let best: [number, number] | null = null, bestScore = -Infinity;
        for (let k = 0; k < 64; k++) {
          const cx = Math.floor(W * 0.15 + rand() * Math.max(1, W * 0.7 - sw)), cy = Math.floor(H * 0.15 + rand() * Math.max(1, H * 0.7 - sh));
          if (cx < 0 || cy < 0 || cx + sw > W || cy + sh > H) continue;
          const mx = cx + sw / 2, my = cy + sh / 2;
          let clear = Infinity;
          for (const l of lines) for (let i = 1; i < l.pts.length; i++) clear = Math.min(clear, segDist(mx, my, l.pts[i - 1], l.pts[i]) - l.half - Math.max(sw, sh) / 2);
          for (const [ax, ay, bx, by] of stampsAt) clear = Math.min(clear, Math.max(ax - (cx + sw), cx - bx, ay - (cy + sh), cy - by));
          const score = Math.min(clear, 6) - k * 1e-3;
          if (score > bestScore) (bestScore = score), (best = [cx, cy]);
          if (clear >= 6) break;
        }
        if (!best) {
          notes.push(`stamp ${f.stamp}: no room for ${sw}×${sh} cells`);
          continue;
        }
        [x, y] = best;
        notes.push(`stamp ${f.stamp} at ${x},${y}${f.rotate ? ` turned ${f.rotate}°` : ''}`);
      }
      stampsAt.push([x, y, x + sw, y + sh]);
      ops.push({ op: 'stamp', stamp: f.stamp, x, y, ...(f.rotate ? { rotate: f.rotate } : {}) });
      continue;
    }
    const d = PATH_DEFAULTS[f.type];
    const terrain = pickTerrain(f.terrain ?? d.terrain, input.terrains);
    if (terrain === null && !f.objects?.length) {
      notes.push(`${f.type}: the tileset has no ${[f.terrain ?? d.terrain].flat().join('/')} terrain; skipped`);
      continue;
    }
    if (terrain) pathTerrains.add(terrain);
    let pts = f.points;
    if (!pts) {
      // A river runs down the rows, the rest across; each later path crosses the one before it.
      const axis: 'x' | 'y' = f.axis ?? (lastAxis ? (lastAxis === 'x' ? 'y' : 'x') : f.type === 'river' ? 'y' : 'x');
      lastAxis = axis;
      const along = axis === 'x' ? W : H, across = axis === 'x' ? H : W;
      const n = 4;
      const c0 = across * (0.25 + rand() * 0.5);
      pts = [];
      let c = c0;
      for (let k = 0; k <= n; k++) {
        if (k > 0) c = Math.max(across * 0.12, Math.min(across * 0.88, c + (rand() - 0.5) * across * 0.35));
        const a = k === 0 ? -1 : k === n ? along + 1 : (along * k) / n;
        pts.push(axis === 'x' ? [a, c] : [c, a]);
      }
      pts = pts.map(([px, py]) => [Math.round(px * 2) / 2, Math.round(py * 2) / 2]);
      notes.push(`${f.type} along ${axis}: ${pts.map((p) => p.join(',')).join(' → ')}`);
    }
    const widthM = f.width ?? d.width;
    lines.push({ pts, half: widthM / mpt / 2 + 1 });
    ops.push({
      op: 'path', points: pts, seed: seedStep(given, 31 + ops.length), width: widthM, jitter: f.jitter ?? d.jitter,
      ...(terrain ? { terrain } : {}),
      ...(f.edge ? { edge: pickTerrain(f.edge, input.terrains) ?? [f.edge].flat()[0] } : {}),
      ...((f.collision ?? d.collision) ? { collision: true } : {}),
      ...(f.objects?.length ? { objects: f.objects } : {}),
    });
  }
  // The paths are clipped to the map by the rasteriser; points just outside it make them run off the edge.
  return { ops, notes };
}
