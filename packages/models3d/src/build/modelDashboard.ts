// Moved from synty-sprite-generator apps/server/src/modelDashboard.ts (P3, ali3b/sloponator#14).
import type { Node } from '@gltf-transform/core';
import type { ModelDashboard, ModelGauge, ModelPart, ModelVec3 } from '../spec/index.js';

/**
 * CS-FB-023: a vehicle's instrument cluster. Street Racer cars carry their speedometer dials
 * (`…_Speedometer_02`) and needles (`…_Speedometer_Needle_01`) as parts, and the pack sells them as attachments
 * (`SM_Veh_Attach_Speedometer_01` + `…_Needle_01`). The roles come from worker/roles.json (`needle` before `gauge`);
 * here each dial's face is measured (its plane from the spread of its vertices), each needle is matched to the
 * nearest dial, and given the axis it turns about and the direction it points at rest.
 */

/** Names of gauge dials and needles (for nodes that are not parts: an attached needle). */
export const NEEDLE_NAME = /needle/i;
export const GAUGE_NAME = /speedo|tacho|rev_?counter|gauge|(^|_)dial(_|\d|$)/i;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const v3 = (v: number[]) => v.map(r4) as ModelVec3;
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return a.map((x) => x / l);
};

/** Eigenvectors of a symmetric 3×3 matrix (Jacobi), sorted by eigenvalue, largest first. */
export function eigen3(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]]) };
}

/** The points' centre (of their box) and principal axes (largest spread first). */
export function principalAxes(pts: number[][]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  const mean = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / Math.max(1, pts.length));
  const c = [0, 1, 2].map(() => [0, 0, 0]);
  for (const p of pts) {
    const d = sub(p, mean);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += d[i] * d[j];
  }
  return { center: lo.map((v, k) => (v + hi[k]) / 2), mean, ...eigen3(c) };
}

/** A node's vertices in the model's frame (static exports: a node has only a translation). */
export function nodePoints(n: Node): number[][] {
  const t = n.getWorldTranslation();
  const out: number[][] = [];
  const el: number[] = [];
  for (const prim of n.getMesh()?.listPrimitives() ?? []) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      out.push([el[0] + t[0], el[1] + t[1], el[2] + t[2]]);
    }
  }
  return out;
}

/**
 * The dashboard of a static export: gauges (role `gauge`) and needles (role `needle`). `repivot` moves a needle's
 * node to its hub when its source had no pivot of its own (an attached needle), keeping its geometry in place.
 * Undefined when the model has no gauge and no needle.
 */
export function dashboardOf(nodes: Node[], parts: ModelPart[], authored: Set<string>, repivot: (n: Node, at: number[]) => void): ModelDashboard | undefined {
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const dials = parts.filter((p) => p.role === 'gauge' && byName.has(p.node));
  const needles = parts.filter((p) => p.role === 'needle' && byName.has(p.node));
  if (!dials.length && !needles.length) return undefined;
  const gauges: ModelGauge[] = [];
  for (const d of dials) {
    const pts = nodePoints(byName.get(d.node)!);
    if (pts.length < 3) continue;
    const ax = principalAxes(pts);
    // The face's normal is the direction of least spread, turned towards the driver (behind the dash: -Z) until a
    // needle says which side its face is on.
    let normal = norm(ax.vectors[2]);
    if (normal[2] > 0 || (Math.abs(normal[2]) < 1e-6 && normal[1] < 0)) normal = normal.map((x) => -x);
    const radius = Math.max(...pts.map((p) => {
      const d0 = sub(p, ax.center);
      const along = dot(d0, normal);
      return Math.hypot(d0[0] - along * normal[0], d0[1] - along * normal[1], d0[2] - along * normal[2]);
    }));
    gauges.push({ node: d.node, center: v3(ax.center), normal: v3(normal), radius: r4(radius) });
  }
  for (const p of needles) {
    const n = byName.get(p.node)!;
    const pts = nodePoints(n);
    if (pts.length < 2) continue;
    const ax = principalAxes(pts);
    const long = norm(ax.vectors[0]);
    const proj = pts.map((q) => dot(sub(q, ax.mean), long));
    const lo = Math.min(...proj), hi = Math.max(...proj);
    const ends = [ax.mean.map((v, k) => v + long[k] * lo), ax.mean.map((v, k) => v + long[k] * hi)];
    let pivot = n.getWorldTranslation() as number[];
    // The nearest dial (to the needle's middle) is the one it turns on.
    const gauge = gauges
      .map((g) => ({ g, d: Math.hypot(...sub(ax.mean, g.center)) }))
      .filter((x) => x.d < Math.max(0.05, x.g.radius * 1.5))
      .sort((a, b) => a.d - b.d)[0]?.g;
    if (!authored.has(p.node)) {
      // No pivot in the source: the hub is the end nearest the dial's centre (else the wider end).
      // With a dial: where the needle's line passes the dial's centre (a needle may have a tail behind its hub).
      const hub = gauge
        ? (() => {
            const t = Math.max(lo, Math.min(hi, dot(sub(gauge.center, ax.mean), long)));
            return ax.mean.map((v, k) => v + long[k] * t);
          })()
        : (() => {
            const width = (e: number[]) => pts.filter((q) => Math.hypot(...sub(q, e)) < (hi - lo) * 0.25).length;
            return width(ends[0]) >= width(ends[1]) ? ends[0] : ends[1];
          })();
      repivot(n, hub);
      pivot = hub;
      p.pivot = v3(hub);
    }
    // The needle sits in front of its dial's face: that side is where the driver looks from (a dial on its own, an
    // attachment, faces +Z; a car's dash faces the seat, -Z).
    if (gauge && !gauge.needle && dot(sub(ax.mean, gauge.center), gauge.normal) < 0) gauge.normal = v3(gauge.normal.map((x) => -x));
    let normal = gauge ? [...gauge.normal] : norm(ax.vectors[2]);
    if (!gauge && (normal[2] > 0 || (Math.abs(normal[2]) < 1e-6 && normal[1] < 0))) normal = normal.map((x) => -x);
    // Clockwise as the driver (on the normal's side) sees it: a right-handed turn about the axis into the dial.
    const axis = v3(normal.map((x) => -x));
    const tipVec = pts.reduce((best, q) => {
      const d = sub(q, pivot);
      const along = dot(d, normal);
      const flat = [d[0] - along * normal[0], d[1] - along * normal[1], d[2] - along * normal[2]];
      return Math.hypot(...flat) > Math.hypot(...best) ? flat : best;
    }, [0, 0, 0]);
    const length = Math.hypot(...tipVec);
    p.axis = axis;
    const needle = { node: p.node, pivot: v3(pivot), axis, rest: v3(norm(tipVec)), length: r4(length) };
    if (gauge && !gauge.needle) gauge.needle = needle;
    else
      gauges.push({ node: p.node, center: v3(pivot), normal: v3(normal), radius: r4(length), needle });
  }
  return { gauges };
}
