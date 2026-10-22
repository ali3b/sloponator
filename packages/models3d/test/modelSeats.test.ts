// Moved from synty-sprite-generator apps/server/test/modelSeats.test.ts (P3, ali3b/sloponator#14).
import { describe, expect, it } from 'vitest';
import { detectSeats, isSeatingName } from '../src/build/modelSeats.js';

/** OR-FB-024: seat points from geometry (triangle soups built here). */

/** An upward quad (two triangles) at height y. */
const top = (x0: number, x1: number, y: number, z0: number, z1: number) => [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
/** A vertical quad across X at z (a seat back or a step's riser). */
const wall = (x0: number, x1: number, y0: number, y1: number, z: number) => [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];

describe('detectSeats', () => {
  it('a terrace: one row per step, a seat every 0.55 m, all facing down the slope (+Z)', () => {
    const tris: number[] = [];
    for (let i = 0; i < 4; i++) {
      const y = 0.4 * (i + 1), z1 = 2 - 0.5 * i;
      tris.push(...top(-2, 2, y, z1 - 0.5, z1), ...wall(-2, 2, y - 0.4, y, z1));
    }
    const seats = detectSeats(new Float32Array(tris), 0);
    expect(seats).toHaveLength(4 * 7);
    expect(new Set(seats.map((s) => s[1]))).toEqual(new Set([0.4, 0.8, 1.2, 1.6]));
    expect(seats.every((s) => s[3] === 0)).toBe(true);
    // Seats sit in the middle of their step, spread along the row.
    expect(seats[0]).toEqual([-1.7143, 0.4, 1.75, 0]);
  });

  it('a bench faces away from its back; slats with gaps are one seat; a step under the plank is its floor', () => {
    const slats = [...top(-1, 1, 0.45, -0.15, -0.06), ...top(-1, 1, 0.45, -0.04, 0.05), ...top(-1, 1, 0.45, 0.07, 0.15)];
    const front = detectSeats(new Float32Array([...slats, ...wall(-1, 1, 0.5, 1.0, -0.2)]), 0);
    expect(front.map((s) => s[3])).toEqual([0, 0, 0, 0]);
    expect(front.map((s) => s[0])).toEqual([-0.75, -0.25, 0.25, 0.75]);
    const back = detectSeats(new Float32Array([...slats, ...wall(-1, 1, 0.5, 1.0, 0.2)]), 0);
    expect(back.every((s) => s[3] === 3.1416)).toBe(true);
    // A bleacher level: the plank sits over the back of a 0.6 m deep step 0.4 m lower; only the plank is a seat.
    const level = detectSeats(new Float32Array([...top(-1, 1, 0.8, -0.15, 0.15), ...top(-1, 1, 0.4, -0.1, 0.5), ...wall(-1, 1, 0, 0.4, 0.5)]), 0);
    expect(level.map((s) => s[1])).toEqual([0.8, 0.8, 0.8, 0.8]);
  });

  it('no seats: a big floor, a thin rail, a surface at the floor', () => {
    expect(detectSeats(new Float32Array([...top(-3, 3, 0.5, -3, 3), ...top(-2, 2, 1, 0, 0.05), ...top(-1, 1, 0.02, 0, 0.4)]), 0)).toEqual([]);
  });

  it('seating names', () => {
    for (const n of ['SM_Bld_Grandstand_01', 'SM_Bld_Grandstand_Seating_03', 'SM_Prop_Bleachers_01', 'SM_Prop_Bench_Seat_01', 'SM_Prop_Bench_01']) expect(isSeatingName(n)).toBe(true);
    for (const n of ['SM_Bld_Grandstand_Stairs_01', 'SM_Bld_Grandstand_Roof_01', 'SM_Bld_Grandstand_End_02', 'SM_Prop_Bleachers_Barrier_01', 'SM_Env_RoadMarkings_Text_Seating_01', 'SM_Prop_Benchmark_01'])
      expect(isSeatingName(n)).toBe(false);
  });
});
