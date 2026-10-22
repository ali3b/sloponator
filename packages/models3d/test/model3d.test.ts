import { describe, expect, it } from 'vitest';
// Moved from synty-sprite-generator packages/shared/src/model3d/model3d.test.ts (P3, ali3b/sloponator#14); the preview option tests stayed (previews are deferred).
import { boundsOf, clipGenderOf, parseClipRef, colliderOf, defaultTexSize, fitScale, hingesOf, isRoadWheel, isSpinRole, mapWheels, normaliseSpec, parseTint, safeModelName, specHash, wheelSlotOf } from '../src/index.js';

describe('model3d spec and manifest helpers', () => {
  it('wheel slots from Synty and other part names', () => {
    expect(wheelSlotOf('SM_Veh_Pickup_Lift_01_Wheel_FL')).toBe('fl');
    expect(wheelSlotOf('SM_Veh_Car_Wheel_fr')).toBe('fr');
    expect(wheelSlotOf('Wheel_Rear_Left')).toBe('rl');
    expect(wheelSlotOf('Wheel_R_R')).toBe('rr');
    expect(wheelSlotOf('Wheel_F_R')).toBe('fr');
    expect(wheelSlotOf('FrontLeftWheel')).toBe('fl');
    expect(wheelSlotOf('Wheel_LF')).toBe('fl');
    expect(wheelSlotOf('Wheel_01')).toBeNull();
    expect(wheelSlotOf('Door_FL')).toBeNull();
  });

  it('maps four wheels by name, else by position (front +Z, left +X)', () => {
    const named = mapWheels(['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map((node, i) => ({ node, pos: [0, 0, i] as [number, number, number] })));
    expect(named!.fl.node).toBe('Wheel_FL');
    const byPos = mapWheels([
      { node: 'Wheel_01', pos: [0.8, 0.3, 1.4] },
      { node: 'Wheel_02', pos: [-0.8, 0.3, 1.4] },
      { node: 'Wheel_03', pos: [0.8, 0.3, -1.4] },
      { node: 'Wheel_04', pos: [-0.8, 0.3, -1.4] },
      { node: 'Wheel_05', pos: [0.8, 0.3, -0.4] },
    ]);
    expect(Object.fromEntries(Object.entries(byPos!).map(([k, w]) => [k, w.node]))).toEqual({ fl: 'Wheel_01', fr: 'Wheel_02', rl: 'Wheel_03', rr: 'Wheel_04' });
    expect(mapWheels([{ node: 'Wheel_FL', pos: [0, 0, 0] }])).toBeNull();
  });

  it('bounds, collider, tint and names', () => {
    const b = boundsOf([-1, 0, -2], [1, 1.5, 2]);
    expect(b.size).toEqual([2, 1.5, 4]);
    expect(colliderOf(b)).toEqual({ box: { center: [0, 0.75, 0], size: [2, 1.5, 4] } });
    expect(parseTint('#f80')).toEqual([1, 0x88 / 255, 0]);
    expect(parseTint('nope')).toBeNull();
    expect(safeModelName(' Monster Truck #2 ')).toBe('Monster_Truck_2');
  });

  it('the hash is stable for one spec, whatever the key order or defaults', () => {
    const a = specHash({ asset: 7, clips: ['Idle'], origin: 'bottom-centre' });
    expect(specHash(normaliseSpec({ origin: 'bottom-centre', clips: ['Idle'], asset: '7' }))).toBe(a);
    expect(specHash({ asset: 7, clips: ['Idle'], origin: 'pivot' })).not.toBe(a);
    expect(a).toBe(specHash({ asset: 7, clips: ['Idle'] }));
    // replaceWheels: true is the default (same hash); false is another model.
    expect(specHash({ asset: 7, clips: ['Idle'], replaceWheels: true })).toBe(a);
    expect(normaliseSpec({ asset: 7, replaceWheels: false }).replaceWheels).toBe(false);
    expect(specHash({ asset: 7, clips: ['Idle'], replaceWheels: false })).not.toBe(a);
  });

  it('defaults: webp textures, a texture size by kind, no compression (OR-FB-004)', () => {
    expect(normaliseSpec({ asset: 7 }).texFormat).toBe('webp');
    expect(specHash({ asset: 7, texFormat: 'webp', compress: 'none' })).toBe(specHash({ asset: 7 }));
    expect([defaultTexSize('prop'), defaultTexSize('vehicle'), defaultTexSize('character'), defaultTexSize('multipart'), defaultTexSize(undefined)]).toEqual([256, 1024, 1024, 512, 256]);
  });

  it('keeps attachment and clip order (it is part of the model: OR-W16-3)', () => {
    const n = normaliseSpec({ asset: 7, attach: ['Lift', 'Roofrack', 'lift'], clips: ['Walk', 'Idle'] });
    expect(n.attach).toEqual(['Lift', 'Roofrack']);
    expect(n.clips).toEqual(['Walk', 'Idle']);
    expect(specHash({ asset: 7, attach: ['Lift', 'Roofrack'] })).not.toBe(specHash({ asset: 7, attach: ['Roofrack', 'Lift'] }));
  });

  it('road wheels leave the steering wheel out', () => {
    expect(isRoadWheel({ node: 'SM_Veh_Pickup_01_Wheel_FL', role: 'wheel' })).toBe(true);
    expect(isRoadWheel({ node: 'SM_Veh_Pickup_01_Steering_Wheel', role: 'wheel' })).toBe(false);
    expect(isRoadWheel({ name: 'Wheel_FL', role: 'static' })).toBe(false);
  });

  it('fit: normalised into the spec (and its hash), the smallest scale wins', () => {
    expect(normaliseSpec({ asset: 1, fit: { length: 4.5 } })).toMatchObject({ fit: { length: 4.5 } });
    expect(normaliseSpec({ asset: 1, fit: {} }).fit).toBeUndefined();
    expect(specHash({ asset: 1, fit: { length: 4.5 } })).not.toBe(specHash({ asset: 1 }));
    expect(specHash({ asset: 1, fit: { length: 4.5, width: 2 } })).toBe(specHash({ asset: 1, fit: { width: 2, length: 4.5 } }));
    expect(() => normaliseSpec({ asset: 1, fit: { length: -1 } })).toThrow(/fit.length/);
    expect(() => normaliseSpec({ asset: 1, fit: { depth: 2 } as never })).toThrow(/length, width and height/);
    expect(fitScale([2, 1.5, 4], { length: 4.5 })).toBeCloseTo(1.125);
    expect(fitScale([2, 1.5, 4], { length: 4.5, width: 1 })).toBeCloseTo(0.5);
    expect(fitScale([2, 1.5, 4], { height: 3 })).toBeCloseTo(2);
    expect(fitScale([2, 1.5, 4], undefined)).toBe(1);
  });

  it('pose and poses: normalised (time default 0), checked, in the hash only when given (OR-FB-012)', () => {
    expect(normaliseSpec({ asset: 1, pose: { clip: ' Wave ' } }).pose).toEqual({ clip: 'Wave', time: 0 });
    expect(normaliseSpec({ asset: 1, poses: [{ name: 'wave a', clip: 'Wave', time: 0.25 }] }).poses).toEqual([{ name: 'wave_a', clip: 'Wave', time: 0.25 }]);
    expect(normaliseSpec({ asset: 1 })).not.toHaveProperty('pose');
    expect(specHash({ asset: 1, pose: { clip: 'Wave' } })).toBe(specHash({ asset: 1, pose: { clip: 'Wave', time: 0 } }));
    expect(specHash({ asset: 1, pose: { clip: 'Wave', time: 0.2 } })).not.toBe(specHash({ asset: 1, pose: { clip: 'Wave' } }));
    expect(() => normaliseSpec({ asset: 1, pose: { clip: 'Wave' }, clips: ['Idle'] })).toThrow(/leave clips out/);
    expect(() => normaliseSpec({ asset: 1, pose: { clip: 'Wave' }, poses: [{ name: 'a', clip: 'Wave' }] })).toThrow(/not both/);
    expect(() => normaliseSpec({ asset: 1, pose: { clip: 'Wave', time: -1 } })).toThrow(/pose.time/);
    expect(() => normaliseSpec({ asset: 1, pose: { clip: '' } })).toThrow(/pose.clip/);
    expect(() => normaliseSpec({ asset: 1, poses: [{ clip: 'Wave' } as never] })).toThrow(/needs a name/);
    expect(() => normaliseSpec({ asset: 1, poses: [{ name: 'a', clip: 'W', speed: 2 } as never] })).toThrow(/takes name, clip, time/);
  });

  it('clip refs: an id, or a name with @ qualifiers (OR-FB-010)', () => {
    expect(parseClipRef('859')).toEqual({ id: 859 });
    expect(parseClipRef('Idle')).toEqual({ name: 'Idle', quals: [] });
    expect(parseClipRef(' Idle@Feminine@Sidekick ')).toEqual({ name: 'Idle', quals: ['Feminine', 'Sidekick'] });
    expect(['masculine', 'Male', 'm'].map(clipGenderOf)).toEqual(['Masculine', 'Masculine', 'Masculine']);
    expect(clipGenderOf('female')).toBe('Feminine');
    expect(clipGenderOf('Sidekick')).toBeNull();
  });

  it('spin roles and door / lid hinges from their boxes', () => {
    expect(['wheel', 'propeller', 'track'].every(isSpinRole)).toBe(true);
    expect(isSpinRole('static')).toBe(false);
    expect(isSpinRole('door')).toBe(false);
    // A car 2 m wide, 1.5 m tall, 4 m long (front +Z, left +X).
    const model = { min: [-1, 0, -2], max: [1, 1.5, 2] };
    const h = hingesOf(
      [
        { name: 'Door_L', role: 'door', min: [0.95, 0.4, 0], max: [1, 1.2, 1] },
        { name: 'Door_L_Glass', role: 'door', min: [0.97, 1, 0.1], max: [0.98, 1.4, 0.9] },
        { name: 'Door_R', role: 'door', min: [-1, 0.4, 0], max: [-0.95, 1.2, 1] },
        { name: 'Bonnet', role: 'lid', min: [-0.8, 1, 1], max: [0.8, 1.05, 2] },
        { name: 'Boot', role: 'lid', min: [-0.8, 1, -2], max: [0.8, 1.05, -1.2] },
        { name: 'Tailgate', role: 'door', min: [-0.8, 0.4, -2], max: [0.8, 1, -1.95] },
        { name: 'Hatch', role: 'door', min: [-0.8, 0.6, -2], max: [0.8, 1.45, -1.9] },
        { name: 'Gearstick', role: 'static', min: [0, 0.5, 0.5], max: [0.1, 0.7, 0.6] },
      ],
      model,
    );
    // Side doors: the front edge, the rear edge swinging out (a positive angle about the axis).
    expect(h.get('Door_L')).toEqual({ pos: [0.975, 0.8, 1], axis: [0, -1, 0] });
    expect(h.get('Door_R')).toEqual({ pos: [-0.975, 0.8, 1], axis: [0, 1, 0] });
    // The window in a door turns with the door.
    expect(h.get('Door_L_Glass')).toEqual(h.get('Door_L'));
    // Bonnet and boot: the edge nearest the cabin, lifting up.
    expect(h.get('Bonnet')).toEqual({ pos: [0, 1.05, 1], axis: [-1, 0, 0] });
    expect(h.get('Boot')).toEqual({ pos: [0, 1.05, -1.2], axis: [1, 0, 0] });
    // A tailgate folds down about its bottom edge; a hatch reaching the roof lifts about its top edge.
    expect(h.get('Tailgate')).toEqual({ pos: [0, 0.4, -1.975], axis: [-1, 0, 0] });
    expect(h.get('Hatch')).toEqual({ pos: [0, 1.45, -1.95], axis: [1, 0, 0] });
    expect(h.has('Gearstick')).toBe(false);
  });
});

describe('the wave 3 spec fields (CS-FB-025/026/028)', () => {
  it('specs check lods, paint and decals', () => {
    expect(normaliseSpec({ asset: 1, lods: '0.5,0.2' as unknown as number[] }).lods).toEqual([0.5, 0.2]);
    expect(() => normaliseSpec({ asset: 1, lods: [0.5, 0.4, 0.3, 0.2, 0.1] })).toThrow(/at most 4/);
    expect(normaliseSpec({ asset: 1, paint: 'Body_Paint' }).paint).toBe('Body_Paint');
    expect(() => normaliseSpec({ asset: 1, decals: 'no' as unknown as boolean })).toThrow(/decals/);
    // Defaults hash as before.
    expect(specHash({ asset: 1, decals: true })).toBe(specHash({ asset: 1 }));
    expect(() => normaliseSpec({ trackpiece: { preset: 'straight' }, lods: [0.5] } as never)).toThrow(/lods/);
  });
});

describe('composite parts take paint and decals (CS-FB-024 with CS-FB-026/028)', () => {
  it('passes them through, checked', () => {
    const n = normaliseSpec({ composite: { parts: [{ asset: 'A', tint: '#c62828', decals: false, paint: '#E3B52F' }, { asset: 'B', decals: true }] } } as never);
    expect(n.composite!.parts[0]).toMatchObject({ tint: '#c62828', decals: false, paint: '#e3b52f' });
    expect(n.composite!.parts[1].decals).toBeUndefined();
    expect(() => normaliseSpec({ composite: { parts: [{ asset: 'A', decals: 'no' }] } } as never)).toThrow(/decals/);
    expect(() => normaliseSpec({ composite: { parts: [{ asset: 'A' }] }, lods: [0.5] } as never)).toThrow(/lods/);
  });
});
