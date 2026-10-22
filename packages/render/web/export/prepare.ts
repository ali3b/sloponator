// Moved from synty-sprite-generator apps/web/src/export/batchRunner.ts (P2, ali3b/sloponator#9): the part that
// prepares one model for an export (loads it, mounts its loadout, turns the animation set into clips). The batch
// loop, the server uploads, the waist/turret/portrait orchestration and the incremental (align-to) paths stayed
// behind: the Node runner drives one render at a time (render.ts) and the CLI packs the frames.
import * as THREE from 'three';
import { clipAutoEvents, fxLookFor, keyEventName, marksToClipTimes, setItemLabel, spriteClipEdit, type ClipWindow, type BatchSpec, type SetItem, type ValidationIssue } from '@slop/sprites';
import { api, type Animation, type Asset } from '../data';
import { TEMPLATES, buildLayers, isLoop, layerEvents, layerSpeed, overlayClip, templatesFor } from '../anim/templates';
import { applyClipEdit } from '../anim/clipEdit';
import { applyVariant, loadClip, loadModel } from '../render/assets';
import { alignStyleGrips, applyPlacements, holdFrontGrip, loadoutMounts, mountAttachments } from '../render/attach';
import { loadFxTextures } from '../render/fxTextures';
import type { SpriteRenderer } from '../render/SpriteRenderer';
import type { ExportClip } from './render';
import { resolveAnim, resolveMatch } from './setPlan';
import { capClip } from './clipCap';
import { endOnState } from '../anim/templates/transition';
import { applyLook } from '../render/scorch';
import { assetIdentity, sceneFingerprint } from './frameCache';
/** The FX look for an asset in a batch: the batch's own, else glowing for FX-kind models (smoke sets blend normally). */
export function fxFor(spec: Pick<BatchSpec, 'fx'> & Partial<Pick<BatchSpec, 'set'>>, asset: Pick<Asset, 'kind'>) {
  return fxLookFor(spec, asset.kind);
}
export function blendFor(spec: Pick<BatchSpec, 'fx'> & Partial<Pick<BatchSpec, 'set'>>, asset: Pick<Asset, 'kind'>): 'add' | 'normal' {
  const fx = fxFor(spec, asset);
  return fx?.enabled && (fx.blend ?? 'add') === 'add' ? 'add' : 'normal';
}

/**
 * A baked skeletal clip with its edit (trim/speed) applied, its stored events, and its automatic key event. A
 * sprite's own trim (`window`, SF-FB-001) replaces the shared trim on the sides it sets (spriteClipEdit).
 */
async function animClip(asset: Asset, anim: Animation, name: string, window: ClipWindow | undefined, root: THREE.Object3D): Promise<ExportClip> {
  const b = await api.bake(asset.id, anim.id);
  const source = await loadClip(b.url, b.clip);
  if (window?.still !== undefined) return stillClip(anim, name, source, window, { root, rigMap: asset.rig?.map });
  const edit = spriteClipEdit(anim.edit, window);
  // The yaw lock (SF-FB-023) works on the model's hips and the bones above them.
  const clip = applyClipEdit(source, edit, { root, rigMap: asset.rig?.map });
  // Trimming/speed edits change the clip's playback speed, so the ground speed scales with it.
  const speed = b.speed ? b.speed * (edit?.speed ?? 1) : null;
  return { name, loop: anim.loop, clip, events: marksToClipTimes(edit?.events, edit, source.duration), autoKey: keyEventName(anim.name, anim.category), autoEvents: clipAutoEvents(edit), speed };
}

/**
 * SF-FB-025: one frame of a baked clip, the pose at `at` source seconds: the shared edit (whatever else it changes)
 * trimmed to start there and played forwards, sampled at its first frame. No events: a still has no moment.
 */
function stillClip(anim: Animation, name: string, source: THREE.AnimationClip, window: ClipWindow, model: Parameters<typeof applyClipEdit>[2]): ExportClip {
  const at = window.still!;
  const start = Math.max(0, Math.min(at, source.duration - 1e-3));
  // The sprite's reverse flips the shared one back to forwards, so the trimmed clip starts on the pose at `start`.
  const edit = spriteClipEdit(anim.edit, { start, end: source.duration, events: [], autoEvents: false, ...(anim.edit?.reverse ? { reverse: true } : {}), ...(window.lockYaw !== undefined ? { lockYaw: window.lockYaw } : {}) });
  const clip = applyClipEdit(source, edit, model);
  return { name, loop: false, clip, events: [], autoKey: null, autoEvents: false, speed: null, stillAt: 0 };
}

