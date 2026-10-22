// Moved from synty-sprite-generator packages/shared/src/model3d/silhouette.test.ts (P3, ali3b/sloponator#14).
import { describe, expect, it } from 'vitest';
import { bareChassisCheck, silhouetteCoverage } from '../src/spec/silhouette.js';

/** The 12 triangles of a box between two corners (9 floats each). */
function box(lo: number[], hi: number[]): number[] {
  const c = (i: number) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  return faces.flatMap(([a, b, cc, d]) => [...c(a), ...c(b), ...c(cc), ...c(a), ...c(cc), ...c(d)]);
}

/** A 4.5 m car's wheels: 0.35 m radius at ±0.8 m, ±1.5 m. */
const wheels = [[0.8, 1.5], [-0.8, 1.5], [0.8, -1.5], [-0.8, -1.5]].map(([x, z]) => ({ pos: [x, 0.35, z], radius: 0.35 }));

describe('silhouette coverage and the bare-chassis check (CS-FB-008 follow-up)', () => {
  it('covers what a box shows, from above and from the side', () => {
    const b = box([-1, 0, -2], [0, 1, 2]);
    expect(silhouetteCoverage(b, 0, 2, [-1, -2, 1, 2])).toBeCloseTo(0.5, 2);
    expect(silhouetteCoverage(b, 2, 1, [-2, 0, 2, 1])).toBe(1);
    expect(silhouetteCoverage(b, 2, 1, [-2, 0, 2, 0])).toBe(0);
  });

  it('a body shell is bodied; a frame of rails with a roll cage is a bare chassis; an open-wheeler is not flagged', () => {
    const body = box([-1, 0.15, -2.25], [1, 1.4, 2.25]);
    expect(bareChassisCheck(body, wheels)).toBeNull();
    // Side rails and cross members (a floor seen from above) plus a cage of thin tubes: open from the side.
    const frame = [
      ...box([-1, 0.15, -2.2], [1, 0.25, 2.2]),
      ...[-0.9, 0.9].flatMap((x) => [-1, 0, 1].flatMap((z) => box([x - 0.03, 0.25, z - 0.03], [x + 0.03, 1.3, z + 0.03]))),
      ...[-1, 0, 1].flatMap((z) => box([-0.9, 1.25, z - 0.03], [0.9, 1.3, z + 0.03])),
    ];
    const bare = bareChassisCheck(frame, wheels);
    expect(bare).not.toBeNull();
    expect(bare!.top).toBeGreaterThan(0.85);
    expect(bare!.side).toBeLessThan(0.7);
    // A narrow tub between the wheels: it does not fill the wheelbase from above.
    expect(bareChassisCheck(box([-0.4, 0.1, -2], [0.4, 0.9, 2.2]), wheels)).toBeNull();
    expect(bareChassisCheck(frame, wheels.slice(0, 2))).toBeNull();
  });
});
