// Moved from synty-sprite-generator packages/shared/src/object/turret.test.ts (P2, ali3b/sloponator#8).
import { describe, expect, it } from 'vitest';
import { VIEW_PRESETS, resolveDirections, type Framing } from '../view/camera.js';
import type { AnimationSet } from '../inputs/batch.js';
import { hullSet, parseTurret, turretBlock, turretLabel, turretMounts, turretSet } from './turret.js';

const iso = VIEW_PRESETS.find((p) => p.id === 'iso8')!.config;
const framing: Framing = { viewHalfW: 2, viewHalfH: 3, centreY: 0, frameWidth: 200, frameHeight: 300, pivot: { x: 100, y: 150 }, ppm: 50 };

describe('turret mounts (FB-096)', () => {
  const sin30 = Math.sin(Math.PI / 6), cos30 = Math.cos(Math.PI / 6);
  const at = (name: string, mounts: ReturnType<typeof turretMounts>) => mounts.find((m) => m.name === name)!;

  it('projects the turret axis into each hull direction, relative to the frame pivot', () => {
    const dirs = resolveDirections({ ...iso, mirror: false });
    const mounts = turretMounts({ axis: { x: 0, y: 2, z: -1 }, pitch: 30, framing, directions: dirs, pivotOf: () => framing.pivot });
    expect(mounts).toHaveLength(8);
    // S shows the model unturned (+z towards the camera): an axis 1 m behind the origin sits higher on screen.
    const s = at('S', mounts);
    expect(s.worldAngle).toBe(270);
    expect(s.offset.x).toBeCloseTo(0, 1);
    expect(s.offset.y).toBeCloseTo(-(2 * cos30 + 1 * sin30) * 50, 1);
    expect(s.pivot.y).toBeCloseTo(150 + s.offset.y, 1);
    // N faces away: the axis is 1 m nearer the camera, so lower on screen than in S.
    const n = at('N', mounts);
    expect(n.offset.x).toBeCloseTo(0, 1);
    expect(n.offset.y).toBeCloseTo(-(2 * cos30 - 1 * sin30) * 50, 1);
    // E and W: the axis moves sideways by 1 m, in opposite directions, at the height of the origin's row.
    const e = at('E', mounts), w = at('W', mounts);
    expect(Math.abs(e.offset.x)).toBeCloseTo(50, 1);
    expect(e.offset.x).toBeCloseTo(-w.offset.x, 1);
    expect(e.offset.y).toBeCloseTo(-2 * cos30 * 50, 1);
  });

  it('an axis on the model origin at ground level is the pivot itself', () => {
    const dirs = resolveDirections({ ...iso, mirror: false });
    for (const m of turretMounts({ axis: { x: 0, y: 0, z: 0 }, pitch: 30, framing, directions: dirs, pivotOf: () => framing.pivot })) {
      expect(m.offset).toEqual({ x: 0, y: 0 });
    }
  });

  it('measures from each direction\'s own pivot (object anchors)', () => {
    const dirs = resolveDirections({ ...iso, mirror: false });
    const anchors: Record<string, { x: number; y: number }> = Object.fromEntries(dirs.map((d, i) => [d.name, { x: 90 + i, y: 160 - i }]));
    const mounts = turretMounts({ axis: { x: 0.5, y: 1.5, z: -0.4 }, pitch: 30, framing, directions: dirs, pivotOf: (d) => anchors[d] });
    for (const m of mounts) {
      expect(m.pivot.x - anchors[m.name].x).toBeCloseTo(m.offset.x, 1);
      expect(m.pivot.y - anchors[m.name].y).toBeCloseTo(m.offset.y, 1);
    }
  });

  it('mirrored directions are their source flipped', () => {
    const dirs = resolveDirections({ ...iso, mirror: true });
    expect(dirs.some((d) => d.mirrorOf !== null)).toBe(true);
    const flipped = (p: { x: number; y: number }) => ({ x: framing.frameWidth - p.x, y: p.y });
    const mounts = turretMounts({ axis: { x: 0.3, y: 2, z: -1 }, pitch: 30, framing, directions: dirs, pivotOf: () => framing.pivot });
    for (const d of dirs.filter((x) => x.mirrorOf !== null)) {
      const m = at(d.name, mounts), src = mounts[d.mirrorOf!];
      expect(m.mirrorOf).toBe(src.name);
      expect(m.pivot.x).toBeCloseTo(flipped(src.pivot).x, 2);
      expect(m.pivot.y).toBeCloseTo(src.pivot.y, 2);
    }
  });

  it('builds the turret block with direction names', () => {
    const dirs = resolveDirections({ ...iso, directions: '16', mirror: true });
    const b = turretBlock({ base: 'Tank_turret', files: ['Tank_turret.json'], parts: ['Turret'], axis: { x: -0.0026, y: 1.87, z: -0.36 }, pixelsPerMetre: 45.254834, clips: ['turret'], mounts: [], directions: dirs });
    expect(b.schema).toBe('ssg-turret/1');
    expect(b.directions).toHaveLength(16);
    expect(b.directions.find((d) => d.mirrorOf)?.mirrorOf).toMatch(/^[NSEW]/);
    expect(b.axis).toEqual({ x: -0.003, y: 1.87, z: -0.36 });
    expect(b.pixelsPerMetre).toBe(45.2548);
    expect(b.draw).toBe('above');
  });
});