/** A stand-in's own window under its move's: the move's trim and cap win; the two reverses add up (twice = forwards). */
function innerWindow(own: ClipWindow | undefined, outer: ClipWindow | undefined): ClipWindow | undefined {
  if (!own) return outer;
  if (!outer) return own;
  const w: ClipWindow = { ...own, ...outer };
  if (!!own.reverse !== !!outer.reverse) w.reverse = true;
  else delete w.reverse;
  return w;
}

/**
 * The frame cache for an export of this prepared model (FB-121): the model's identity in its keys — the asset record,
 * the batch's gender, loadout, FX look and lighting, and a fingerprint of the scene as prepare() left it (mounted items,
 * grips, placement fixes, materials). Take it right after prepare, before anything plays a clip on the model.
 */
export function frameCacheFor(sr: SpriteRenderer, asset: Asset, spec: Pick<BatchSpec, 'gender' | 'loadout' | 'fx' | 'set' | 'layered' | 'maxSeconds' | 'noCache'> & Pick<Partial<BatchSpec>, 'light'>) {
  const root = sr.assetRoot;
  return {
    bypass: !!spec.noCache,
    model: {
      asset: assetIdentity(asset as unknown as Record<string, unknown>), gender: spec.gender, loadout: spec.loadout ?? [], fx: fxFor(spec, asset) ?? null,
      light: spec.light ?? null, layered: spec.layered ?? null, maxSeconds: spec.maxSeconds ?? null,
      scene: sceneFingerprint(root ? [root] : [], sr.holders),
    },
  };
}

