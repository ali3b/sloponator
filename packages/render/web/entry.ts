/**
 * The render bundle's page: one SpriteRenderer on one canvas, and `window.__slop.render(job)`, which the Node runner
 * (packages/render/src/runner.ts) calls through Playwright. Nothing else runs here: no UI, no queue, no server. Data
 * comes from `/slop/...` requests the runner answers in-process (data.ts), frames go back through
 * `window.__slopEmit` / `__slopCacheLookup` / `__slopProgress`, functions the runner exposes on the page.
 */
import { SpriteRenderer } from './render/SpriteRenderer';
import { prepare, frameCacheFor, blendFor } from './export/prepare';
import { runRender, clipSampleTimes } from './export/render';
import type { RenderJob, RenderOutput, RenderedUnit } from '../src/protocol';
import { trackedPoints } from './export/extras';
import { api, type Animation, type Asset } from './data';
import { computeFraming, framingClips, type BatchSpec, type CachedFrame, type FrameUnitKeyInput, type ViewConfig, type FrameProgress } from '@slop/sprites';

/** What the runner exposes on the page (Playwright exposeFunction: arguments and results are JSON). */
interface Bridge {
  __slopEmit(unit: RenderedUnit): Promise<void>;
  __slopCacheLookup(units: { id: string; input: Omit<FrameUnitKeyInput, 'renderer'>; n: number }[]): Promise<(CachedFrame[] | null)[]>;
  __slopProgress(message: string, frames?: FrameProgress): Promise<void>;
}
const bridge = window as unknown as Bridge;

let sr: SpriteRenderer | null = null;
let anims: Animation[] | null = null;
const renderer = () => {
  if (!sr) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    document.body.appendChild(canvas);
    sr = new SpriteRenderer(canvas);
  }
  return sr;
};

/** The WebGL renderer string (what SwiftShader or the GPU reports), for the runner's log and the backend check. */
function glRenderer() {
  const gl = renderer().renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/**
 * Uniform frames (SF-FB-018, as the old batch runner's measuring pass): the largest frame and feet room this
 * sprite's clips and its sibling sprites' clips (`uniformWith`, same model, same view) need, so every sheet of the
 * model shares one frame size and pivot.
 */
async function uniformView(s: SpriteRenderer, asset: Asset, spec: BatchSpec, list: Animation[]): Promise<ViewConfig> {
  const view = spec.view;
  if (!spec.uniformFrame || view.scale.mode === 'fit') return view;
  let acc = { w: view.frameWidth, h: view.frameHeight, below: view.pivotBottom ?? 0 };
  for (const other of [null, ...(spec.uniformWith ?? [])]) {
    try {
      const { clips } = await prepare(s, asset, other ? { ...spec, set: other.set, loadout: other.loadout } : spec, list);
      // Object states: transitions are drawn into the frame the stills set (framingClips).
      const measured = framingClips(clips, (c) => !!c.state?.from).map((c) => {
        s.setClip(c.clip);
        return { clip: c.clip, times: s.sampleTimes(view.fps) };
      });
      if (!measured.length && other) continue;
      const f = computeFraming(s.measureClips(measured), view);
      acc = { w: Math.max(acc.w, f.frameWidth), h: Math.max(acc.h, f.frameHeight), below: Math.max(acc.below, f.frameHeight - f.pivot.y) };
    } catch {
      /* this batch's own failures are reported by the render; another sprite's clips are only measured */
    }
  }
  return { ...view, frameWidth: acc.w, frameHeight: acc.h, pivotBottom: acc.below };
}

async function render(job: RenderJob): Promise<RenderOutput> {
  const s = renderer();
  anims ??= await api.animations();
  const asset = await api.asset(job.asset);
  if (!asset.glb) throw new Error(`${asset.pack}/${asset.name} has no model file (GLB) in the library`);
  const spec = job.spec;
  const view = await uniformView(s, asset, spec, anims);
  const { scene, clips, notes } = await prepare(s, asset, spec, anims);
  if (!clips.length) throw new Error('none of the chosen animations apply to this model');
  // Before anything plays a clip on the model.
  const fc = frameCacheFor(s, asset, spec);
  const extras = trackedPoints(scene, asset, s);
  const out = await runRender({
    sr: s, asset: { name: asset.name, pack: asset.pack, kind: asset.kind, category: asset.category }, view, clips, profile: spec.profile,
    layers: spec.layers, sockets: extras.sockets, feet: extras.feet, body: extras.body, blend: blendFor(spec, asset), armedClasses: extras.armed,
    notes: notes.length ? notes : undefined, pivot: spec.pivot,
    frameCache: { model: fc.model, bypass: fc.bypass, lookup: (units) => bridge.__slopCacheLookup(units) },
    emit: (unit) => bridge.__slopEmit(unit),
    onProgress: (m, f) => void bridge.__slopProgress(m, f).catch(() => undefined),
  });
  return { ...out, asset: { name: asset.name, pack: asset.pack, kind: asset.kind, category: asset.category ?? null } };
}

(window as unknown as { __slop: unknown }).__slop = { render, glRenderer, clipSampleTimes, version: 1 };
