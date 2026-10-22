/**
 * Synty scale fixes. Some Synty FBX carry metre geometry *and* a 0.01 object scale, so they import 100× too small
 * (a POLYGON City hydrant comes in 1 cm tall); a few are off by another factor (POLYGON War's bayonets 10× too big,
 * its German pistol 10× too big: see scale-overrides.json). Ported from the old generator's
 * apps/server/src/scale.ts (scaleGroupOf, baseScaleFix, autoScaleFix, isPackDoubleScaled, isGroupDoubleScaled,
 * extentOf, the pack verdict of scaleFixer) and packages/shared/src/plausibleSize.ts (plausibleSizeOf,
 * unitCheckedFix, sizeSuspectFor), with their tests (apps/server/test/scale.test.ts, plausibleSize.test.ts).
 */

/** The naming group whose scale is judged per pack: Synty buildings (`_Bld_`) and environment pieces (`_Env_`). */
export type ScaleGroup = 'Bld' | 'Env';
export const scaleGroupOf = (name: string): ScaleGroup | null => {
  const m = /_(Bld|Env)_/i.exec(name);
  return m ? (m[1]!.toLowerCase() === 'bld' ? 'Bld' : 'Env') : null;
};

/**
 * Whether a small model is broken depends on its pack: in a double-scaled pack (most props measure centimetres)
 * small props are broken; in a correctly scaled pack a 5 cm coin is real. A saved override always wins.
 *
 * Buildings and environment pieces are judged by their own group in the pack (`groupDoubleScaled`, see
 * isGroupDoubleScaled): in POLYGON War and City those import 100× too small while the same pack's props may not, and
 * in most packs they are right, where a 1.6 m bush must stay 1.6 m (FB-048). Without a group verdict the pack's own
 * one is used.
 */
export function autoScaleFix(name: string, kind: string, extent: number | null, packDoubleScaled = false, groupDoubleScaled?: boolean | null): number {
  const fix = baseScaleFix(name, kind, extent, packDoubleScaled, groupDoubleScaled);
  // FB-071: a model of a known kind (grenade, pistol, rifle…) that the pack's verdict makes 100× off its real size
  // (POLYGON War's American grenade: metres in a centimetre pack, 16 m after ×100) takes the other answer.
  if (!extent || kind === 'character' || kind === 'rigged' || kind === 'vehicle') return fix;
  return unitCheckedFix(name, extent, fix);
}

