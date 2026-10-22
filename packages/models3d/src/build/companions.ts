// Moved from synty-sprite-generator apps/server/src/companions.ts (P3, ali3b/sloponator#14).
import type { ModelCompanion, ModelCompanionSlot } from '../spec/index.js';

/**
 * CS-FB-008: a vehicle's companion pieces in its own pack. Some Synty vehicles ship their body (or bumpers, spoilers,
 * skirts, wheels) as separate assets named after the vehicle: Pro Racer's SM_Veh_Stock_Car_01 is a roll cage on four
 * wheels, and its body is SM_Veh_Stock_Car_01_Body_01..03. `model info` and `search_assets` list them as
 * `companions`, and an export warns when a wheeled vehicle that has body companions attaches none.
 */

/** Words that make an asset named after a vehicle's stem (SM_Veh_Kart_ + Wheel_F_01) one of its pieces. */
const PIECE = /(^|_)(body|bumpers?|spoilers?|side_?skirts?|skirts?|wheels?|attach|bonnet|hood|boot|exhaust|engine|seats?|fenders?|roof_?scoop|scoop|undercarriage|fairing|air_?box|halo|roll_?cage|trailer_?axle|netting|hitch_?cover|screen_?banner|mudflaps?)(_|\d|$)/i;

/** The name without its trailing number (SM_Veh_Stock_Car_01 → SM_Veh_Stock_Car). */
const stemOf = (name: string) => name.replace(/_\d+$/, '');
/** The vehicle's own words (SM_Veh_Stock_Car_01 → stock_car), for `_Attach_` pieces named after it. */
const coreOf = (name: string) => stemOf(name).replace(/^(sm|sk)_(veh|vehicle)_/i, '').toLowerCase();

/** Whether `cand` (an asset of the same pack) is a piece of the vehicle `vehicle`, by name. */
export function isCompanionName(vehicle: string, cand: string): boolean {
  const v = vehicle.toLowerCase(), c = cand.toLowerCase();
  if (!v || c === v) return false;
  // SM_Veh_Stock_Car_01_Body_01: anything named after the whole asset.
  if (c.startsWith(`${v}_`)) return true;
  // SM_Veh_Kart_Wheel_F_01 for SM_Veh_Kart_01: the stem plus a piece word, not another numbered model's piece.
  const stem = stemOf(v);
  if (stem !== v && c.startsWith(`${stem}_`)) {
    const rest = c.slice(stem.length + 1);
    if (!/^\d+(_|$)/.test(rest) && PIECE.test(rest)) return true;
  }
  // SM_Veh_Attach_Stock_Car_Siren_01: an attach piece that names the vehicle.
  const core = coreOf(v);
  return core.length > 2 && /(^|_)attach(_|$)/.test(c) && c.includes(core);
}

/** What a companion is for (`body` first: a vehicle without one exports as a bare chassis). */
export function companionSlot(vehicle: string, cand: string): ModelCompanionSlot {
  const rest = cand.toLowerCase().startsWith(`${vehicle.toLowerCase()}_`) ? cand.slice(vehicle.length + 1) : cand.slice(stemOf(vehicle).length + 1);
  const r = rest.toLowerCase();
  if (/(^|_)attach(_|$)/.test(cand.toLowerCase())) return 'attach';
  if (/(^|_)body(_|\d|$)/.test(r)) return 'body';
  if (/bumper/.test(r)) return 'bumper';
  if (/spoiler/.test(r)) return 'spoiler';
  if (/skirt/.test(r)) return 'skirt';
  if (/wheel/.test(r)) return 'wheel';
  return 'part';
}

const SLOT_ORDER: ModelCompanionSlot[] = ['body', 'bumper', 'spoiler', 'skirt', 'wheel', 'attach', 'part'];

/** The vehicle's companions among `rows` (same pack), body pieces first, then by slot and name. */
export function companionsAmong(vehicle: string, rows: { id: number; name: string; kind: string }[]): ModelCompanion[] {
  return rows
    .filter((r) => isCompanionName(vehicle, r.name))
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, slot: companionSlot(vehicle, r.name) }))
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.name.localeCompare(b.name));
}

/**
 * The companions of an asset among the ready rows of its pack (the library's `assets({ pack })`): the rows named
 * after its stem or `_Attach_` pieces that name it, as the old server's SQL LIKE picked them.
 */
export function companionsOf(asset: { id: number; name: string }, packRows: { id: number; name: string; kind: string }[]): ModelCompanion[] {
  const stem = stemOf(asset.name).toLowerCase(), core = coreOf(asset.name);
  const rows = packRows.filter((r) => r.id !== asset.id && (r.name.toLowerCase().startsWith(`${stem}_`) || /attach/i.test(r.name) && r.name.toLowerCase().includes(core)));
  return companionsAmong(asset.name, rows);
}

/**
 * The export warning for a wheeled vehicle whose body is a separate piece that the spec does not attach (null when
 * there is nothing to say).
 */
export function missingBodyWarning(asset: string, companions: ModelCompanion[], attach: string[], hasRoadWheels: boolean): string | null {
  const bodies = companions.filter((c) => c.slot === 'body');
  if (!hasRoadWheels || !bodies.length) return null;
  const asked = new Set(attach.map((x) => x.toLowerCase().replace(/^.*\//, '')));
  if (bodies.some((b) => asked.has(b.name.toLowerCase()) || asked.has(String(b.id)))) return null;
  return `no body mesh: ${asset}'s body is a separate piece, so this is a bare chassis; attach one of ${bodies.map((b) => b.name).join(', ')} (attach: ["${bodies[0].name}"])`;
}
