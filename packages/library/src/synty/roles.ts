/**
 * Part roles of rigid multi-part Synty models (wheel, door, propeller, turret…). Ported from the old generator's
 * apps/server/src/roles.ts (itself a port of worker/synty/roles.py) with the rules of worker/roles.json (copied
 * here as roles.json) and the tests of apps/server/test/roles.test.ts and worker/tests/test_synty.py. The old
 * server applied the rules when assets were read; a person's override (part_overrides table) won over them.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

interface RoleRule {
  role: string;
  pattern: RegExp;
}

interface RolesFile {
  description: string;
  rules: { role: string; pattern: string }[];
}

export const ROLES_FILE = fileURLToPath(new URL('./roles.json', import.meta.url));

/** The rules in order: first match wins (a steering wheel matches `steering` before the generic `wheel` rule). */
export const ROLE_RULES: readonly RoleRule[] = (JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8')) as RolesFile).rules.map((r) => ({
  role: r.role,
  pattern: new RegExp(r.pattern, 'i'),
}));

/** Every role the rules can give, in rule order. */
export const ROLES: readonly string[] = [...new Set(ROLE_RULES.map((r) => r.role))];

/** ('SM_Veh_Car_Ambo_Door_l', 'SM_Veh_Car_Ambo_01') -> 'Door_l' */
export function localName(part: string, asset: string): string {
  const p = part.split('_');
  let a = asset.split('_');
  // Parts often drop the asset's SM_/SK_ prefix ('Prop_Lecturn_01_Fabric_01' in 'SM_Prop_Lecturn_01').
  if (a.length && /^(sm|sk)$/i.test(a[0]!) && p.length && p[0]!.toLowerCase() !== a[0]!.toLowerCase()) a = a.slice(1);
  let i = 0;
  while (i < Math.min(p.length, a.length) && p[i]!.toLowerCase() === a[i]!.toLowerCase()) i++;
  return (p.slice(i).length ? p.slice(i) : p.slice(-1)).join('_');
}

/** The rules' role for a part of an asset, or null when no rule matches. */
export function roleFor(part: string, asset: string): string | null {
  const name = localName(part, asset);
  return ROLE_RULES.find((r) => r.pattern.test(name))?.role ?? null;
}

export interface PartLike {
  name: string;
  pivot?: number[];
  bbox_min?: number[];
  bbox_max?: number[];
}

const metres = (v: number[] | undefined, scale: number) => (v ? v.map((x) => +(x * scale).toFixed(3)) : undefined);

/**
 * A part's box and pivot in metres (the model's scale fix applied; the raw `bbox_min/max` and `pivot` are in the
 * model's own units, often centimetres read as metres).
 */
export function partMetres(p: PartLike, scale: number): { minM?: number[]; maxM?: number[]; sizeM?: number[]; pivotM?: number[] } {
  const min = metres(p.bbox_min, scale);
  const max = metres(p.bbox_max, scale);
  return {
    ...(min && max ? { minM: min, maxM: max, sizeM: max.map((v, i) => +(v - (min[i] ?? 0)).toFixed(3)) } : {}),
    ...(p.pivot ? { pivotM: metres(p.pivot, scale) } : {}),
  };
}
