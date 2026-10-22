// Moved from synty-sprite-generator packages/shared/src/model3d/trackpiece.test.ts (P3, ali3b/sloponator#14).
import { describe, expect, it } from 'vitest';
import {
  TRACK_PRESETS, entryFrame, expandTrackpiece, joinTransform, normaliseSpec, normaliseTrackpiece, segmentFrame, socketQuat, specHash, sweepTrack,
  type TrackSocket, type TrackpieceSpec,
} from '../src/index.js';

const piece = (t: TrackpieceSpec) => sweepTrack(expandTrackpiece(normaliseTrackpiece(t)));
const sock = (t: TrackpieceSpec, name: string) => piece(t).sockets.find((s) => s.name === name)!;
const near = (a: number[], b: number[], tol = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const expectNear = (a: number[], b: number[], tol = 1e-3) => expect(near(a, b, tol), `${JSON.stringify(a)} ≈ ${JSON.stringify(b)}`).toBe(true);

/** Chain pieces: each one's `in` joined to the previous one's `out`; returns the last `out` in the first piece's frame. */
type Frame = Pick<TrackSocket, 'pos' | 'forward' | 'up'>;
function chain(pieces: TrackpieceSpec[]): Frame {
  let at: Frame = { pos: [0, 0, 0], forward: [0, 0, 1], up: [0, 1, 0] };
  for (const p of pieces) {
    const m = piece(p);
    const inn = m.sockets.find((s) => s.name === 'in')!, out = m.sockets.find((s) => s.name === 'out')!;
    const j = joinTransform(at, { ...inn, pos: inn.pos });
    at = { pos: j.point(out.pos), forward: j.dir(out.forward), up: j.dir(out.up) };
  }
  return at;
}

describe('trackpiece path maths', () => {
  it('a straight runs one cell along +Z, level', () => {
    const m = piece({ preset: 'straight' });
    expect(m.sockets.map((s) => s.name)).toEqual(['in', 'out']);
    expect(m.sockets[0]).toMatchObject({ dir: 'in', pos: [0, 0, 0], forward: [0, 0, 1], up: [0, 1, 0] });
    expect(m.sockets[1]).toMatchObject({ dir: 'out', pos: [0, 0, 30], forward: [0, 0, 1], up: [0, 1, 0] });
    expect(m.footprint).toEqual({ cells: [1, 1], min: [-15, 0] });
    expect(m.collider.idx.length).toBeGreaterThan(0);
  });

  it('curves end on the middle of a cell edge, turned 90°', () => {
    const r1 = sock({ preset: 'curve-right' }, 'out');
    expectNear(r1.pos, [-15, 0, 15], 1e-4);
    expectNear(r1.forward, [-1, 0, 0], 1e-4);
    const l2 = sock({ preset: 'curve-left', size: 2 }, 'out');
    expectNear(l2.pos, [45, 0, 45], 1e-4);
    expectNear(l2.forward, [1, 0, 0], 1e-4);
    expect(piece({ preset: 'curve-left', size: 2 }).footprint.cells).toEqual([2, 2]);
  });

  it('four curves close a circuit within 1 mm (small and large, banked)', () => {
    const back = (p: TrackpieceSpec) => chain([p, p, p, p]);
    for (const p of [{ preset: 'curve-right' }, { preset: 'curve-left', size: 2 }, { preset: 'banked-curve-right' }] as TrackpieceSpec[]) {
      const end = back(p);
      expectNear(end.pos, [0, 0, 0]);
      expectNear(end.forward, [0, 0, 1]);
      expectNear(end.up, [0, 1, 0]);
    }
  });

  it('a banked curve is level at its ends and banked into the turn in the middle', () => {
    const ex = expandTrackpiece(normaliseTrackpiece({ preset: 'banked-curve-left', bank: 30 }));
    expect(ex.path.map((s) => s.bank)).toEqual([30, 30, 0]);
    const m = sweepTrack(ex);
    expectNear(m.sockets[0].up, [0, 1, 0]);
    expectNear(m.sockets[1].up, [0, 1, 0]);
    expectNear(m.sockets[1].pos, [45, 0, 45]);
    // Banked ends (bankIn/bankOut) tilt the socket's up and lift it so the low edge stays on the path.
    const b = sock({ preset: 'banked-curve-left', bankOut: 20 }, 'out');
    expect(b.up[2]).toBeCloseTo(-Math.sin((20 * Math.PI) / 180), 3); // heading +X the right edge is +Z: raised, up leans to -Z
    expect(b.pos[1]).toBeCloseTo(5 * Math.sin((20 * Math.PI) / 180), 3);
  });

  it('a bank transition joins a banked end exactly', () => {
    const a = sock({ preset: 'banked-curve-left', bankOut: 20 }, 'out');
    const t = piece({ preset: 'bank-transition', from: 20, to: 0 });
    expectNear(t.sockets[0].up, [Math.sin((20 * Math.PI) / 180), Math.cos((20 * Math.PI) / 180), 0]); // right edge (-X) raised
    // In its own frame the transition's entry is lifted by the same amount as the curve's exit.
    expect(t.sockets[0].pos[1]).toBeCloseTo(a.pos[1], 4);
    expectNear(t.sockets[1].up, [0, 1, 0]);
  });

  it('a loop comes back level, offset sideways by more than the road; inline it ends on the centre line', () => {
    const m = piece({ preset: 'loop' });
    const out = m.sockets[1];
    expectNear(out.forward, [0, 0, 1]);
    expectNear(out.up, [0, 1, 0]);
    expect(out.pos[2]).toBeCloseTo(30, 4);
    expect(out.pos[1]).toBeCloseTo(0, 4);
    expect(out.pos[0]).toBeLessThan(-10.8); // to the right, clear of the 10.8 m road with its walls
    expect(m.bounds.max[1]).toBeGreaterThan(23.9);
    const left = sock({ preset: 'loop', turn: 'left' }, 'out');
    expect(left.pos[0]).toBeGreaterThan(10.8);
    const inline = sock({ preset: 'loop', align: 'inline' }, 'out');
    expectNear(inline.pos, [0, 0, 60]);
    expectNear(inline.forward, [0, 0, 1]);
  });

  it('a corkscrew turns once round and comes back level, a cell to the side and two on', () => {
    for (const [preset, x] of [['corkscrew-right', -30], ['corkscrew-left', 30]] as const) {
      const m = piece({ preset });
      expectNear(m.sockets[1].pos, [x, 0, 60]);
      expectNear(m.sockets[1].forward, [0, 0, 1]);
      expectNear(m.sockets[1].up, [0, 1, 0]);
      // Upside down half way: the deck's up points down somewhere along it.
      const seg = expandTrackpiece(normaliseTrackpiece({ preset })).path[0];
      const mid = segmentFrame(entryFrame({ elevation: 0, pitch: 0 }), seg, seg.length / 2);
      expect(mid.u[1]).toBeLessThan(-0.9);
    }
  });

  it('segment frames are continuous and orthonormal (turn + pitch + roll + shift + rise)', () => {
    const seg = { length: 40, turn: 70, pitch: 30, roll: -50, shift: 3, rise: 2 };
    const f0 = entryFrame({ elevation: 1, pitch: 10 });
    let prev = segmentFrame(f0, seg, 0);
    expectNear(prev.p, f0.p, 1e-9);
    for (let i = 1; i <= 400; i++) {
      const f = segmentFrame(f0, seg, (i / 400) * 40);
      const d = Math.hypot(f.p[0] - prev.p[0], f.p[1] - prev.p[1], f.p[2] - prev.p[2]);
      expect(d).toBeLessThan(0.15); // 0.1 m steps (a little more with the eased shift)
      // The tangent is the direction of travel.
      const dir = [(f.p[0] - prev.p[0]) / d, (f.p[1] - prev.p[1]) / d, (f.p[2] - prev.p[2]) / d];
      expect(dir[0] * f.t[0] + dir[1] * f.t[1] + dir[2] * f.t[2]).toBeGreaterThan(0.999);
      expect(Math.abs(f.t[0] * f.u[0] + f.t[1] * f.u[1] + f.t[2] * f.u[2])).toBeLessThan(1e-9);
      prev = f;
    }
  });

  it('slopes, ramps and jumps land on the grid at their heights', () => {
    expectNear(sock({ preset: 'slope-up', height: 6 }, 'out').pos, [0, 6, 30]);
    const down = piece({ preset: 'slope-down', height: 6 });
    expectNear(down.sockets[0].pos, [0, 6, 0]);
    expectNear(down.sockets[1].pos, [0, 0, 30]);
    const ramp = sock({ preset: 'ramp', height: 2.5, angle: 20 }, 'out');
    expectNear(ramp.pos, [0, 2.5, 30]);
    expectNear(ramp.forward, [0, Math.sin((20 * Math.PI) / 180), Math.cos((20 * Math.PI) / 180)]);
    const landing = piece({ preset: 'landing' });
    expectNear(landing.sockets[0].forward, [0, -Math.sin((20 * Math.PI) / 180), Math.cos((20 * Math.PI) / 180)]);
    expectNear(landing.sockets[1].pos, [0, 0, 30]);
    // A slope up then down chain back to the ground; the jump has no deck over its gap.
    expectNear(chain([{ preset: 'slope-up' }, { preset: 'slope-down' }]).pos, [0, 0, 60]);
    const jump = piece({ preset: 'jump' });
    expectNear(jump.sockets[1].pos, [0, 0, 90]);
    expect(jump.footprint.cells).toEqual([1, 3]);
    const deckZ = [] as number[];
    const d = jump.slots.deck.pos;
    for (let i = 2; i < d.length; i += 3) deckZ.push(d[i]);
    expect(deckZ.some((z) => z > 31 && z < 59)).toBe(false);
    expect(() => normaliseTrackpiece({ preset: 'ramp', height: 30 })).toThrow(/needs .* more than/);
  });

  it('pipes, transitions, half-pipes and tunnels keep their sockets on the deck centre line', () => {
    for (const preset of ['pipe', 'pipe-in', 'pipe-out', 'halfpipe', 'halfpipe-in', 'tunnel', 'bridge', 'chicane-left', 'straight'] as const) {
      const m = piece({ preset });
      const y = preset === 'bridge' ? 8 : 0;
      expectNear(m.sockets[0].pos, [0, y, 0]);
      expectNear(m.sockets[1].pos, [0, y, 30]);
      expectNear(m.sockets[1].forward, [0, 0, 1]);
    }
    // The pipe is closed: its surface reaches the full diameter above the deck.
    expect(piece({ preset: 'pipe' }).bounds.max[1]).toBeGreaterThan(10);
    // A bridge stands on pillars down to the ground.
    expect(piece({ preset: 'bridge' }).bounds.min[1]).toBeCloseTo(0, 3);
    expect(piece({ preset: 'bridge' }).slots.support.pos.length).toBeGreaterThan(0);
  });

  it('splits and crossroads have a socket per open end, on cell edges', () => {
    const split = piece({ preset: 'split-right' });
    expect(split.sockets.map((s) => s.name)).toEqual(['in', 'out', 'branch']);
    expectNear(split.sockets[1].pos, [0, 0, 60]);
    expectNear(split.sockets[2].pos, [-45, 0, 45]);
    expectNear(split.sockets[2].forward, [-1, 0, 0]);
    const x = piece({ preset: 'crossroads' });
    expect(x.sockets.map((s) => [s.name, s.dir])).toEqual([['in', 'in'], ['out', 'out'], ['left', 'in'], ['right', 'out']]);
    expectNear(x.sockets[2].pos, [15, 0, 15]);
    expectNear(x.sockets[2].forward, [-1, 0, 0]);
    expectNear(x.sockets[3].pos, [-15, 0, 15]);
    expect(x.footprint.cells).toEqual([1, 1]);
  });

  it('every preset sweeps into a closed-looking mesh with a collider', () => {
    for (const preset of TRACK_PRESETS) {
      const m = piece({ preset });
      const tris = Object.values(m.slots).reduce((n, s) => n + s.pos.length / 9, 0);
      expect(tris, preset).toBeGreaterThan(20);
      expect(m.collider.idx.length % 3).toBe(0);
      expect(m.collider.idx.length / 3, preset).toBeGreaterThan(4);
      for (const s of m.sockets) expect(Math.hypot(...s.forward), preset).toBeCloseTo(1, 3);
    }
  });

  it('custom paths: segments, branches and checks', () => {
    const t = normaliseTrackpiece({ path: [{ length: 10, turn: 0, shift: 0 }, { length: 20, turn: -45, bank: -10 }], cell: 20, width: 8 });
    expect(t).toEqual({ path: [{ length: 10 }, { length: 20, turn: -45, bank: -10 }], cell: 20, profile: { width: 8 } });
    // bank 0 levels out (it is absolute), so it is kept.
    const lvl = piece({ path: [{ length: 30, turn: 30, bank: 15 }, { length: 30, turn: -30, bank: 0 }] });
    expectNear(lvl.sockets[1].up, [0, 1, 0]);
    expect(lvl.sockets[1].edge).toBe('road');
    expect(() => normaliseTrackpiece({ preset: 'loop', size: 2 })).toThrow(/does not take "size"/);
    expect(() => normaliseTrackpiece({ preset: 'straight', path: [{ length: 1 }] })).toThrow(/preset or a path/);
    expect(() => normaliseTrackpiece({ path: [{ length: 10, wiggle: 2 }] })).toThrow(/unknown field "wiggle"/);
    expect(() => normaliseTrackpiece({ preset: 'loop', radius: 20 })).toThrow(/does not fit/);
    const b = piece({ path: [{ length: 30 }], branches: [{ name: 'spur', from: 1, path: [{ length: 15.7079632679, turn: 90 }] }] });
    expect(b.sockets.map((s) => s.name)).toEqual(['in', 'out', 'spur']);
    expectNear(b.sockets[2].pos, [10, 0, 40]);
  });

  it('socket quaternions turn +Z/+Y onto forward/up', () => {
    expect(socketQuat([0, 0, 1], [0, 1, 0])).toEqual([0, 0, 0, 1]);
    const q = socketQuat([-1, 0, 0], [0, 1, 0]);
    // A quarter turn about -Y.
    expect(q[1]).toBeCloseTo(-Math.SQRT1_2, 4);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('a trackpiece model spec hashes stably and refuses asset fields', () => {
    const a = normaliseSpec({ trackpiece: { preset: 'loop', radius: 12 } });
    expect(a.name).toBe('track_loop');
    expect(a.asset).toBeUndefined();
    expect(specHash({ trackpiece: { preset: 'loop', radius: 12 }, collider: 'trimesh' })).toBe(specHash({ trackpiece: { radius: 12.00001, preset: 'loop' } }));
    expect(specHash({ trackpiece: { preset: 'loop' }, collider: 'box' })).not.toBe(specHash({ trackpiece: { preset: 'loop' } }));
    expect(() => normaliseSpec({ trackpiece: { preset: 'loop' }, tint: '#ff0000' })).toThrow(/tint does not apply/);
    expect(() => normaliseSpec({ trackpiece: { preset: 'loop' }, collider: 'convex' })).toThrow(/convex/);
    // Assets: trimesh is recorded, box (the default) is not, so older specs keep their ids.
    expect(normaliseSpec({ asset: 'X', collider: 'trimesh' }).collider).toBe('trimesh');
    expect(specHash({ asset: 'X', collider: 'box' })).toBe(specHash({ asset: 'X' }));
  });
});

/** Car Smash Stunt Tracks' measured dimensions (CS-FB-001): a 62.42 m tile, a 14.63 m road, 27.43 m hills. */
describe('trackpieces at the game\'s dimensions', () => {
  const c = 62.42, w = 14.63, H = 27.43;
  const g = (t: TrackpieceSpec): TrackpieceSpec => ({ cell: c, width: w, ...t });
  it('corners: 31.2 m in a 1×1 tile, 93.6 m in 2×2; banked at 28.4°', () => {
    expectNear(sock(g({ preset: 'curve-right' }), 'out').pos, [-c / 2, 0, c / 2]);
    expectNear(sock(g({ preset: 'curve-left', size: 2 }), 'out').pos, [1.5 * c, 0, 1.5 * c]);
    expectNear(sock(g({ preset: 'curve-left', radius: 93.6 }), 'out').pos, [93.6, 0, 93.6]);
    const banked = piece(g({ preset: 'banked-curve-left', bank: 28.4, bankOut: 28.4 }));
    expect(banked.sockets[1].edge).toBe('banked-left');
    expect(banked.sockets[0].edge).toBe('road');
    expect(piece(g({ preset: 'banked-curve-right', bankIn: 28.4 })).sockets[0].edge).toBe('banked-right');
    for (const p of [g({ preset: 'curve-right' }), g({ preset: 'curve-left', size: 2 })]) {
      const end = chain([p, p, p, p]);
      expectNear(end.pos, [0, 0, 0]);
    }
  });
  it('a slope rises 27.43 m over one tile (23.7° on average) with level ends; elevated ends say so', () => {
    const m = piece(g({ preset: 'slope-up', height: H }));
    expectNear(m.sockets[1].pos, [0, H, c]);
    expectNear(m.sockets[1].forward, [0, 0, 1]);
    expect(m.sockets.map((s) => s.edge)).toEqual(['road', 'elevated']);
    expect(piece(g({ preset: 'bridge', height: H })).sockets.map((s) => s.edge)).toEqual(['elevated', 'elevated']);
    expect(piece(g({ preset: 'straight', width: 43.9, edge: 'highway' })).sockets[0]).toMatchObject({ edge: 'highway', width: 43.9 });
    expectNear(chain([g({ preset: 'slope-up', height: H }), g({ preset: 'straight' }), g({ preset: 'slope-down', height: H })]).pos, [0, 0, 3 * c]);
  });
  it('a 59.4 m loop fits one tile, its exit a road width to the side; inline on 1×2', () => {
    const m = piece(g({ preset: 'loop', radius: 29.7 }));
    expect(m.bounds.max[1]).toBeGreaterThan(59.4);
    expect(m.sockets[1].pos[2]).toBeCloseTo(c, 3);
    expect(Math.abs(m.sockets[1].pos[0])).toBeGreaterThan(w);
    expect(m.footprint.cells[1]).toBe(1);
    expectNear(sock(g({ preset: 'loop', radius: 29.7, align: 'inline' }), 'out').pos, [0, 0, 2 * c]);
  });
  it('a 7.16 m pipe and its road transitions', () => {
    const p = piece(g({ preset: 'pipe', radius: 7.16 }));
    expect(p.bounds.max[1]).toBeCloseTo(2 * 7.16 + 0.5, 1);
    expect(p.sockets.map((s) => [s.edge, s.width])).toEqual([['pipe', 14.32], ['pipe', 14.32]]);
    expect(piece(g({ preset: 'pipe-in', radius: 7.16 })).sockets.map((s) => s.edge)).toEqual(['road', 'pipe']);
    expect(piece(g({ preset: 'pipe-out', radius: 7.16 })).sockets.map((s) => s.edge)).toEqual(['pipe', 'road']);
  });
  it('a helix: radius 31.2 m, climbs 27.43 m in one turn and comes out level over its entry; down too', () => {
    const up = piece(g({ preset: 'helix-right', radius: 31.2, height: H }));
    expectNear(up.sockets[1].pos, [0, H, 0]);
    expectNear(up.sockets[1].forward, [0, 0, 1]);
    const down = piece(g({ preset: 'helix-left', radius: 31.2, height: -H }));
    expectNear(down.sockets[0].pos, [0, H, 0]);
    expectNear(down.sockets[1].pos, [0, 0, 0]);
  });
  it('a roll corkscrew turns the deck through 360° along the piece', () => {
    const m = piece(g({ preset: 'corkscrew-left' }));
    expectNear(m.sockets[1].pos, [c, 0, 2 * c]);
    expectNear(m.sockets[1].up, [0, 1, 0]);
  });
  it('CS-FB-011: an offset chicane is a lane change; a helix travels; a corkscrew with side 0 rolls in line', () => {
    const ch = piece(g({ preset: 'chicane-left', offset: true, shift: 9 }));
    expectNear(ch.sockets[1].pos, [9, 0, c]);
    expectNear(ch.sockets[1].forward, [0, 0, 1]);
    expectNear(sock(g({ preset: 'chicane-right', offset: true, length: 2 }), 'out').pos, [-0.6 * w, 0, 2 * c]);
    expectNear(sock(g({ preset: 'chicane-left' }), 'out').pos, [0, 0, c]); // the S-bend still ends in line
    const hx = piece(g({ preset: 'helix-right', radius: 31.2, height: H, travel: 2 }));
    expectNear(hx.sockets[1].pos, [0, H, 2 * c]);
    expectNear(hx.sockets[1].forward, [0, 0, 1]);
    expect(hx.footprint).toEqual({ cells: [2, 2], min: [-1.5 * c, 0] });
    const roll = piece(g({ preset: 'corkscrew-right', side: 0 }));
    expectNear(roll.sockets[1].pos, [0, 0, 2 * c]);
    expectNear(roll.sockets[1].up, [0, 1, 0]);
    expect(roll.footprint.cells).toEqual([1, 2]);
    // Halfway along the roll the deck is upside down.
    const ex = expandTrackpiece(normaliseTrackpiece(g({ preset: 'corkscrew-right', side: 0 })));
    const mid = segmentFrame(entryFrame(ex), ex.path[0], ex.path[0].length / 2);
    expectNear(mid.u, [0, -1, 0]);
    expect(() => normaliseTrackpiece({ preset: 'straight', offset: true })).toThrow(/does not take "offset"/);
    expect(() => normaliseTrackpiece({ preset: 'helix-left', travel: -1 })).toThrow(/travel/);
  });
  it('CS-FB-020: slope-up with transition 0 is a constant grade end to end (the deck on the straight hill slope)', () => {
    const m = piece(g({ preset: 'slope-up', height: H, transition: 0 }));
    const grade = Math.atan2(H, c);
    expectNear(m.sockets[0].pos, [0, 0, 0]);
    expectNear(m.sockets[1].pos, [0, H, c]);
    for (const s of m.sockets) expectNear(s.forward, [0, Math.sin(grade), Math.cos(grade)], 1e-4);
    expect(m.footprint).toEqual({ cells: [1, 1], min: [-c / 2, 0] });
    expect((grade * 180) / Math.PI).toBeCloseTo(23.73, 1);
    // The deck's centre line is on the linear slope everywhere (it used to dip 0.6 m under it near the ends).
    const ex = expandTrackpiece(normaliseTrackpiece(g({ preset: 'slope-up', height: H, transition: 0 })));
    for (const x of [0.1, 0.25, 0.75, 0.95]) {
      const p = segmentFrame(entryFrame(ex), ex.path[0], ex.path[0].length * x).p;
      expect(p[1]).toBeCloseTo((H * p[2]) / c, 6);
    }
    const down = piece(g({ preset: 'slope-down', height: H, transition: 0 }));
    expectNear(down.sockets[0].pos, [0, H, 0]);
    expectNear(down.sockets[1].pos, [0, 0, c]);
    expectNear(down.sockets[1].forward, [0, -Math.sin(grade), Math.cos(grade)], 1e-4);
    // Small transitions are honoured as given now (no 0.05 floor).
    const t1 = expandTrackpiece(normaliseTrackpiece(g({ preset: 'slope-up', height: H, transition: 0.01 })));
    expect(t1.path[0].length).toBeLessThan(1);
  });
  it('CS-FB-027: a barrel roll about an axis 7.16 m above the deck: up the right wall, over the top 14.32 m up, out on the entry line', () => {
    const R = 7.16;
    const spec = g({ preset: 'barrel-roll', radius: R, length: 2 });
    const m = piece(spec);
    expectNear(m.sockets[0].pos, [0, 0, 0]);
    expectNear(m.sockets[0].forward, [0, 0, 1]);
    expectNear(m.sockets[1].pos, [0, 0, 2 * c]);
    expectNear(m.sockets[1].forward, [0, 0, 1]);
    expectNear(m.sockets[1].up, [0, 1, 0]);
    expect(m.footprint).toEqual({ cells: [1, 2], min: [-c / 2, 0] });
    const ex = expandTrackpiece(normaliseTrackpiece(spec));
    const seg = ex.path[0];
    const at = (x: number) => segmentFrame(entryFrame(ex), seg, seg.length * x);
    // A quarter of the way round the deck stands on the right wall (+X is the left), facing the axis.
    let q = 0;
    for (let i = 0; i <= 2000; i++) if (Math.abs(at(i / 2000).u[1]) < Math.abs(at(q).u[1]) && at(i / 2000).u[0] > 0) q = i / 2000;
    expectNear(at(q).p.slice(0, 2), [-R, R], 1e-2);
    expectNear(at(q).u, [1, 0, at(q).u[2]], 1e-2);
    // Half way: upside down at the top, 2R up, on the centre line; the axis stays R above the deck all along.
    expectNear(at(0.5).p, [0, 2 * R, c]);
    expectNear(at(0.5).u, [0, -1, 0]);
    for (const x of [0.1, 0.3, 0.6, 0.9]) {
      const f = at(x);
      expectNear([f.p[0] + R * f.u[0], f.p[1] + R * f.u[1]], [0, R]);
      expect(Math.abs(f.t[0] * f.u[0] + f.t[1] * f.u[1] + f.t[2] * f.u[2])).toBeLessThan(1e-9);
    }
    // left climbs the left wall first; a custom path takes { roll, rollRadius } directly.
    const l = expandTrackpiece(normaliseTrackpiece(g({ preset: 'barrel-roll', radius: R, turn: 'left' })));
    expect(segmentFrame(entryFrame(l), l.path[0], l.path[0].length / 4).p[0]).toBeGreaterThan(0);
    const custom = piece({ cell: c, width: w, path: [{ length: 2 * c, roll: 360, rollRadius: R }] });
    expectNear(custom.sockets[1].pos, [0, 0, 2 * c]);
    expect(custom.bounds.max[1]).toBeGreaterThan(2 * R);
    expect(() => normaliseTrackpiece({ path: [{ length: 10, rollRadius: 5 }] })).toThrow(/goes with a roll/);
    expect(() => normaliseTrackpiece({ path: [{ length: 10, roll: 360, turn: 10, rollRadius: 5 }] })).toThrow(/takes no turn/);
    expect(() => normaliseTrackpiece({ path: [{ length: 10, roll: 360, rollEase: 0.1 }] })).toThrow(/goes with rollRadius/);
  });
  it('CS-FB-012: widen blends a road into a divided highway over one tile; narrow goes back', () => {
    const to = { width: 43.9, edge: 'highway', median: 3 };
    const wd = piece(g({ preset: 'widen', to }));
    expect(wd.sockets.map((s) => [s.edge, s.width, s.median])).toEqual([['road', w, undefined], ['highway', 43.9, 3]]);
    expectNear(wd.sockets[1].pos, [0, 0, c]);
    expect(wd.bounds.max[0] - wd.bounds.min[0]).toBeGreaterThan(43.9);
    // The median barrier stands on the exit's centre line (in the collider too).
    const onMedian = (pos: number[]) => pos.some((_, i) => i % 3 === 0 && Math.abs(pos[i]) <= 1.5 && pos[i + 1] > 0.7 && Math.abs(pos[i + 2] - c) < 0.01);
    expect(onMedian(wd.slots.wall.pos)).toBe(true);
    expect(onMedian(wd.collider.pos)).toBe(true);
    const nr = piece(g({ preset: 'narrow', from: to }));
    expect(nr.sockets.map((s) => [s.edge, s.width, s.median])).toEqual([['highway', 43.9, 3], ['road', w, undefined]]);
    // A highway straight joins on: same edge, width and median.
    const hw = piece({ cell: c, preset: 'straight', profile: { width: 43.9, median: 3 }, edge: 'highway' });
    expect(hw.sockets[0]).toMatchObject({ edge: 'highway', width: 43.9, median: 3 });
    expectNear(chain([g({ preset: 'widen', to }), { cell: c, preset: 'straight', profile: { width: 43.9, median: 3 }, edge: 'highway' }, g({ preset: 'narrow', from: to })]).pos, [0, 0, 3 * c]);
    expect(sock(g({ preset: 'widen' }), 'out')).toMatchObject({ edge: 'highway', width: 43.89, median: 3 }); // default: 3 × the road
    expect(() => normaliseTrackpiece({ preset: 'widen', to: { width: 6, median: 5 } })).toThrow(/median/);
    expect(() => normaliseTrackpiece({ preset: 'widen', to: 43.9 })).toThrow(/must be an object/);
  });
});
