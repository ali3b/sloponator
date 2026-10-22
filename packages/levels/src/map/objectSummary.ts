// Moved from the old generator's packages/shared/src/map/objectSummary.ts (ali3b/sloponator#17, #18).
import { footprintFor, footprintFromObject, type ObjectBlockLike } from './ops.js';

/**
 * A compact account of an object sprite's export (its `object` block) for map authors (FB-045): which facings it was
 * rendered in, how many cells each facing covers along the map's x (u) and y (v) and how many metres that is, its
 * states, anchor and height. Small enough to list every sprite of a project in one answer.
 */
export interface ObjectSummary {
  /** Facings the export has (mirrored ones included). */
  facings: string[];
  /**
   * Per facing: the metres it spans along the grid's u (map x) and v (map y), and, when the export is tile-locked,
   * the whole tiles (u, v) at its metres per tile.
   */
  perFacing?: Record<string, { u?: number; v?: number; metres: [number, number] }>;
  /** The model's footprint in metres (model axes: w across its front, d along it). */
  metres: { w: number; d: number };
  /** Whole tiles of the footprint (model axes) when the export is tile-locked, with its metres per tile. */
  tiles?: { w: number; d: number; metresPerTile: number };
  /** Top above the ground, metres. */
  height: number;
  /** Pixel of the footprint's ground centre in the (untrimmed) frame of the first facing. */
  anchor: { x: number; y: number } | null;
  /** State names (the first is the default), when it has states. */
  states?: string[];
  /** On a given map (its metres per tile): the cells `place` covers per facing, [w along x, h along y]. */
  cells?: Record<string, [number, number]>;
}

/** The export's object block as this needs it (object/footprint.ts ObjectInfo). */
export interface ObjectBlockFull extends ObjectBlockLike {
  footprint?: { w: number; d: number };
  height?: number;
  anchor?: { x: number; y: number } | null;
  directions?: { name: string; tiles?: { u: number; v: number; uExact?: number; vExact?: number }; facing?: '+u' | '+v' | '-u' | '-v' | null }[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The summary of an export's object block; `metresPerTile` (a map's) adds the cells `place` uses per facing. */
export function objectSummary(o: ObjectBlockFull, metresPerTile?: number): ObjectSummary {
  const dirs = Array.isArray(o.directions) ? o.directions : [];
  const fp = o.footprint ?? { w: 0, d: 0 };
  const perFacing: NonNullable<ObjectSummary['perFacing']> = {};
  for (const d of dirs) {
    if (d.tiles && o.tiles) {
      const mpt = o.tiles.metresPerTile;
      perFacing[d.name] = { u: d.tiles.u, v: d.tiles.v, metres: [r2((d.tiles.uExact ?? d.tiles.u) * mpt), r2((d.tiles.vExact ?? d.tiles.v) * mpt)] };
    } else if (d.facing) {
      // Not tile-locked: the front (+Z, the footprint's d) runs along the axis the facing names.
      const [um, vm] = d.facing.endsWith('u') ? [fp.d, fp.w] : [fp.w, fp.d];
      perFacing[d.name] = { metres: [r2(um), r2(vm)] };
    }
  }
  const states = (o.states ?? []).map((s) => s.name);
  let cells: ObjectSummary['cells'];
  if (metresPerTile && metresPerTile > 0) {
    const f = footprintFromObject(o, metresPerTile);
    if (f) {
      cells = {};
      for (const name of dirs.length ? dirs.map((d) => d.name) : ['']) {
        const c = footprintFor(f, name || undefined)!;
        cells[name || 'any'] = [c.w, c.h];
      }
    }
  }
  return {
    facings: dirs.map((d) => d.name),
    ...(Object.keys(perFacing).length ? { perFacing } : {}),
    metres: { w: r2(fp.w), d: r2(fp.d) },
    ...(o.tiles ? { tiles: { w: o.tiles.w, d: o.tiles.d, metresPerTile: o.tiles.metresPerTile } } : {}),
    height: r2(o.height ?? 0),
    anchor: o.anchor ? { x: r2(o.anchor.x), y: r2(o.anchor.y) } : null,
    ...(states.length ? { states } : {}),
    ...(cells ? { cells } : {}),
  };
}

/**
 * The summary in a few strings, for listing many sprites (MCP map_sprites, list_sprites): per facing "u×v cells"
 * (on the map when it has `cells`, else the export's tiles; u = map x, v = map y) and "a×b m"; height in metres;
 * states; the anchor pixel.
 */
export function compactObjectSummary(s: ObjectSummary): { facings: Record<string, string>; height: number; states?: string[]; anchor?: [number, number] } {
  const line = (c: [number, number] | null | undefined, m: [number, number] | null | undefined) =>
    [c ? `${c[0]}×${c[1]} cells` : '', m ? `${m[0]}×${m[1]} m` : ''].filter(Boolean).join(', ');
  const facings: Record<string, string> = {};
  for (const f of s.facings) {
    const p = s.perFacing?.[f];
    facings[f] = line(s.cells?.[f] ?? (p?.u !== undefined && p.v !== undefined ? [p.u, p.v] : null), p?.metres) || `${s.metres.w}×${s.metres.d} m (model axes)`;
  }
  if (!s.facings.length) facings.any = line(s.cells?.any ?? (s.tiles ? [s.tiles.w, s.tiles.d] : null), [s.metres.w, s.metres.d]);
  return { facings, height: s.height, ...(s.states ? { states: s.states } : {}), ...(s.anchor ? { anchor: [s.anchor.x, s.anchor.y] } : {}) };
}
