// Moved from the old generator's packages/shared/src/map/stamp.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { cellTerrain } from './resolve.js';
import type { CellFootprint, MapBody, MapObject, Properties, Zone } from './types.js';

/**
 * Stamps: a rectangle of a map (ground corners, decoration, collision, objects and zones) saved under a name and
 * placed again elsewhere, turned in quarter turns. A bunker with its sandbags and wire, a checkpoint, a village.
 *
 * Positions inside a stamp are relative to its top-left cell corner, in cells. A stamp of w × h cells has
 * (w + 1) × (h + 1) ground corners ('' = leave the map's corner as it is), w × h decoration gids (0 = leave),
 * and w × h collision flags (1 = block, 0 = leave).
 */

export const STAMP_LAYERS = ['ground', 'decoration', 'collision', 'objects', 'zones'] as const;
export type StampLayer = (typeof STAMP_LAYERS)[number];

export type StampObject = Omit<MapObject, 'id'>;
export type StampZone = Omit<Zone, 'id'>;

export interface MapStamp {
  name: string;
  width: number;
  height: number;
  /** The scale it was cut at (placing on a map at another scale is refused). */
  metresPerTile: number;
  /** Tileset ids, by the slots its decoration gids use (gids are remapped to the target map's slots). */
  tilesets: number[];
  ground: string[] | null;
  /**
   * Which ground corners the stamp really paints (1) as opposed to the base it was cut from (0), same layout as
   * `ground`. Recorded when a stamp is saved; older stamps get one derived from their border (`stampGroundMask`).
   */
  groundMask?: (0 | 1)[] | null;
  /** The terrain the mask was taken against (the commonest corner on the stamp's border). */
  groundBase?: string;
  decoration: number[] | null;
  collision: (0 | 1)[] | null;
  objects: StampObject[];
  zones: StampZone[];
  properties?: Properties;
}

/** What a stamp holds, for listings. */
export function describeStamp(s: MapStamp) {
  const terrains = new Map<string, number>();
  if (s.ground)
    for (let y = 0; y < s.height; y++)
      for (let x = 0; x < s.width; x++) {
        const t = cellTerrain(s, { corners: s.ground }, x, y);
        if (t) terrains.set(t, (terrains.get(t) ?? 0) + 1);
      }
  return {
    name: s.name,
    size: `${s.width}x${s.height}`,
    metresPerTile: s.metresPerTile,
    terrainCells: Object.fromEntries(terrains),
    decoration: s.decoration?.filter(Boolean).length ?? 0,
    blocked: s.collision?.filter(Boolean).length ?? 0,
    objects: s.objects.map((o) => o.name ?? o.assetRef ?? `sprite ${o.spriteId}`),
    zones: s.zones.map((z) => `${z.kind} "${z.name}"`),
  };
}

/**
 * Cut a stamp out of a map: cells x0..x1, y0..y1 (inclusive) of its first ground, decoration, collision, objects and
 * zones layers (or only `layers`). Objects whose anchor lies inside the rectangle and zones whose points all do are
 * taken, with positions relative to the rectangle's top-left corner.
 */
export function extractStamp(doc: MapBody, rect: [number, number, number, number], o: { name: string; layers?: StampLayer[] }): MapStamp {
  const [x0, x1] = [Math.floor(rect[0]), Math.floor(rect[2])].sort((a, b) => a - b);
  const [y0, y1] = [Math.floor(rect[1]), Math.floor(rect[3])].sort((a, b) => a - b);
  const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(doc.width - 1, x1), cy1 = Math.min(doc.height - 1, y1);
  if (cx0 > cx1 || cy0 > cy1) throw new Error(`the rectangle ${rect.join(',')} is outside the ${doc.width}×${doc.height} map`);
  const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1;
  const want = new Set<StampLayer>(o.layers?.length ? o.layers : STAMP_LAYERS);
  const first = <T extends MapBody['layers'][number]['type']>(t: T) => doc.layers.find((l) => l.type === t) as Extract<MapBody['layers'][number], { type: T }> | undefined;
  const g = want.has('ground') ? first('ground') : undefined;
  const d = want.has('decoration') ? first('decoration') : undefined;
  const c = want.has('collision') ? first('collision') : undefined;
  const ol = want.has('objects') ? first('objects') : undefined;
  const zl = want.has('zones') ? first('zones') : undefined;
  const W = doc.width;
  const ground = g ? Array.from({ length: (w + 1) * (h + 1) }, (_, i) => g.corners[(cy0 + Math.floor(i / (w + 1))) * (W + 1) + cx0 + (i % (w + 1))]) : null;
  const cells = <T>(src: T[]) => Array.from({ length: w * h }, (_, i) => src[(cy0 + Math.floor(i / w)) * W + cx0 + (i % w)]);
  const inRect = (x: number, y: number, edge: boolean) => (edge ? x >= cx0 - 1e-6 && x <= cx1 + 1 + 1e-6 && y >= cy0 - 1e-6 && y <= cy1 + 1 + 1e-6 : x >= cx0 && x < cx1 + 1 && y >= cy0 && y < cy1 + 1);
  const taken = (ol?.objects ?? []).filter((ob) => inRect(ob.x, ob.y, false));
  // FB-079: `on` names the support by its index in the stamp ("#2"); one outside the stamp is dropped (the height stays).
  const index = new Map(taken.map((ob, i) => [ob.id, i]));
  const objects: StampObject[] = taken.map(({ id: _id, on, ...rest }) => ({
    ...structuredClone(rest), x: rest.x - cx0, y: rest.y - cy0, ...(on !== undefined && index.has(on) ? { on: `#${index.get(on)}` } : {}),
  }));
  const zones: StampZone[] = (zl?.zones ?? [])
    .filter((z) => z.points.every(([x, y]) => inRect(x, y, true)))
    .map(({ id: _id, ...rest }) => ({ ...structuredClone(rest), points: rest.points.map(([x, y]) => [x - cx0, y - cy0] as [number, number]) }));
  const decoration = d ? cells(d.cells) : null;
  const usedSlots = new Set((decoration ?? []).filter(Boolean).map((gid) => Math.floor((gid - 1) / 65536)));
  const mask = ground ? groundMaskOf(ground, w, h) : null;
  return {
    name: o.name,
    width: w, height: h,
    metresPerTile: doc.metresPerTile,
    tilesets: usedSlots.size ? doc.tilesets.slice() : [],
    ground,
    ...(mask ? { groundMask: mask.mask, ...(mask.base !== null ? { groundBase: mask.base } : {}) } : {}),
    decoration: decoration && decoration.some(Boolean) ? decoration : null,
    collision: c ? cells(c.cells) : null,
    objects, zones,
  };
}

