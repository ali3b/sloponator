/**
 * Frames → a content pack. Ported from synty-sprite-generator apps/web/src/export/exporter.ts, the half after the
 * frames exist (P2, ali3b/sloponator#9): the page layout, the sheets composed from the frames, the engine profile's
 * data files, validation, the engine-independent sheet JSON. Pure: @slop/sprites on the frames @slop/render handed
 * back, no browser, no canvas. Not here (yet): layered exports (one sheet per equipment item and the layers
 * manifest), waist/turret splits, portraits, GIF previews.
 */
import {
  LPC_SLOTS, buildContext, composePages, frameKey, genericData, layoutFrames, metaData, objectPivots, ownsSheetData, renderProfile, stripName, validateSheets,
  type BatchSpec, type ExportContext, type FrameSource, type LayoutSettings, type Page, type Placement, type ValidationIssue,
} from '@slop/sprites';
import { encodePng, type RenderResult } from '@slop/render';

export interface PackOptions {
  /** What the pack records as its maker (`generator` in the data files); `generatedAt` must be stable for a byte-identical rebuild. */
  generator: { name: string; version: string; generatedAt: string };
}

export interface Packed {
  /** Every file of the sprite's folder, by name. */
  files: Record<string, Uint8Array>;
  context: ExportContext;
  validation: ValidationIssue[];
  /** The sheet's base name (`Prop_Skull_01`). */
  base: string;
  cache: { reused: number; total: number };
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** The LPC universal sheet: 13 columns, rows in slot order, empty slots left transparent. */
function lpcPages(plans: { name: string }[], fw: number, fh: number): Page[] {
  const placements: Placement[] = [];
  let row = 0;
  for (const slot of LPC_SLOTS) {
    const plan = plans.find((p) => p.name === slot.slot);
    for (const dirName of slot.rows) {
      for (let i = 0; plan && i < slot.frames; i++) {
        placements.push({ key: frameKey(slot.slot, dirName, i), x: i * fw, y: row * fh, w: fw, h: fh, trimX: 0, trimY: 0, sourceW: fw, sourceH: fh, trimmed: false });
      }
      row++;
    }
  }
  return [{ index: 0, clip: null, direction: null, width: 13 * fw, height: row * fh, placements }];
}

export async function pack(spec: BatchSpec, r: RenderResult, opts: PackOptions): Promise<Packed> {
  const { output: out } = r;
  const profile = spec.profile;
  const { frameWidth: fw, frameHeight: fh } = out.framing;
  const layout: LayoutSettings = profile.layout;
  const pages = out.special === 'lpc' ? lpcPages(out.plans, fw, fh) : layoutFrames(out.inputs, layout);
  const where = new Map(pages.flatMap((p) => p.placements.map((pl) => [pl.key, { page: p.index, p: pl }] as const)));
  const context = buildContext({
    asset: out.asset, view: out.view, framing: out.framing, directions: out.directions, clips: out.clips, pages,
    placement: (k) => where.get(k), pageFile: profile.pageFile, frameName: profile.frameName, animationName: profile.animationName, settings: profile.settings,
    events: (clip) => out.events[clip] ?? [],
    pivots: objectPivots(out.object, spec.pivot ?? 'anchor'), modelScale: out.modelScale,
    layers: out.layers, sockets: (k) => out.sockets[k], boxes: (k) => out.boxes[k], blend: out.blend, object: out.object,
  });
  context.generator = { ...opts.generator };
  const base = context.base;

  // The sheets: every frame in its place (atlas edges extruded), then the extra layers the same way.
  const frameOf = (strip: string) => (key: string): FrameSource | null => {
    const [clip, dir, i] = key.split('|');
    return r.units.get(`${clip}\n${dir}`)?.frames[strip]?.[Number(i)] ?? null;
  };
  const files: Record<string, Uint8Array> = {};
  composePages(pages, frameOf(stripName('body')), layout).forEach((img, i) => (files[context.pages[i].file] = encodePng(img)));
  for (const layer of out.layers) composePages(pages, frameOf(stripName('body', layer)), layout).forEach((img, i) => (files[context.pages[i].layers[layer]] = encodePng(img)));

  // The profile's data files, the validation record in the data file every format gets (meta.json, or the generic
  // json), and the engine-independent sheet data next to every sheet unless the format's own {base}.json already is it.
  const rendered = await renderProfile(profile, context);
  for (const f of rendered) files[f.name] = utf8(f.content);
  const validation: ValidationIssue[] = [...out.validation, ...validateSheets([context], { layout })];
  if (validation.length) {
    const target = rendered.find((f) => f.name === `${base}.meta.json`) ?? rendered.find((f) => f.name === `${base}.json`);
    if (target) {
      try {
        target.content = JSON.stringify({ ...JSON.parse(target.content), validation }, null, 2);
        files[target.name] = utf8(target.content);
      } catch {
        /* not JSON: leave it */
      }
    }
  }
  if (!ownsSheetData(profile)) files[`${base}.sheet.json`] = utf8(JSON.stringify(genericData(context), null, 2) + '\n');
  return { files, context, validation, base, cache: out.cache };
}

export { metaData };