/** The fix from the pack's and group's verdicts and the name rules alone, before the unit check. */
export function baseScaleFix(name: string, kind: string, extent: number | null, packDoubleScaled = false, groupDoubleScaled?: boolean | null): number {
  if (!extent || kind === 'character' || kind === 'rigged' || kind === 'vehicle') return 1;
  if (kind === 'attachment') return extent < 0.03 ? 100 : 1;
  const group = scaleGroupOf(name);
  if (group) {
    // A double-scaled group: nothing in it is under 2 m for real (buildings, roads, background cliffs and trees).
    if (groupDoubleScaled ?? packDoubleScaled) return extent < 2 ? 100 : 1;
    // A correctly scaled group: only a model no real building piece (10 cm: Palm City's trims are 14 cm) or scenery
    // piece (4 cm: rubble stones in POLYGON BattleRoyale; Adventure's pebbles are 5 cm and real) could be.
    return extent < (group === 'Bld' ? 0.1 : 0.04) ? 100 : 1;
  }
  // Hand blades are never metres long: POLYGON War's bayonets import 10× too big (4–5 m).
  if (/bayonet|knife|dagger|machete/i.test(name) && extent > 1.5) return 0.1;
  if (packDoubleScaled) return extent < 0.5 ? 100 : 1;
  // Tiny separate weapon parts (a minigun's button, a trigger) are real in a correctly scaled pack.
  if (/_(Button|Trigger|Pin|Switch|Screw|Safety|Bolt)(_|\d|$)/i.test(name)) return 1;
  return extent < 0.02 ? 100 : 1;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** A pack is double-scaled when the typical prop in it measures under 10 cm. */
export function isPackDoubleScaled(propExtents: number[]): boolean {
  if (propExtents.length < 5) return false;
  return median(propExtents) < 0.1;
}

/**
 * A pack's buildings (or environment pieces) are double-scaled when the typical one measures under 50 cm: real
 * ones are metres (medians 2–10 m in every correctly scaled pack), broken ones centimetres. Null: too few to tell.
 */
export function isGroupDoubleScaled(extents: number[]): boolean | null {
  if (extents.length < 5) return null;
  return median(extents) < 0.5;
}

export interface Bounds {
  min: number[];
  max: number[];
}

/** The largest side of a model's measured bounds (as imported, before any fix). */
export const extentOf = (meta: { bounds?: Bounds | null } | null | undefined): number | null =>
  meta?.bounds ? Math.max(...meta.bounds.max.map((v, i) => v - (meta.bounds!.min[i] ?? 0))) : null;

/** What a pack's measured models say about its units (isPackDoubleScaled, isGroupDoubleScaled). */
export interface PackScaleVerdict {
  /** The pack's props measure centimetres. */
  double: boolean;
  groups: Record<ScaleGroup, boolean | null>;
}

/**
 * The verdict for a pack from its props, multipart models and weapons (`extent` = extentOf their meta, as imported).
 * The old server computed this per pack from the rows of kind prop/multipart/weapon with status ready.
 */
export function packScaleVerdict(models: { name: string; extent: number | null }[]): PackScaleVerdict {
  const props: number[] = [];
  const groups: Record<ScaleGroup, number[]> = { Bld: [], Env: [] };
  for (const m of models) {
    if (m.extent === null) continue;
    props.push(m.extent);
    const g = scaleGroupOf(m.name);
    if (g && m.extent > 0) groups[g].push(m.extent);
  }
  return { double: isPackDoubleScaled(props), groups: { Bld: isGroupDoubleScaled(groups.Bld), Env: isGroupDoubleScaled(groups.Env) } };
}

/** The automatic fix for one model given its pack's verdict. */
export function scaleFixFor(a: { name: string; kind: string }, extent: number | null, verdict: PackScaleVerdict): number {
  const g = scaleGroupOf(a.name);
  return autoScaleFix(a.name, a.kind, extent, verdict.double, g ? verdict.groups[g] : undefined);
}

// ---- plausible sizes by name (FB-071) -------------------------------------------------------------

export interface PlausibleSize {
  /** What the name says the model is ("grenade", "pistol"…). */
  what: string;
  /** The largest side's range in metres. */
  min: number;
  max: number;
}

/**
 * Names that are not the thing itself: parts, holders and containers of it (a rifle rack, an ammo crate, a
 * grenade box, a pistol holster, a rifle's slide or handle), effects, icons, decals and giant versions.
 */
const NOT_THE_THING = /(^|_)fx_|^fx|icon|decal|hole|trail|giant|rack|stand|crate|box|case|holster|pouch|belt|bag|pack|mount|tripod|table|shelf|pile|stack|sign|poster|_(button|trigger|pin|switch|screw|safety|bolt|lever|sight|slide|handle|charge|hammer|top|body|part|base|stock|grip|guard)(_|\d|$)/i;
/** Ammunition other than a bullet (a pistol's ammo box, shotgun shells) is no gun. */
const AMMO = /ammo|shell|casing/i;

/** First match wins: the specific before the general (a rifle's clip or scope before the rifle, a launcher before a grenade). */
const TABLE: [RegExp, PlausibleSize][] = [
  [/bullet(?!.*casing)|cartridge/i, { what: 'bullet', min: 0.005, max: 0.3 }],
  [/(^|_)(mag|magazine|clip)(_|\d|$)/i, { what: 'magazine', min: 0.03, max: 0.5 }],
  [/(?<!tele)scope/i, { what: 'scope', min: 0.1, max: 0.7 }],
  [/^(?!.*arrow).*(rocketlauncher|rocket_launcher|launcher|bazooka|(^|_)rpg(_|\d|$)|panzer(faust|schreck))/i, { what: 'launcher', min: 0.6, max: 2.2 }],
  [/grenade/i, { what: 'grenade', min: 0.05, max: 0.5 }],
  [/pistol|revolver|handgun|luger|(^|_)colt(_|\d|$)/i, { what: 'pistol', min: 0.1, max: 0.65 }],
  [/machete/i, { what: 'machete', min: 0.3, max: 1.2 }],
  [/bayonet/i, { what: 'bayonet', min: 0.15, max: 0.9 }],
  [/knife|dagger/i, { what: 'knife', min: 0.1, max: 0.7 }],
  [/heavymachinegun|heavy_machine_gun/i, { what: 'heavy machine gun', min: 0.8, max: 2.5 }],
  [/rifle|carbine|machinegun|machine_gun|smg|shotgun/i, { what: 'rifle', min: 0.4, max: 2.0 }],
  [/mortar/i, { what: 'mortar', min: 0.3, max: 1.8 }],
  [/sword|katana|sabre|saber/i, { what: 'sword', min: 0.4, max: 2.2 }],
  [/medkit|first_?aid/i, { what: 'first-aid kit', min: 0.05, max: 0.8 }],
  [/canteen|flask/i, { what: 'canteen', min: 0.08, max: 0.8 }],
  [/helmet/i, { what: 'helmet', min: 0.15, max: 0.9 }],
  [/bottle/i, { what: 'bottle', min: 0.05, max: 0.8 }],
];

/** The size range the model's name implies, or null when the name says nothing usable about its size. */
export function plausibleSizeOf(name: string): PlausibleSize | null {
  if (NOT_THE_THING.test(name)) return null;
  const hit = TABLE.find(([re]) => re.test(name))?.[1] ?? null;
  if (hit && hit.what !== 'bullet' && AMMO.test(name)) return null;
  return hit;
}

/**
 * The scale fix with a unit check (FB-071): when `fix` makes a model of a known kind implausible (a 16 m grenade)
 * and the other answer to the centimetre question (×1 instead of ×100, or ×100 instead of ×1) makes it plausible,
 * that one. Anything else keeps `fix`: no size for the name, a model off by some other factor (flagged by
 * sizeSuspectFor instead), or one that would need shrinking (a giant sword is meant to be giant).
 */
export function unitCheckedFix(name: string, rawExtent: number | null, fix: number): number {
  const p = plausibleSizeOf(name);
  if (!p || !rawExtent || !(rawExtent > 0)) return fix;
  const ok = (f: number) => rawExtent * f >= p.min && rawExtent * f <= p.max;
  if (ok(fix)) return fix;
  const alt = fix === 100 ? 1 : fix === 1 ? 100 : null;
  return alt !== null && ok(alt) ? alt : fix;
}

export interface SizeSuspect {
  what: string;
  reason: string;
  /** Multiply the current fix by this (a power of ten) to bring the size into range; null when no power of ten does. */
  factor: number | null;
}

/**
 * Why a model's size (metres, after its fix) looks wrong for what its name says it is, with the factor to multiply
 * the current fix by to bring it into range, or null when it looks plausible or the name says nothing.
 * "16.6 m is far too big for a grenade (5 cm–50 cm); ×0.01 would make it 16.6 cm".
 */
export function sizeSuspectFor(name: string, sizeM: number | null): SizeSuspect | null {
  const p = plausibleSizeOf(name);
  if (!p || !sizeM || !(sizeM > 0) || (sizeM >= p.min && sizeM <= p.max)) return null;
  const factor = [0.1, 10, 0.01, 100, 0.001, 1000].find((f) => sizeM * f >= p.min && sizeM * f <= p.max) ?? null;
  const m = (v: number) => (v >= 1 ? `${+v.toFixed(1)} m` : `${+(v * 100).toFixed(1)} cm`);
  return {
    what: p.what,
    factor,
    reason: `${m(sizeM)} is ${sizeM > p.max ? 'far too big' : 'far too small'} for a ${p.what} (${m(p.min)}–${m(p.max)})${factor ? `; ×${factor} would make it ${m(sizeM * factor)}` : ''}`,
  };
}