/** Load an asset and turn the set into clips for it. Items that don't apply (e.g. walk on a car) are skipped. */
export async function prepare(
  sr: SpriteRenderer, asset: Asset, spec: Pick<BatchSpec, 'set' | 'gender' | 'loadout' | 'fx' | 'layered' | 'alignTo' | 'partsOnly' | 'maxSeconds'> & Pick<Partial<BatchSpec>, 'light' | 'modelScale'>, anims: Animation[],
  /** Reshape the loaded model before anything uses it (FB-096: the hull without its turret, or the turret alone). */
  opts: { split?: (scene: THREE.Object3D) => THREE.Object3D } = {},
) {
  await loadFxTextures();
  const loaded = await loadModel(asset.glb!);
  applyVariant(loaded, asset);
  const scene = opts.split ? opts.split(loaded) : loaded;
  // Object states: clips drawn from other models (a damaged or destroyed version) put every model under one
  // root; the renderer shows the clip's own model (setClipModel), so all states share one framing and anchor.
  type Model = { scene: THREE.Object3D; asset: Asset; ta: { kind: string; parts: Asset['parts']; rigMap: Record<string, string> | undefined }; available: Set<string> };
  const modelOf = (sc: THREE.Object3D, a: Asset): Model => {
    const ta = { kind: a.kind, name: a.name, parts: a.parts, rigMap: a.rig?.map };
    return { scene: sc, asset: a, ta, available: new Set(templatesFor(ta).map((t) => t.id)) };
  };
  const base = modelOf(scene, asset);
  // State models by model id, plus its procedural look (`12@scorch`): a look is drawn on its own copy of the model.
  const keyOf = (id: number, look?: string) => (look ? `${id}@${look}` : String(id));
  const itemKey = (it: SetItem) => (it.type === 'template' && it.model !== undefined ? keyOf(it.model, it.look) : keyOf(asset.id));
  const models = new Map<string, Model>([[keyOf(asset.id), base]]);
  const others = [...new Map(spec.set.items.flatMap((it) => (it.type === 'template' && it.model !== undefined && itemKey(it) !== keyOf(asset.id) ? [[itemKey(it), { id: it.model, look: it.look }] as const] : []))).entries()];
  const notes: ValidationIssue[] = [];
  if (others.length) {
    const root = new THREE.Group();
    root.name = 'states';
    root.add(scene);
    for (const [key, { id, look }] of others) {
      const a = id === asset.id ? asset : await api.asset(id);
      if (!a.glb) throw new Error(`state model ${a.name} (#${id}) has no model file`);
      const sc = await loadModel(a.glb);
      applyVariant(sc, a);
      if (look) applyLook(sc, look, a.name);
      root.add(sc);
      models.set(key, modelOf(sc, a));
    }
    sr.setAsset(root);
    // The first state's model is shown when a clip has none registered.
    const first = spec.set.items.find((it) => it.type === 'template' && it.model !== undefined);
    const firstModel = first ? models.get(itemKey(first)) : undefined;
    sr.setStateModels([...new Set([firstModel?.scene ?? scene, ...[...models.values()].map((m) => m.scene)])]);
  } else sr.setAsset(scene);
  // Held weapons / props for characters (each at its saved grip), and the glowing FX look.
  if (spec.loadout?.length && asset.kind === 'character') mountAttachments(sr, scene, asset, await loadoutMounts(spec.loadout, (id) => api.asset(id), { layered: !!spec.layered, reserved: spec.partsOnly ? spec.alignTo?.parts : undefined }));
  // FX models glow by default (unlit, additive) unless the batch says otherwise.
  sr.setFx(fxFor(spec, asset));
  // The scene lights (FB-060): the batch's preset and overrides, else day.
  sr.setLight(spec.light);
  // SF-FB-024: the sprite's own model scale (1 unless asked), set every time: the renderer is shared by batches.
  sr.setModelScale(spec.modelScale ?? 1);
  const ta = base.ta;
  const available = base.available;
  const clips: ExportClip[] = [];
  const used = new Set<string>();
  const fromLayers = (name: string, refs: { id: string; params: Record<string, number> }[], m: Model = base): ExportClip | null => {
    const layers = refs.filter((l) => m.available.has(l.id));
    if (!layers.length) return null;
    const clip = buildLayers(m.scene, m.ta, layers);
    const posed = layers.map((l) => TEMPLATES.find((t) => t.id === l.id)).filter((t) => t?.gunPose);
    // A launcher on the shoulder holds its weapon along the line between the hands, the other gun poses along the forearm.
    const ownGrip = posed.some((t) => t?.gunGrip === 'two_hand') ? ('two_hand' as const) : posed.length > 0;
    return { name, loop: isLoop(layers), clip, events: layerEvents(layers, clip?.duration ?? 0), knownSpeed: layerSpeed(layers), ...(ownGrip ? { ownGrip } : {}) };
  };
  for (const item of spec.set.items) {
    let label = setItemLabel(item).replace(/[^\w-]+/g, '_');
    while (used.has(label)) label += '_';
    if (item.type !== 'template' && asset.kind !== 'character') continue;
    // A style's own clip, else (orElse) the plain clip with the carry pose, else the procedural stand-in.
    const model = models.get(itemKey(item)) ?? base;
    const resolve = async (it: SetItem): Promise<ExportClip | null> => {
      if (it.type === 'template') return fromLayers(label, it.layers, model);
      const anim = it.type === 'anim' ? resolveAnim(it, anims, asset, spec.gender) : resolveMatch(it.pattern, anims, asset, spec.gender, it.prefer);
      if (anim) {
        // A stand-in (orElse) may carry its own window: the reversed dash_back that is dash_forward (SF-FB-017).
        const c = await animClip(asset, anim, label, it === item ? item.window : innerWindow(it.window, item.window), model.scene);
        // A carry pose over a real clip (a template stand-in already poses the arms).
        const over = (it.overlay ?? []).filter((l) => available.has(l.id));
        return over.length && c.clip ? { ...c, clip: overlayClip(scene, ta, c.clip, over) } : c;
      }
      if (it.type === 'match' && it.orElse) return resolve(it.orElse);
      return it.type === 'match' && it.fallback?.length ? fromLayers(label, it.fallback) : null;
    };
    let out = await resolve(item);
    // A transition whose template needs parts (destroy) on a one-mesh model collapses instead (FB-028).
    if (!out && item.type === 'template' && item.state?.from && item.layers.some((l) => l.id === 'destroy' && !model.available.has('destroy')) && model.available.has('collapse')) {
      const layers = item.layers.map((l) => (l.id === 'destroy' ? { id: 'collapse', params: l.params.duration !== undefined ? { duration: l.params.duration } : {} } : l));
      out = fromLayers(label, layers, model);
      if (out) notes.push({ level: 'warn', code: 'state_clip_fallback', message: `${label}: destroy needs a model in parts and ${model.asset.name} is one mesh, so it collapses instead (shake, sink, dust, then the ${item.state.name} state)` });
    }
    // A state's loop that does not apply to its model (drive on a model without wheels) keeps the state as a still.
    let stillInstead = false;
    if (!out && item.type === 'template' && item.state?.loop && !item.state.from) {
      stillInstead = true;
      const missing = item.layers.filter((l) => !model.available.has(l.id)).map((l) => l.id);
      out = fromLayers(label, [{ id: 'still', params: {} }], model);
      if (out) notes.push({ level: 'warn', code: 'state_loop_skipped', message: `${label}: ${missing.join(', ') || item.state.loop} does not apply to ${model.asset.name} (see ssg templates for what each needs), so ${label} is a still` });
    }
    if (!out) {
      if (item.type === 'template' && item.state) {
        const missing = item.layers.filter((l) => !model.available.has(l.id)).map((l) => l.id);
        notes.push({ level: 'warn', code: 'state_clip_skipped', message: `${label}: ${missing.join(', ') || 'the template'} does not apply to ${model.asset.name} (see ssg templates for what each needs), so the export has no ${label}` });
      }
      continue;
    }
    if (item.cls) out.cls = item.cls;
    if (item.perClip) out.perClip = true;
    if (item.perClip && item.release) out.release = item.release;
    // --max-seconds: a shorter copy of the clip (loops cut where they join up); aligned exports replay their times.
    // A move's own cap (window.maxSeconds) wins over the sprite's.
    // SF-FB-025: a still of a procedural move is its pose at that time of the template (a baked clip's is made in animClip).
    const still = item.window?.still;
    if (still !== undefined && out.stillAt === undefined) out = { ...out, loop: false, events: [], autoKey: null, autoEvents: false, stillAt: Math.max(0, Math.min(still, (out.clip?.duration ?? 0) - 1e-4)) };
    const cap = still !== undefined ? undefined : item.window?.maxSeconds ?? spec.maxSeconds;
    if (cap && !spec.alignTo) out = capClip(out, cap);
    // What the clip was made from, for the frame cache key (template params, the sprite's own trim, the cap).
    out.source = { item, cap: cap && !spec.alignTo ? cap : null };
    if (item.type === 'template' && item.state) {
      const { loop, ...st } = item.state;
      // The loop is recorded only when it was rendered (not the still it fell back to).
      out.state = { ...st, ...(loop && !stillInstead ? { loop } : {}), asset: model.asset.name, ...(item.look ? { look: item.look } : {}) };
    }
    // A transition ends on its destination state (FB-027): that state's model fades in as this one fades out.
    const dest = item.type === 'template' && item.state?.from
      ? spec.set.items.find((it) => it.type === 'template' && it.state?.name === item.state!.name && !it.state.from)
      : undefined;
    const destModel = dest ? models.get(itemKey(dest)) : undefined;
    if (destModel && destModel.scene !== model.scene && out.clip) {
      out.clip = endOnState(out.clip, model.scene, destModel.scene);
      if (others.length) sr.setClipModel(out.clip, model.scene, destModel.scene);
    } else if (others.length && out.clip) sr.setClipModel(out.clip, model.scene);
    clips.push(out);
    used.add(label);
  }
  // Style weapons without a saved grip are aimed by their style's own idle pose (Synty weapon axes).
  if (asset.kind === 'character' && spec.loadout?.length) alignStyleGrips(sr, scene, asset, clips);
  // Placement fixes (a person's or an approved AI one) on top of the automatic placement.
  if (spec.loadout?.length) applyPlacements(sr);
  // The support hand on a launcher's front grip in the clips that hold it across both hands (FB-105).
  if (asset.kind === 'character' && spec.loadout?.length) holdFrontGrip(sr, scene, asset, clips);
  return { scene, clips, notes };
}