// --------------------------------------------------------------------------------------------- ground mask

/**
 * The corners a stamp's ground really paints: those that differ from its base, the commonest terrain on its border
 * ring (the ground it was cut from). A stamp that is all one terrain paints all of it (its ground is its content).
 * '' corners are never painted.
 */
export function groundMaskOf(ground: string[], w: number, h: number): { mask: (0 | 1)[]; base: string | null } {
  const counts = new Map<string, number>();
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      if (x !== 0 && y !== 0 && x !== w && y !== h) continue;
      const t = ground[y * (w + 1) + x];
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  let base: string | null = null, best = 0;
  for (const [t, n] of counts) if (n > best) (best = n), (base = t);
  const mask = ground.map((t): 0 | 1 => (t && t !== base ? 1 : 0));
  if (!mask.some(Boolean)) return { mask: ground.map((t): 0 | 1 => (t ? 1 : 0)), base: null };
  return { mask, base };
}

/** A stamp's ground mask: the recorded one, or one derived from its border for stamps saved before masks. */
export function stampGroundMask(s: Pick<MapStamp, 'ground' | 'groundMask' | 'width' | 'height'>): (0 | 1)[] | null {
  if (!s.ground) return null;
  if (s.groundMask && s.groundMask.length === s.ground.length) return s.groundMask;
  return groundMaskOf(s.ground, s.width, s.height).mask;
}

// ------------------------------------------------------------------------------------------------- facings

const COMPASS16 = ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'];
const WORDS: Record<string, number> = { right: 0, up_right: 45, up: 90, up_left: 135, left: 180, down_left: 225, down: 270, down_right: 315 };

/** A direction name's angle (degrees counter-clockwise from screen right): compass (N, SE, NNW…), words, or aNNN. */
export function facingAngle(name: string): number | null {
  const c = COMPASS16.indexOf(name.toUpperCase());
  if (c >= 0) return c * 22.5;
  if (name.toLowerCase() in WORDS) return WORDS[name.toLowerCase()];
  const a = /^a(\d{1,3})$/.exec(name);
  return a ? Number(a[1]) % 360 : null;
}

const norm = (a: number) => ((a % 360) + 360) % 360;

/** The name for an angle in the same style as `like` (compass, lower-case compass, words, aNNN); null when none fits. */
function nameLike(like: string, angle: number): string | null {
  const a = norm(Math.round(angle * 1e6) / 1e6);
  if (like.toLowerCase() in WORDS) {
    const w = Object.entries(WORDS).find(([, v]) => v === a);
    if (w) return w[0];
  }
  if (/^a\d{1,3}$/.test(like)) return `a${String(Math.round(a)).padStart(3, '0')}`;
  if (Number.isInteger(a / 22.5)) {
    const c = COMPASS16[a / 22.5];
    return like === like.toLowerCase() ? c.toLowerCase() : c;
  }
  return null;
}

/**
 * A facing turned by quarter turns clockwise (as seen on the map overview and, the iso projection keeping
 * orientation, on screen): N → E → S → W, NE → SE. Names that are not directions stay as they are.
 */
export function rotateFacing(name: string, quarterTurns: number): string {
  const a = facingAngle(name);
  if (a === null) return name;
  return nameLike(name, a - 90 * quarterTurns) ?? name;
}

