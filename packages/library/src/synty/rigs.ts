/**
 * Rig profiles: which skeleton a Synty (or Mixamo) character or clip uses, and how its bones map onto the canonical
 * humanoid. Ported from the old generator's apps/server/src/rigs.ts (a mirror of worker/synty/rigs.py, which the
 * Blender retarget uses with the same JSON files) with the profiles of worker/rigs/*.json (copied to ./rigs) and
 * the tests of apps/server/test/rigs.test.ts and worker/tests/test_synty.py. Saving a profile is not ported: this
 * package never writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RigProfile {
  /** synty_legacy (POLYGON War Character_*), synty_ue (SK_Character_*, SK_Chr_*), mixamo, or a user_* profile. */
  name: string;
  description?: string;
  /** A regex stripped from every bone name before matching (Mixamo's `mixamorig:`). */
  strip_prefix?: string;
  /** canonical bone → native bone name. */
  map: Record<string, string>;
}

interface CanonicalFile {
  description: string;
  bones: string[];
  parents: Record<string, string>;
}

/** The built-in profiles and canonical.json. */
export const RIGS_DIR = fileURLToPath(new URL('./rigs/', import.meta.url));

const canonical = JSON.parse(fs.readFileSync(path.join(RIGS_DIR, 'canonical.json'), 'utf8')) as CanonicalFile;

/** The canonical humanoid bones every profile maps onto, parents first. */
export const CANONICAL: readonly string[] = canonical.bones;
/** Parent of each canonical bone (hips has none). */
export const CANONICAL_PARENTS: Readonly<Record<string, string>> = canonical.parents;

/** The names the old data uses for the rig a clip or character has (animations.rig column, meta.rig.profile). */
export type RigKind = 'synty_legacy' | 'synty_ue' | 'mixamo' | (string & {});

/**
 * The profiles: the built-in ones, then any user-confirmed ones from `extraDirs` (the old generator saved those in
 * data/rigs; the Blender worker reads the same folder through SSG_EXTRA_RIGS).
 */
export function loadProfiles(extraDirs: string[] = []): RigProfile[] {
  const out: RigProfile[] = [];
  for (const d of [RIGS_DIR, ...extraDirs]) {
    for (const f of fs.existsSync(d) ? fs.readdirSync(d).sort() : []) {
      if (f.endsWith('.json') && f !== 'canonical.json') out.push(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) as RigProfile);
    }
  }
  return out;
}

export const BUILTIN_PROFILES: readonly RigProfile[] = loadProfiles();

/** The canonical bones a profile finds in a skeleton: {canonical: native bone name}. */
export function matchProfile(profile: RigProfile, bones: string[]): Record<string, string> {
  const strip = profile.strip_prefix ? new RegExp(profile.strip_prefix) : null;
  const byStripped = new Map(bones.map((b) => [(strip ? b.replace(strip, '') : b).toLowerCase(), b]));
  const found: Record<string, string> = {};
  for (const [canon, native] of Object.entries(profile.map)) {
    const hit = byStripped.get(native.toLowerCase());
    if (hit) found[canon] = hit;
  }
  return found;
}

export interface RigDetection {
  profile: string;
  /** Share of the canonical bones found (1 = all). */
  score: number;
  map: Record<string, string>;
}

/** Pick the best profile for a skeleton, or null when none finds at least `minScore` of the canonical bones. */
export function detect(bones: string[], profiles: readonly RigProfile[] = BUILTIN_PROFILES, minScore = 0.9): RigDetection | null {
  let best: RigDetection | null = null;
  for (const p of profiles) {
    const map = matchProfile(p, bones);
    const score = Object.keys(map).length / CANONICAL.length;
    if (!best || score > best.score) best = { profile: p.name, score, map };
  }
  return best && best.score >= minScore ? best : null;
}

const IGNORE = /thumb|index|middle|ring|pinky|finger|twist|_end$|end$|nub|ik_|_ik|pole|roll|target|eye|jaw|brow|toe_?end|headtop|prop|weapon|attach/i;

function tokens(bone: string): string[] {
  return bone
    .replace(/^.*[:|]/, '') // namespaces: mixamorig:Hips, Armature|Hips
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function side(bone: string): 'l' | 'r' | null {
  const t = tokens(bone);
  if (t.some((x) => x === 'l' || x === 'left') || /\.l$|_l$/i.test(bone)) return 'l';
  if (t.some((x) => x === 'r' || x === 'right') || /\.r$|_r$/i.test(bone)) return 'r';
  return null;
}

/**
 * Propose a canonical mapping for an unknown rig. Chains are matched by order (bones arrive parents-first
 * from Blender), which handles naming differences like Mixamo's LeftShoulder (= clavicle) vs Synty's
 * Shoulder_L (= upper arm): the first arm-ish bone on a side is the clavicle only if four exist.
 */
export function propose(bones: string[]): { map: Record<string, string>; missing: string[] } {
  const map: Record<string, string> = {};
  const usable = bones.filter((b) => !IGNORE.test(b.replace(/^.*[:|]/, '')));
  const has = (b: string, re: RegExp) => tokens(b).some((t) => re.test(t)) || re.test(tokens(b).join('_'));

  const hips = usable.find((b) => has(b, /^(hips?|pelvis|cog)$/));
  if (hips) map.hips = hips;
  const spine = usable.filter((b) => has(b, /^(spine\d*|chest|upper_?chest|torso)$/) && !side(b));
  if (spine.length >= 3) {
    map.spine1 = spine[0]!;
    map.spine2 = spine[Math.floor(spine.length / 2)]!;
    map.spine3 = spine[spine.length - 1]!;
  } else spine.forEach((b, i) => (map[`spine${i + 1}`] = b));
  const neck = usable.find((b) => has(b, /^neck\d*$/));
  if (neck) map.neck = neck;
  const head = usable.find((b) => has(b, /^head$/));
  if (head) map.head = head;

  for (const s of ['l', 'r'] as const) {
    const arm = usable.filter((b) => side(b) === s && has(b, /^(clavicle|collar|shoulder|upper_?arm|arm|fore_?arm|lower_?arm|elbow|hand|wrist)$|upperarm|forearm|lowerarm/));
    const armNames = arm.length >= 4 ? ['clavicle', 'upperarm', 'lowerarm', 'hand'] : ['upperarm', 'lowerarm', 'hand'];
    armNames.forEach((n, i) => {
      const b = arm[i];
      if (b) map[`${n}_${s}`] = b;
    });
    const leg = usable.filter((b) => side(b) === s && has(b, /^(thigh|up_?leg|upper_?leg|leg|calf|shin|knee|lower_?leg|foot|ankle|toe|toes|ball)$|upleg|upperleg|lowerleg|toebase/));
    ['thigh', 'calf', 'foot', 'toe'].forEach((n, i) => {
      const b = leg[i];
      if (b) map[`${n}_${s}`] = b;
    });
  }
  const missing = CANONICAL.filter((c) => !map[c]);
  return { map, missing };
}
