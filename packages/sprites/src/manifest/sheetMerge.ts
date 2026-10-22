// Moved from synty-sprite-generator packages/shared/src/export/sheetMerge.ts (P2, ali3b/sloponator#8).
/**
 * Adding clips to an existing export: the new clips are rendered on pages numbered after the old ones, then each
 * sheet's frame data (the generic `{base}.json`, or `{base}.sheet.json` beside other formats) is merged and the
 * format's own files are written again from the merged data. Old pages are never touched.
 */
import type { Direction } from '../view/camera.js';
import { fillPattern, scaleRecord, type ContextAnimation, type ContextFrame, type ExportContext } from './context.js';
import type { ExportProfile } from '../profiles/profiles.js';
import { renderProfile } from '../profiles/render.js';
import type { genericData } from './meta.js';

export type GenericSheet = ReturnType<typeof genericData>;

const isSheet = (v: unknown): v is GenericSheet => !!v && typeof v === 'object' && Array.isArray((v as GenericSheet).animations) && Array.isArray((v as GenericSheet).pages);

/** The generic frame data of a sheet (`{base}.sheet.json` when the format has its own files, else `{base}.json`). */
export function sheetDataName(files: Record<string, string>, base: string): string | null {
  for (const name of [`${base}.sheet.json`, `${base}.json`]) {
    try {
      if (files[name] && isSheet(JSON.parse(files[name]))) return name;
    } catch {
      /* not JSON: a format file of the same name */
    }
  }
  return null;
}

/** One sheet's frame data with another's new clips appended (pages, clips and animations; the first wins on names). */
export function mergeGenericSheets(a: GenericSheet, b: GenericSheet): GenericSheet {
  return {
    ...a,
    generator: b.generator,
    pages: [...a.pages, ...b.pages.filter((p) => !a.pages.some((q) => q.index === p.index))].sort((x, y) => x.index - y.index),
    clips: [...a.clips, ...b.clips.filter((c) => !a.clips.some((x) => x.name === c.name))],
    animations: [...a.animations, ...b.animations.filter((n) => !a.animations.some((x) => x.name === n.name))],
  };
}

/**
 * The export context a sheet's frame data describes (the inverse of genericData), so any format's templates can
 * be rendered from it. Frame names follow the profile's pattern; mirrored directions reuse their source's frames.
 */
export function contextFromGeneric(g: GenericSheet, profile: Pick<ExportProfile, 'frameName' | 'settings'>, base: string): ExportContext {
  const directions: Direction[] = g.directions.map((d, index) => ({ index, name: d.name, screenAngle: d.screenAngle, worldAngle: d.worldAngle, mirrorOf: null }));
  g.directions.forEach((d, i) => {
    if (d.mirrorOf) directions[i].mirrorOf = directions.find((x) => x.name === d.mirrorOf)?.index ?? null;
  });
  const { pivot, frameWidth, frameHeight } = g;
  // Objects pivot on each direction's anchor (FB-029); older sheets and characters on one pivot.
  const pivotOfAnim = (a: GenericSheet['animations'][number]) => ('pivot' in a && a.pivot) || pivot;
  const pageById = new Map(g.pages.map((p) => [p.index, p]));
  const frames: ContextFrame[] = [];
  const framesOf = new Map<string, ContextFrame[]>(); // `${clip}|${direction}` for rendered directions
  for (const a of g.animations.filter((x) => !x.flipX)) {
    const pivot = pivotOfAnim(a);
    const list = a.frames.map((f, index) => {
      const pg = pageById.get(f.page);
      const frame: ContextFrame = {
        name: fillPattern(profile.frameName, { clip: a.clip, dir: a.direction, direction: a.direction, i: index, base }),
        clip: a.clip, direction: a.direction, index, page: f.page, file: pg?.file ?? '',
        x: f.x, y: f.y, w: f.w, h: f.h, yUp: (pg?.height ?? 0) - f.y - f.h,
        trimmed: !!(f.trimX || f.trimY || f.w !== f.sourceW || f.h !== f.sourceH), trimX: f.trimX, trimY: f.trimY, sourceW: f.sourceW, sourceH: f.sourceH,
        offsetX: f.trimX, offsetYUp: f.sourceH - f.trimY - f.h,
        pivotX: (pivot.x - f.trimX) / f.w, pivotY: (pivot.y - f.trimY) / f.h, pivotYUp: 1 - (pivot.y - f.trimY) / f.h,
        pivotSrcX: pivot.x / f.sourceW, pivotSrcY: pivot.y / f.sourceH,
        durationMs: f.durationMs, durationS: f.durationMs / 1000, i: frames.length,
        sockets: ('sockets' in f && f.sockets) || {},
        ...('boxes' in f && f.boxes ? { boxes: f.boxes } : {}),
      };
      frames.push(frame);
      return frame;
    });
    framesOf.set(`${a.clip}|${a.direction}`, list);
  }
  const animations: ContextAnimation[] = g.animations.map((a) => {
    const d = directions.find((x) => x.name === a.direction);
    const src = d && d.mirrorOf !== null ? directions[d.mirrorOf].name : a.direction;
    const list = framesOf.get(`${a.clip}|${src}`) ?? [];
    return {
      name: a.name, pivot: pivotOfAnim(a), clip: a.clip, direction: a.direction, loop: a.loop, fps: a.fps, flipX: a.flipX, mirrorOf: a.flipX ? src : null,
      screenAngle: d?.screenAngle ?? 0, worldAngle: d?.worldAngle ?? 0, frames: list, from: list[0]?.i ?? 0, to: list[list.length - 1]?.i ?? 0,
    };
  });
  return {
    asset: g.asset, base, view: g.view, frameWidth, frameHeight, fps: g.fps, pivot, pivotSource: ('pivotSource' in g && g.pivotSource) || 'origin',
    pivotX: pivot.x / frameWidth, pivotY: pivot.y / frameHeight, pivotYUp: 1 - pivot.y / frameHeight,
    pixelsPerMetre: g.pixelsPerMetre, scale: g.scale ?? scaleRecord(g.view, g.pixelsPerMetre), pixelsPerUnit: g.pixelsPerMetre ?? 100,
    pages: g.pages, layers: g.layers, frames, animations,
    clips: g.clips.map((c) => ({ ...c, animations: animations.filter((a) => a.clip === c.name) })),
    directions, settings: profile.settings ?? {}, blend: g.blend, generator: g.generator,
    ...('object' in g && g.object ? { object: g.object } : {}),
  };
}

/**
 * The text files of a layered export after new clips were rendered for it (`add`, pages numbered after the old
 * ones): for each sheet, its merged frame data and the format's files written again from it. Returns only the
 * files that change; images are untouched (the new pages already have their own names).
 */
export async function mergeExtensionFiles(prev: Record<string, string>, add: Record<string, string>, bases: string[], profile: ExportProfile): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const base of bases) {
    const name = sheetDataName(prev, base);
    const addName = sheetDataName(add, base);
    if (!name || !addName) continue;
    const merged = mergeGenericSheets(JSON.parse(prev[name]) as GenericSheet, JSON.parse(add[addName]) as GenericSheet);
    for (const f of await renderProfile(profile, contextFromGeneric(merged, profile, base))) out[f.name] = f.content;
    // The generic format's own file is this data; other formats keep it as `{base}.sheet.json`.
    out[name] = JSON.stringify(merged, null, 2) + '\n';
  }
  return out;
}
