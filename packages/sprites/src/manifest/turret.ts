// Moved from synty-sprite-generator packages/shared/src/object/turret.ts (P2, ali3b/sloponator#8).
/**
 * FB-096: layered vehicle parts. A tank renders as two sheets from one model, split by part role: the hull (the
 * model without its turret) and the turret (the `turret`-role parts with everything under them, e.g. barrel and
 * hatch, or lone `barrel` parts), each with its own directions. The hull's data file carries a `turret` block with,
 * per hull direction, where the turret's pivot (the point it turns about, at its base) sits relative to the hull's
 * frame pivot, so a game draws the turret at hull position + offset[hull direction] in whatever direction it aims.
 */
import { DIRECTION_SETS, type Direction, type DirectionSetId, type Framing } from '../view/camera.js';
import type { AnimationSet, SetItem, TemplateLayerRef } from '../inputs/batch.js';
import { toFramePx } from '../object/footprint.js';

/** The turret split of a vehicle export: `dirs` = the turret sheet's own directions (default: the hull's). */
export interface TurretSplit {
  dirs?: DirectionSetId;
}

/** Part roles whose nodes (with their children) make the turret sheet. */
export const TURRET_ROLES = ['turret', 'barrel'] as const;

/** Templates that move the turret sheet's parts (the rest only move the hull, or the turret as a whole). */
export const TURRET_TEMPLATES: ReadonlySet<string> = new Set(['fire', 'still']);
/** Templates left out of the hull sheet: the game turns the turret itself. */
export const HULL_SKIP_TEMPLATES: ReadonlySet<string> = new Set(['turret_sweep']);

/** The turret sheet's clips are named turret, turret_fire… so their keys never meet the hull's. */
export const TURRET_CLIP_PREFIX = 'turret';

/**
 * A `turret` value from a spec (sprite file, export flags, MCP): true / "on" = the turret sheet with the hull's
 * directions; a direction set ("16", 32) = its own directions; { dirs }; false / null / "off" / "none" = no split.
 */
export function parseTurret(v: unknown, where = 'turret'): TurretSplit | null {
  if (v === undefined || v === null || v === false) return null;
  if (v === true) return {};
  const ids = DIRECTION_SETS.map((d) => d.id) as string[];
  const dirs = (d: unknown): TurretSplit => {
    const s = String(d).trim();
    if (!ids.includes(s)) throw new Error(`${where}: turret directions must be one of ${ids.join(', ')} (got ${JSON.stringify(d)}).`);
    return { dirs: s as DirectionSetId };
  };
  if (typeof v === 'number') return dirs(v);
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['off', 'none', 'false', 'no', ''].includes(s)) return null;
    if (['on', 'true', 'yes', 'auto'].includes(s)) return {};
    return dirs(s);
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const unknown = Object.keys(o).filter((k) => k !== 'dirs' && k !== 'directions');
    if (unknown.length) throw new Error(`${where}: unknown key ${unknown.join(', ')} (turret takes { "dirs": "16" }).`);
    const d = o.dirs ?? o.directions;
    return d === undefined || d === null ? {} : dirs(d);
  }
  throw new Error(`${where}: turret must be true, a direction count ("8", "16", "32") or { "dirs": "16" } (got ${JSON.stringify(v)}).`);
}

/** Short text for a turret split ("turret", "turret 16 dirs"), or null. */
export function turretLabel(t: TurretSplit | null | undefined) {
  return t ? `turret${t.dirs ? ` ${t.dirs} dirs` : ''}` : null;
}

const layersOf = (it: SetItem): TemplateLayerRef[] | null => (it.type === 'template' ? it.layers : null);

/** The hull's moves: the set without the turret's own sweep (a move that only swept the turret is dropped; none left: a still). */
export function hullSet(set: AnimationSet): AnimationSet {
  const items = set.items.flatMap((it): SetItem[] => {
    if (it.type !== 'template') return [it];
    const kept = it.layers.filter((l) => !HULL_SKIP_TEMPLATES.has(l.id));
    return kept.length ? [{ ...it, layers: kept }] : [];
  });
  // Nothing left (the set only swept the turret): the hull stands still.
  return { ...set, items: items.length ? items : [{ type: 'template', layers: [{ id: 'still', params: {} }], label: 'still' }] };
}

/**
 * The turret's moves: a still (`turret`) plus each move of the set that animates the turret's parts (`fire` →
 * `turret_fire`), with only those layers. Driving, steering and the hull's other moves are the hull's.
 */