describe('turret spec values', () => {
  it('parses true, counts and objects', () => {
    expect(parseTurret(true)).toEqual({});
    expect(parseTurret('on')).toEqual({});
    expect(parseTurret(16)).toEqual({ dirs: '16' });
    expect(parseTurret('32')).toEqual({ dirs: '32' });
    expect(parseTurret({ dirs: '8' })).toEqual({ dirs: '8' });
    expect(parseTurret({ directions: 16 })).toEqual({ dirs: '16' });
    expect(parseTurret({})).toEqual({});
  });
  it('turns off', () => {
    for (const v of [false, null, undefined, 'off', 'none']) expect(parseTurret(v)).toBeNull();
  });
  it('refuses nonsense with the choices', () => {
    expect(() => parseTurret(7)).toThrow(/one of 1, 2, 4/);
    expect(() => parseTurret({ dir: 8 })).toThrow(/unknown key dir/);
    expect(() => parseTurret([8])).toThrow(/turret must be/);
  });
  it('labels', () => {
    expect(turretLabel({ dirs: '16' })).toBe('turret 16 dirs');
    expect(turretLabel({})).toBe('turret');
    expect(turretLabel(null)).toBeNull();
  });
});

describe('hull and turret moves', () => {
  const set: AnimationSet = {
    id: 'adhoc', name: 'Tank', items: [
      { type: 'template', layers: [{ id: 'drive', params: {} }], label: 'drive' },
      { type: 'template', layers: [{ id: 'fire', params: { duration: 0.6 } }], label: 'fire' },
      { type: 'template', layers: [{ id: 'turret_sweep', params: {} }], label: 'turret_sweep' },
      { type: 'template', layers: [{ id: 'drive', params: {} }, { id: 'turret_sweep', params: {} }], label: 'drive+turret_sweep' },
    ],
  };
  it('the hull drops the turret sweep', () => {
    const h = hullSet(set);
    expect(h.items.map((i) => i.label)).toEqual(['drive', 'fire', 'drive+turret_sweep']);
    expect(h.items[2].type === 'template' && h.items[2].layers.map((l) => l.id)).toEqual(['drive']);
  });
  it('a hull with nothing left stands still', () => {
    const h = hullSet({ id: 'x', name: 'x', items: [{ type: 'template', layers: [{ id: 'turret_sweep', params: {} }], label: 'sweep' }] });
    expect(h.items).toEqual([{ type: 'template', layers: [{ id: 'still', params: {} }], label: 'still' }]);
  });
  it('the turret gets a still and its own fire', () => {
    const t = turretSet(set);
    expect(t.items.map((i) => i.label)).toEqual(['turret', 'turret_fire']);
    expect(t.items[1].type === 'template' && t.items[1].layers).toEqual([{ id: 'fire', params: { duration: 0.6 } }]);
    expect(t.id).toBe('adhoc_turret');
  });
});