/**
 * FB-068: a facing mirrored across the line at `axisAngle` (degrees counter-clockwise from screen right): angle a goes
 * to 2·axis − a. Names that are not directions stay as they are.
 */
export function mirrorFacing(name: string, axisAngle: number): string {
  const a = facingAngle(name);
  if (a === null) return name;
  return nameLike(name, 2 * axisAngle - a) ?? name;
}

/** Of `names`, the one whose angle is nearest `angle` (degrees, counter-clockwise from screen right). */
export function nearestFacing(names: string[], angle: number): string | undefined {
  let best: string | undefined, bd = Infinity;
  for (const n of names) {
    const a = facingAngle(n);
    if (a === null) continue;
    const d = Math.abs(((angle - a + 540) % 360) - 180);
    if (d < bd - 1e-9) (bd = d), (best = n);
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ rotation

/**
 * A stamp turned by `quarterTurns` × 90° clockwise. Cell (x, y) of a w × h stamp goes to (h − 1 − y, x), corners and
 * float positions (x, y) to (h − y, x); footprints swap, facings turn with it (a sprite whose export has per-facing
 * footprints gets the right one when it is placed).
 */
export function rotateStamp(s: MapStamp, quarterTurns: number): MapStamp {
  const q = ((Math.round(quarterTurns) % 4) + 4) % 4;
  let cur = s;
  for (let i = 0; i < q; i++) cur = rot90(cur);
  return cur;
}

function rot90(s: MapStamp): MapStamp {
  const w = s.width, h = s.height;
  // New size h × w. New cell (X, Y) came from old (Y, h − 1 − X); new corner (X, Y) from old (Y, h − X).
  const cells = <T>(src: T[] | null) => (src ? Array.from({ length: w * h }, (_, i) => {
    const X = i % h, Y = Math.floor(i / h);
    return src[(h - 1 - X) * w + Y];
  }) : null);
  const corners = <T>(src: T[] | null | undefined) => (src ? Array.from({ length: (w + 1) * (h + 1) }, (_, i) => {
    const X = i % (h + 1), Y = Math.floor(i / (h + 1));
    return src[(h - X) * (w + 1) + Y];
  }) : null);
  const ground = corners(s.ground);
  const pt = ([x, y]: [number, number]): [number, number] => [h - y, x];
  const swap = (f?: CellFootprint) => (f ? { w: f.h, h: f.w } : undefined);
  return {
    ...s,
    width: h, height: w,
    ground,
    ...(s.groundMask ? { groundMask: corners(s.groundMask) } : {}),
    decoration: cells(s.decoration),
    collision: cells(s.collision),
    objects: s.objects.map((o) => {
      const [x, y] = pt([o.x, o.y]);
      const f = swap(o.footprint);
      return { ...o, x, y, ...(f ? { footprint: f } : {}), ...(o.facing !== undefined ? { facing: rotateFacing(o.facing, 1) } : {}) };
    }),
    zones: s.zones.map((z) => {
      const points = z.points.map(pt);
      // A rect is two opposite corners: keep them as min/max after the turn.
      if (z.shape === 'rect' && points.length === 2) {
        const [[ax, ay], [bx, by]] = points;
        return { ...z, points: [[Math.min(ax, bx), Math.min(ay, by)], [Math.max(ax, bx), Math.max(ay, by)]] as [number, number][] };
      }
      return { ...z, points };
    }),
  };
}

/** Problems with a stamp body (empty = valid). */
export function validateStamp(s: MapStamp): string[] {
  const e: string[] = [];
  if (!s || typeof s !== 'object') return ['a stamp must be an object'];
  if (typeof s.name !== 'string' || !s.name.trim()) e.push('a stamp needs a name');
  if (!Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 1 || s.height < 1 || s.width > 256 || s.height > 256) e.push('stamp width and height must be whole cells, 1–256');
  if (e.length) return e;
  if (s.ground && (!Array.isArray(s.ground) || s.ground.length !== (s.width + 1) * (s.height + 1))) e.push(`ground must be ${(s.width + 1) * (s.height + 1)} corners`);
  if (s.groundMask && (!Array.isArray(s.groundMask) || !s.ground || s.groundMask.length !== s.ground.length || s.groundMask.some((v) => v !== 0 && v !== 1)))
    e.push(`groundMask must be ${(s.width + 1) * (s.height + 1)} flags (0 or 1), like ground`);
  if (s.decoration && (!Array.isArray(s.decoration) || s.decoration.length !== s.width * s.height)) e.push(`decoration must be ${s.width * s.height} gids`);
  if (s.collision && (!Array.isArray(s.collision) || s.collision.length !== s.width * s.height)) e.push(`collision must be ${s.width * s.height} flags`);
  if (!Array.isArray(s.objects)) e.push('objects must be a list');
  if (!Array.isArray(s.zones)) e.push('zones must be a list');
  return e;
}
