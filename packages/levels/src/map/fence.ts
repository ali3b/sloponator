// Moved from the old generator's packages/shared/src/map/fence.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { checkProps, checkSprite, fail, footprintFor, layerFor, num, opAddZone, opPlace, OpFail, anchorPoints, ANCHORS, type Anchor, type OpOutcome, type OpsContext } from './ops.js';
import { pathFacing, PATH_FACING_MODES, type PathFacingMode } from './generate.js';
import type { CellFootprint, MapBody, Properties } from './types.js';

/**
 * FB-078: a fence or wall. Panels of one sprite are laid end to end at their real length (the export's footprint in
 * metres along its long side, or `length`) along a polyline, turned to lie along each segment, with gaps for gates.
 * The panels are one group (`group`, the fence id): they may overlap each other (corners, tile-rounded footprints)
 * but nothing else. Each gate is recorded as a two-point polyline zone across the opening.
 */
export interface FenceOp {
  op: 'fence';
  /** The panel: a project sprite (the server resolves `sprite` names) or a free reference with a `length`. */
  spriteId?: number;
  assetRef?: string;
  name?: string;
  state?: string;
  /** Corner points of the line, map coordinates in cells (see anchor; default corner = as given). */
  points: [number, number][];
  anchor?: Anchor;
  /** Join the last point back to the first. */
  closed?: boolean;
  /** Metres one panel covers along the line (default: the long side of its export's footprint in metres). */
  length?: number;
  /** Metres between panels (default 0: end to end). */
  gap?: number;
  /**
   * Openings: `at` metres from the start of the line (the opening's centre) or the point `x, y` nearest the line,
   * `width` metres wide (default one panel). Panels never reach into an opening.
   */
  gates?: ({ at: number; width?: number; name?: string } | { x: number; y: number; width?: number; name?: string })[];
  /** "parallel" (default: the long side along the line), "along", "across", "perpendicular" or a facing name. */
  facing?: string;
  footprint?: CellFootprint;
  /** The fence id, put on every panel as `group` (default f1, f2…). */
  id?: string;
  collision?: boolean;
  clear?: boolean;
  allowOverlap?: boolean;
  /** Record each gate as a polyline zone (default true). */
  gateZones?: boolean;
  properties?: Properties;
  layer?: string;
}

type Pt = [number, number];