export function turretSet(set: AnimationSet): AnimationSet {
  const items: SetItem[] = [{ type: 'template', layers: [{ id: 'still', params: {} }], label: TURRET_CLIP_PREFIX }];
  const seen = new Set([TURRET_CLIP_PREFIX]);
  for (const it of set.items) {
    const layers = layersOf(it)?.filter((l) => TURRET_TEMPLATES.has(l.id) && l.id !== 'still');
    if (!layers?.length) continue;
    const label = `${TURRET_CLIP_PREFIX}_${layers.map((l) => l.id).join('_')}`;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({ type: 'template', layers, label, ...(it.type === 'template' && it.window ? { window: it.window } : {}) });
  }
  return { ...set, id: `${set.id}_turret`, name: `${set.name} (turret)`, items };
}

/** Where the turret goes on the hull in one hull direction (pixels, untrimmed hull frame). */
export interface TurretMount {
  name: string;
  worldAngle: number;
  mirrorOf: string | null;
  /** The turret's pivot (its axis at its base) in the hull's frame, from the top-left. */
  pivot: { x: number; y: number };
  /** The same point relative to the hull frame's pivot for this direction: draw the turret's pivot here. */
  offset: { x: number; y: number };
}

const r2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * The turret's mount point in every hull direction: the turret axis (model axes, metres; y = the turret's base)
 * projected into the hull's frames (ortho), and its offset from each direction's frame pivot (the object anchor, or
 * the model origin). A mirrored direction is its source drawn flipped: x' = frameWidth - x.
 */
export function turretMounts(o: {
  axis: { x: number; y: number; z: number };
  pitch: number;
  framing: Framing;
  directions: Direction[];
  /** The hull frame's pivot in a direction, as drawn (mirrored directions already flipped). */
  pivotOf: (direction: string) => { x: number; y: number };
}): TurretMount[] {
  const fw = o.framing.frameWidth;
  const at = (d: Direction): { x: number; y: number } => {
    if (d.mirrorOf !== null) {
      const src = o.directions[d.mirrorOf];
      const p = at(src);
      return { x: fw - p.x, y: p.y };
    }
    const [x, y] = toFramePx([o.axis.x, o.axis.z], o.axis.y, d.worldAngle, o.pitch, o.framing);
    return { x, y };
  };
  return o.directions.map((d) => {
    const p = at(d);
    const piv = o.pivotOf(d.name);
    return {
      name: d.name, worldAngle: d.worldAngle, mirrorOf: d.mirrorOf === null ? null : o.directions[d.mirrorOf].name,
      pivot: { x: r2(p.x), y: r2(p.y) }, offset: { x: r2(p.x - piv.x), y: r2(p.y - piv.y) },
    };
  });
}

export const TURRET_NOTE =
  'Draw the hull sheet, then the turret sheet on top: the turret frame\'s pivot goes at the hull\'s pivot + mounts[hull direction].offset (pixels), in any of the turret sheet\'s directions. axis is where the turret turns, in metres in the model\'s axes (y = the turret\'s base).';

/** The `turret` block in the hull's data files (meta.json, the generic json and .sheet.json). */
export interface TurretBlock {
  schema: 'ssg-turret/1';
  /** The turret sheet's base name (its files are `{base}_0.png`, `{base}.json`/`.meta.json`…). */
  base: string;
  files: string[];
  /** Model parts drawn on the turret sheet (left out of the hull's). */
  parts: string[];
  axis: { x: number; y: number; z: number };
  pixelsPerMetre: number | null;
  /** The turret sheet's directions (the game picks one by aim, independently of the hull's). */
  directions: { name: string; worldAngle: number; screenAngle: number; mirrorOf: string | null }[];
  /** The turret sheet's clips: `turret` (still), `turret_fire`… */
  clips: string[];
  /** Per hull direction: where the turret's pivot goes. */
  mounts: TurretMount[];
  /** The turret is always drawn over the hull. */
  draw: 'above';
  note: string;
}

export function turretBlock(o: Omit<TurretBlock, 'schema' | 'draw' | 'note' | 'directions'> & { directions: Direction[] }): TurretBlock {
  return {
    schema: 'ssg-turret/1', base: o.base, files: o.files, parts: o.parts,
    axis: { x: r3(o.axis.x), y: r3(o.axis.y), z: r3(o.axis.z) }, pixelsPerMetre: o.pixelsPerMetre === null ? null : Math.round(o.pixelsPerMetre * 1e4) / 1e4,
    directions: o.directions.map((d) => ({ name: d.name, worldAngle: d.worldAngle, screenAngle: d.screenAngle, mirrorOf: d.mirrorOf === null ? null : o.directions[d.mirrorOf].name })),
    clips: o.clips, mounts: o.mounts, draw: 'above', note: TURRET_NOTE,
  };
}

const r3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};
