// Moved from the old generator's packages/shared/src/map/sheet.ts (ali3b/sloponator#17, #18).
import type { ObjectBlockLike } from './ops.js';
import type { MapObject } from './types.js';
import type { ObjectPicture } from './preview.js';

/**
 * Reading a sprite export's frames (pure, no zip or PNG code): the server's map preview and the web map editor both
 * draw placed objects from one frame of the sprite's newest export. Give `readSheetFiles` the export's files (JSON
 * and PNG, already unzipped, `previews/` left out); it understands every format that carries frame rectangles:
 * generic / `.sheet.json`, Phaser multiatlas + anims, TexturePacker hash or array.
 */

export interface SheetFrame {
  clip: string;
  direction: string;
  index: number;
  page: string;
  x: number; y: number; w: number; h: number;
  trimX: number; trimY: number; sourceW: number; sourceH: number;
  flipX: boolean;
}

export interface SheetObjectBlock extends ObjectBlockLike {
  anchor?: { x: number; y: number } | null;
  pixelsPerMetre?: number | null;
  directions?: { name: string; mirrorOf?: string | null; anchor?: { x: number; y: number }; tiles?: { u: number; v: number } }[];
  slices?: { directions?: { name: string; strips: { x: number; y: number; w: number; h: number; sortY: number }[] }[] } | null;
  states?: { name: string }[];
}

export interface SheetInfo {
  object: SheetObjectBlock | null;
  pixelsPerMetre: number | null;
  pivot: { x: number; y: number } | null;
  frames: SheetFrame[];
  /** Direction order and mirrors, from the object block or the sheet data. */
  directions: { name: string; mirrorOf: string | null }[];
  files: Map<string, Uint8Array>;
}

type Json = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const utf8 = new TextDecoder();

/** "still_SE_0" / "Bunker/still_SE_0" → clip, direction, index. */
function parseFrameName(name: string): { clip: string; direction: string; index: number } | null {
  const m = /^(?:.*\/)?(.+)_([^_/]+)_(\d+)$/.exec(name);
  return m ? { clip: m[1], direction: m[2], index: Number(m[3]) } : null;
}

/** Strip one top-level folder when every file is under it (a batch zip is a folder per model). */
export function flattenSheetFiles(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const names = [...files.keys()].filter((n) => !n.startsWith('previews/'));
  const first = names[0] ?? '';
  const prefix = first.includes('/') ? first.slice(0, first.indexOf('/') + 1) : '';
  if (!prefix || !names.every((n) => n.startsWith(prefix))) return files;
  return new Map([...files].map(([n, v]) => [n.startsWith(prefix) ? n.slice(prefix.length) : n, v]));
}

/** Only the files `readSheetFiles` needs from an export zip (a filter for unzip). */
export const isSheetFile = (name: string) => !name.startsWith('previews/') && /\.(json|png)$/i.test(name);