/** The next free fence id: f + one more than the highest f<n> used as a group. */
function nextFenceId(doc: MapBody): string {
  let max = 0;
  for (const l of doc.layers) if (l.type === 'objects') for (const o of l.objects) {
    const m = /^f(\d+)$/.exec(o.group ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `f${max + 1}`;
}

/** Where along a polyline (cells of arc length) a point is nearest. */
function project(line: Pt[], cum: number[], x: number, y: number): number {
  let best = Infinity, at = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    const d = Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
    if (d < best) (best = d), (at = cum[i - 1] + t * Math.sqrt(l2));
  }
  return at;
}

export function opFence(doc: MapBody, op: FenceOp, ctx: OpsContext): OpOutcome {
  if (!Array.isArray(op.points) || op.points.length < 2 || op.points.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== 'number' || !Number.isFinite(n))))
    fail('a fence needs at least 2 points [x, y]');
  if (op.anchor !== undefined && !(ANCHORS as readonly unknown[]).includes(op.anchor)) fail(`anchor must be one of ${ANCHORS.join(', ')}`);
  if (op.spriteId === undefined && !op.assetRef) fail('fence needs a panel: sprite (name or id), spriteId or assetRef');
  if (op.spriteId !== undefined && !Number.isInteger(op.spriteId)) fail('spriteId must be a whole number');
  layerFor(doc, 'objects', op.layer);
  const mpt = doc.metresPerTile;
  const known = op.spriteId !== undefined ? checkSprite(ctx, op.spriteId, op.state) : undefined;
  let lengthM: number;
  if (op.length !== undefined) lengthM = num(op.length, 'length');
  else if (known?.metres) lengthM = Math.max(known.metres.w, known.metres.d);
  else return fail(`the panel's length is not known (${op.spriteId !== undefined ? `sprite ${op.spriteId} has no export with an object block` : 'a free reference'}); give length in metres`);
  if (!(lengthM > 0)) fail('length must be a positive number of metres');
  const gapM = op.gap !== undefined ? num(op.gap, 'gap') : 0;
  if (gapM < 0) fail('gap must be ≥ 0 metres');
  const L = lengthM / mpt, step = (lengthM + gapM) / mpt;
  const id = op.id ?? nextFenceId(doc);
  if (typeof id !== 'string' || !id) fail('id must be a string');
  const props = checkProps(op.properties, 'properties');

  const line: Pt[] = anchorPoints(op.points.map((p) => [p[0], p[1]] as Pt), op.anchor);
  if (op.closed) line.push([line[0][0], line[0][1]]);
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) fail('the fence has no length');

  // Openings along the line, in cells of arc length.
  if (!Array.isArray(op.gates ?? [])) fail('gates must be a list');
  const gates = (op.gates ?? []).map((g, i) => {
    if (!g || typeof g !== 'object') fail(`gates[${i}] must be { at, width } or { x, y, width }`);
    const w = ('width' in g && g.width !== undefined ? num(g.width, `gates[${i}].width`) : lengthM) / mpt;
    if (!(w > 0)) fail(`gates[${i}].width must be a positive number of metres`);
    const at = 'at' in g ? num(g.at, `gates[${i}].at`) / mpt : project(line, cum, num((g as { x: number }).x, `gates[${i}].x`), num((g as { y: number }).y, `gates[${i}].y`));
    return { from: Math.max(0, at - w / 2), to: Math.min(total, at + w / 2), name: (g as { name?: string }).name };
  }).sort((a, b) => a.from - b.from);

  // Stretches: each segment less the gates; panels are laid per stretch, centred in it.
  const stretches: { seg: number; from: number; to: number }[] = [];
  for (let i = 1; i < line.length; i++) {
    let from = cum[i - 1];
    const end = cum[i];
    for (const g of gates) {
      if (g.to <= from || g.from >= end) continue;
      if (g.from > from) stretches.push({ seg: i, from, to: g.from });
      from = Math.max(from, g.to);
    }
    if (end > from + 1e-9) stretches.push({ seg: i, from, to: end });
  }

  const created: string[] = [];
  const cleared: string[] = [];
  const skipped: { at: [number, number]; reason: string }[] = [];
  const perStretch: { segment: number; lengthM: number; panels: number; slackM: number }[] = [];
  const names = known?.directions && Object.keys(known.directions).length ? Object.keys(known.directions) : ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  const mode = op.facing ?? 'parallel';
  for (const st of stretches) {
    const len = st.to - st.from;
    // As many whole panels as fit best, centred: the slack (uncovered ends, or overhang when negative, at most half a
    // panel) is split between both ends. A stretch next to a gate never overhangs into it.
    const byGate = gates.some((g) => Math.abs(g.from - st.to) < 1e-9 || Math.abs(g.to - st.from) < 1e-9);
    const n = Math.max(0, Math.floor((len + step - L) / step + (byGate ? 1e-9 : 0.5)));
    const used = n > 0 ? n * L + (n - 1) * (step - L) : 0;
    perStretch.push({ segment: st.seg, lengthM: Math.round(len * mpt * 100) / 100, panels: n, slackM: Math.round((len - used) * mpt * 100) / 100 });
    const a = line[st.seg - 1], b = line[st.seg];
    const segLen = cum[st.seg] - cum[st.seg - 1];
    const dir: Pt = [(b[0] - a[0]) / segLen, (b[1] - a[1]) / segLen];
    const facing = (PATH_FACING_MODES as readonly string[]).includes(mode)
      ? pathFacing(doc, names, dir, mode as PathFacingMode, (f) => op.footprint ?? footprintFor(known, f))
      : mode;
    const fp = op.footprint ?? footprintFor(known, facing);
    for (let k = 0; k < n; k++) {
      const s = st.from + (len - used) / 2 + L / 2 + k * step - cum[st.seg - 1];
      const x = Math.round((a[0] + dir[0] * s) * 1e4) / 1e4, y = Math.round((a[1] + dir[1] * s) * 1e4) / 1e4;
      try {
        created.push(opPlace(doc, {
          op: 'place', x, y, snap: false, group: id,
          ...(op.spriteId !== undefined ? { spriteId: op.spriteId } : {}), ...(op.assetRef ? { assetRef: op.assetRef } : {}), ...(op.name ? { name: op.name } : {}),
          ...(op.state !== undefined ? { state: op.state } : {}), ...(facing !== undefined ? { facing } : {}), ...(fp ? { footprint: fp } : {}),
          properties: props, ...(op.layer ? { layer: op.layer } : {}), ...(op.allowOverlap ? { allowOverlap: true } : {}),
          ...(op.collision === false ? { collision: false } : {}), ...(op.clear ? { clear: true } : {}),
        }, ctx, cleared));
      } catch (e) {
        if (!(e instanceof OpFail)) throw e;
        skipped.push({ at: [x, y], reason: e.message });
      }
    }
  }
  // A panel that doesn't fit fails the fence (as a stamp does): a fence with holes in it is not what was asked.
  if (skipped.length) fail(`${skipped.length} panel(s) of fence ${id} do not fit: ${skipped.slice(0, 3).map((s) => s.reason).join('; ')}${skipped.length > 3 ? '; …' : ''} (allowOverlap, clear: true for scattered objects, or move the line)`);
  const gateIds: string[] = [];
  if (op.gateZones !== false)
    for (const g of gates) {
      const at = (s: number): Pt => {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
        const clampTo = (v: number, hi: number) => Math.round(Math.max(0, Math.min(hi, v)) * 1e4) / 1e4;
        return [clampTo(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, doc.width), clampTo(line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t, doc.height)];
      };
      const zid = opAddZone(doc, {
        op: 'addZone', kind: 'custom', shape: 'polyline', name: g.name ?? 'gate', points: [at(g.from), at(g.to)],
        properties: { gate: true, fence: id, widthM: Math.round((g.to - g.from) * mpt * 1000) / 1000 },
      });
      gateIds.push(zid);
      created.push(zid);
    }
  return {
    created,
    report: {
      fence: id, panels: created.length - gateIds.length, panelLengthM: Math.round(lengthM * 1000) / 1000, lengthM: Math.round(total * mpt * 100) / 100,
      stretches: perStretch, ...(gateIds.length ? { gates: gateIds } : {}), ...(op.clear ? { cleared } : {}),
    },
  };
}