/** The frames, object block and scale an export's files describe. */
export function readSheetFiles(input: Map<string, Uint8Array>): SheetInfo {
  const files = flattenSheetFiles(input);
  const json = new Map<string, Json>();
  for (const [n, b] of files)
    if (n.endsWith('.json'))
      try {
        const j = JSON.parse(utf8.decode(b));
        if (j && typeof j === 'object') json.set(n, j as Json);
      } catch {
        /* not JSON we read */
      }
  // The body's base when layered (parts are equipment, not the object).
  const manifest = [...json.entries()].find(([n, j]) => n.endsWith('.layers.json') && j.schema === 'ssg-layers/1')?.[1] as Json | undefined;
  const bodyBase = manifest ? String(manifest.base ?? '') : null;
  const inBody = (n: string) => !bodyBase || n === `${bodyBase}.json` || n === `${bodyBase}.sheet.json` || n === `${bodyBase}.meta.json` || n.startsWith(`${bodyBase}_anims`) || n.endsWith('.layers.json');

  let object: SheetObjectBlock | null = null, ppm: number | null = null, pivot: { x: number; y: number } | null = null;
  const rank = (n: string) => (n.endsWith('.layers.json') ? 0 : n.endsWith('.meta.json') ? 1 : n.endsWith('.sheet.json') ? 2 : 3);
  const order = [...json.keys()].sort((a, b) => rank(a) - rank(b));
  for (const n of order) {
    if (!inBody(n)) continue;
    const j = json.get(n)!;
    if (!object && j.object && typeof j.object === 'object') object = j.object as SheetObjectBlock;
    const scale = j.scale as { pixelsPerMetre?: number | null } | undefined;
    if (ppm === null && typeof scale?.pixelsPerMetre === 'number') ppm = scale.pixelsPerMetre;
    if (ppm === null && typeof j.pixelsPerMetre === 'number') ppm = j.pixelsPerMetre;
    if (!pivot && j.pivot && typeof (j.pivot as { x?: unknown }).x === 'number' && typeof (j.pivot as { y?: unknown }).y === 'number') pivot = j.pivot as { x: number; y: number };
  }
  if (object && typeof object.pixelsPerMetre === 'number') ppm = object.pixelsPerMetre;

  const frames: SheetFrame[] = [];
  let directions: { name: string; mirrorOf: string | null }[] = [];
  // 1. Generic frame data (`{base}.sheet.json`, or the generic format's `{base}.json`).
  const generic = order.filter((n) => inBody(n) && Array.isArray(json.get(n)!.animations) && Array.isArray(json.get(n)!.pages));
  if (generic.length) {
    const g = json.get(generic.find((n) => n.endsWith('.sheet.json')) ?? generic[0])!;
    const pages = new Map((g.pages as { index: number; file: string }[]).map((p) => [p.index, p.file]));
    directions = ((g.directions as { name: string; mirrorOf?: string | null }[] | undefined) ?? []).map((d) => ({ name: d.name, mirrorOf: d.mirrorOf ?? null }));
    for (const a of g.animations as { clip: string; direction: string; flipX?: boolean; frames: Json[] }[])
      a.frames.forEach((f, index) =>
        frames.push({
          clip: a.clip, direction: a.direction, index, page: pages.get(num(f.page)) ?? '', flipX: !!a.flipX,
          x: num(f.x), y: num(f.y), w: num(f.w), h: num(f.h), trimX: num(f.trimX), trimY: num(f.trimY), sourceW: num(f.sourceW, num(f.w)), sourceH: num(f.sourceH, num(f.h)),
        }),
      );
  } else {
    // 2. TexturePacker-style frames: Phaser multiatlas (textures[].frames[]), hash (frames{}) or array (frames[]).
    const byName = new Map<string, Omit<SheetFrame, 'clip' | 'direction' | 'index' | 'flipX'>>();
    const add = (name: string, f: Json, page: string) => {
      const fr = f.frame as { x: number; y: number; w: number; h: number } | undefined;
      if (!fr) return;
      const sss = f.spriteSourceSize as { x: number; y: number } | undefined, ss = f.sourceSize as { w: number; h: number } | undefined;
      byName.set(name, { page, x: fr.x, y: fr.y, w: fr.w, h: fr.h, trimX: num(sss?.x), trimY: num(sss?.y), sourceW: num(ss?.w, fr.w), sourceH: num(ss?.h, fr.h) });
    };
    for (const n of order) {
      if (!inBody(n)) continue;
      const j = json.get(n)!;
      if (Array.isArray(j.textures)) for (const t of j.textures as { image: string; frames: (Json & { filename: string })[] }[]) for (const f of t.frames ?? []) add(f.filename, f, t.image);
      const meta = j.meta as { image?: string } | undefined;
      if (meta?.image && j.frames && typeof j.frames === 'object') {
        if (Array.isArray(j.frames)) for (const f of j.frames as (Json & { filename: string })[]) add(f.filename, f, meta.image);
        else for (const [name, f] of Object.entries(j.frames as Record<string, Json>)) add(name, f, meta.image);
      }
    }
    // Phaser anims name the frames of each animation (mirrored directions reuse their source's, with flipX).
    const anims = order.flatMap((n) => (inBody(n) && Array.isArray(json.get(n)!.anims) ? (json.get(n)!.anims as { key: string; flipX?: boolean; frames: { frame: string }[] }[]) : []));
    const used = new Set<string>();
    for (const a of anims) {
      const key = a.key.replace(/^.*\//, '');
      const m = /^(.+)_([^_]+)$/.exec(key);
      if (!m) continue;
      a.frames.forEach((f, index) => {
        const fr = byName.get(f.frame);
        if (!fr) return;
        used.add(f.frame);
        frames.push({ ...fr, clip: m[1], direction: m[2], index, flipX: !!a.flipX });
      });
    }
    for (const [name, fr] of byName) {
      if (used.has(name)) continue;
      const p = parseFrameName(name);
      if (p) frames.push({ ...fr, ...p, flipX: false });
    }
  }
  if (object?.directions?.length) directions = object.directions.map((d) => ({ name: d.name, mirrorOf: d.mirrorOf ?? null }));
  if (!directions.length) directions = [...new Set(frames.map((f) => f.direction))].map((name) => ({ name, mirrorOf: null }));
  return { object, pixelsPerMetre: ppm, pivot, frames, directions, files };
}

/** The frame to show for a state and facing: [frame, the direction it is for, flipped?] (null when none). */
export function pickFrame(info: Pick<SheetInfo, 'frames' | 'directions'>, state?: string, facing?: string): { frame: SheetFrame; direction: string; flipX: boolean; clip: string } | null {
  if (!info.frames.length) return null;
  const clips = [...new Set(info.frames.map((f) => f.clip))];
  const ci = (a: string, b?: string) => !!b && a.toLowerCase() === b.toLowerCase();
  const clip = clips.find((c) => ci(c, state)) ?? clips.find((c) => c === 'still') ?? clips.find((c) => !c.includes('_to_')) ?? clips[0];
  const dir = info.directions.find((d) => ci(d.name, facing)) ?? info.directions[0];
  const name = dir?.name ?? info.frames[0].direction;
  const first = (list: SheetFrame[]) => list.sort((a, b) => a.index - b.index)[0];
  const own = first(info.frames.filter((f) => f.clip === clip && f.direction === name));
  if (own) return { frame: own, direction: name, flipX: own.flipX, clip };
  if (dir?.mirrorOf) {
    const src = first(info.frames.filter((f) => f.clip === clip && f.direction === dir.mirrorOf && !f.flipX));
    if (src) return { frame: src, direction: name, flipX: true, clip };
  }
  const any = first(info.frames.filter((f) => f.clip === clip));
  return any ? { frame: any, direction: any.direction, flipX: any.flipX, clip } : null;
}

/** The states an export holds: its object block's, else its clips (transitions left out). */
export function sheetStates(info: Pick<SheetInfo, 'object' | 'frames'>): string[] {
  const own = info.object?.states?.map((s) => s.name).filter(Boolean) ?? [];
  if (own.length) return own;
  return [...new Set(info.frames.map((f) => f.clip))].filter((c) => !c.includes('_to_'));
}

/**
 * Everything of an ObjectPicture but its page for the frame `pickFrame` chose (the caller decodes the page, which is
 * `pick.frame.page`, in whatever image type it draws with). The anchor is the object block's (per direction), else
 * the sheet pivot, else the bottom centre of the frame.
 */
export function objectPictureOf(info: SheetInfo, pick: NonNullable<ReturnType<typeof pickFrame>>): Omit<ObjectPicture, 'page'> {
  const f = pick.frame;
  const d = info.object?.directions?.find((x) => x.name === pick.direction);
  let anchor = d?.anchor ?? info.object?.anchor ?? null;
  if (!anchor) {
    const pv = info.pivot ?? { x: f.sourceW / 2, y: f.sourceH };
    anchor = pick.flipX ? { x: f.sourceW - pv.x, y: pv.y } : pv;
  }
  const strips = info.object?.slices?.directions?.find((x) => x.name === pick.direction)?.strips;
  return {
    frame: { x: f.x, y: f.y, w: f.w, h: f.h }, trimX: f.trimX, trimY: f.trimY, sourceW: f.sourceW, sourceH: f.sourceH,
    flipX: pick.flipX, anchor, pixelsPerMetre: info.pixelsPerMetre,
    ...(strips?.length ? { strips: strips.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, sortY: s.sortY })) } : {}),
  };
}

/** The key a picture of a placed object is cached under (per export, state and facing). */
export const pictureKey = (o: Pick<MapObject, 'state' | 'facing'>) => `${o.state ?? ''}|${o.facing ?? ''}`;
