// Moved from synty-sprite-generator packages/shared/src/export/layers.ts (P2, ali3b/sloponator#8).
/**
 * Layered sprites: the body and each attached item (weapon, shield, helmet, hair, cape, effect) exported as
 * separate sheets that share one frame size, pivot, trim and timing, plus a manifest (`{base}.layers.json`,
 * schema `ssg-layers/1`) that says, for every frame, whether each item is in front of or behind the body and
 * where it is attached. Any engine composes them by drawing the same frame index of every sheet in
 * `drawOrder(z)` order (see docs/LAYERS.md).
 */
import type { Framing, ViewConfig } from '../view/camera.js';
import type { ObjectInfo } from '../object/footprint.js';
import type { AnimationSet, JobPreset } from '../inputs/batch.js';
import type { LoadoutItem } from '../inputs/combat.js';
import { scaleRecord, type ClipEvent, type ExportContext, type ScaleRecord } from './context.js';
import type { LayoutSettings } from '../layout/layout.js';
import { createLiquid, type RenderedFile } from '../profiles/render.js';
import type { ValidationIssue } from '../validate/validate.js';

export type PartSlot = 'weapon' | 'offhand' | 'head' | 'hair' | 'back' | 'body' | 'accessory' | 'fx';

/** Where a part draws relative to the body: measured per frame ('auto'), forced, or forced per direction name. */
export type DepthRule = 'auto' | 'front' | 'back' | Record<string, 'front' | 'back'>;

export interface LayeredOptions {
  /** 'mask': pixels hidden by the body (or other parts) are cut away, so sheets compose in any order over the body. */
  occlusion: 'mask' | 'none';
}

/** Hair pieces by name (SF-FB-013: a ponytail or braid is hair too, worn on the head). */
export const HAIR_NAME = /hair|ponytail|pigtail|braid|beard|moustache|mustache|sideburn|eyebrow/i;

/** Which bone an origin-modelled Synty attachment mounts on, from its name (or its hair/head slot label). */
export function boneForAttachment(name: string, slot?: string | null) {
  const n = name.toLowerCase();
  if (slot === 'hair' || slot === 'head' || HAIR_NAME.test(n)) return 'head';
  // "cap" only as a word (Cap_01, Baseball_Cap): a cape is a back item.
  if (/helmet|hat|(^|_)cap(?=_|\d|$)|hair|mask|glasses|goggle|beard|moustache|head|hood|beret|bandana|headset|ear|visor/.test(n)) return 'head';
  if (/backpack|_pack|bedroll|radio|parachute|cape|vest|armou?r|chest|scarf|tank|quiver/.test(n)) return 'spine3';
  if (/canteen|pouch|holster|belt|shovel|knife|sheath|bag|grenade|ammo/.test(n)) return 'hips';
  if (/glove|watch|bracelet|wrist/.test(n)) return 'hand_r';
  return null;
}

/** Which slot an attached asset fills, from its name and kind (keep in step with boneForAttachment). */
export function slotFor(name: string, kind: string): PartSlot {
  const n = name.toLowerCase();
  if (kind === 'fx') return 'fx';
  if (/shield|buckler/.test(n)) return 'offhand';
  if (['weapon', 'prop', 'multipart', 'rigged'].includes(kind)) return 'weapon';
  if (HAIR_NAME.test(n)) return 'hair';
  if (/helmet|hat|cap(_|\d|$)|mask|glasses|goggle|hood|beret|bandana|headset|visor|crown|tiara/.test(n)) return 'head';
  if (/backpack|_pack|bedroll|cape|cloak|parachute|quiver|radio/.test(n)) return 'back';
  if (/vest|armou?r|chest|scarf|pauldron|plate/.test(n)) return 'body';
  return 'accessory';
}

/** An item's slot: its label when someone (or the AI, once accepted) set one, else the rule from its name. */
export function slotOfAsset(a: { name: string; kind: string; slot?: string | null }): PartSlot {
  return (a.slot as PartSlot) || slotFor(a.name, a.kind);
}

/** Unique part names: an explicit name, else the slot; repeats (and names in `reserved`) get _2, _3… */
export function uniquePartNames(items: { slot: PartSlot; layer?: string | null }[], reserved: string[] = []): string[] {
  const used = new Map<string, number>();
  for (const r of reserved) used.set(r.toLowerCase(), (used.get(r.toLowerCase()) ?? 0) + 1);
  return items.map((it) => {
    const base = (it.layer?.trim().replace(/[^\w-]+/g, '_') || it.slot).toLowerCase();
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

/**
 * Draw order for one frame. 'none' sheets hold whole items: parts behind the body first (most distant), the
 * body, then parts in front. 'mask' sheets already lack every pixel the body covers, so they always go on top
 * of the body (nearest last) — drawing one behind would hide what is left of it.
 */
export function drawOrder(z: Record<string, number>, occlusion: 'mask' | 'none' = 'none'): string[] {
  const parts = Object.entries(z).sort((a, b) => a[1] - b[1]);
  if (occlusion === 'mask') return ['body', ...parts.map(([k]) => k)];
  return [...parts.filter(([, v]) => v < 0).map(([k]) => k), 'body', ...parts.filter(([, v]) => v >= 0).map(([k]) => k)];
}

export function applyDepthRule(z: number, rule: DepthRule | undefined, direction: string): number {
  const r = !rule || rule === 'auto' ? 'auto' : typeof rule === 'string' ? rule : rule[direction] ?? 'auto';
  return r === 'front' ? Math.max(1, Math.abs(z) || 1) : r === 'back' ? -Math.max(1, Math.abs(z) || 1) : z;
}

export interface LayerPartInfo {
  name: string;
  slot: PartSlot;
  kind: string;
  asset: string;
  /** Bone (or part) the item is mounted on, '' for the root. */
  bone: string;
  blend: 'normal' | 'add';
  depth: DepthRule;
  /** Weapon class: this sheet only has frames for that class's clips (others are transparent). */
  cls?: string;
  /** Sheet base name ({base}_{name}): its images and the format's files for it. */
  base: string;
  pages: string[];
  files: string[];
  /** The loadout item the part was rendered from (tells outfits which part an item is). */
  item?: { asset: number; layer?: string; cls?: string };
}

/** A named outfit: which parts to show (the rest are hidden). Written by the generator for its sprites. */
export interface OutfitPreset {
  id: string;
  name: string;
  parts: string[];
}

export interface LayerAlignment {
  /** Part names already in the export (new items aligned to it get names that do not clash). */
  parts?: string[];
  view: ViewConfig;
  framing: Framing;
  layout: LayoutSettings;
  /** Sample times per clip, so later renders hit the very same poses. */
  clips: { name: string; loop: boolean; times: number[] }[];
  /** Pages every sheet has (they share one layout): new clips are added on pages after these. */
  pages?: number;
  /** Hash of everything above: two exports with the same signature line up frame for frame. */
  signature: string;
}

export interface LayerFrame {
  /** Metres along the view axis relative to the body's hips, per part (+ = in front of the body). */
  z: Record<string, number>;
  front: Record<string, boolean>;
  /** The part's attachment point in untrimmed-frame pixels (mirrored directions: x' = frameWidth - x). */
  offset: Record<string, { x: number; y: number }>;
}

export interface LayersManifest {
  schema: 'ssg-layers/1';
  generator: ExportContext['generator'];
  asset: ExportContext['asset'];
  base: string;
  occlusion: 'mask' | 'none';
  frameWidth: number;
  frameHeight: number;
  fps: number;
  /** The frame pivot: the model origin, or for objects (pivotSource "anchor") the first direction's anchor. */
  pivot: { x: number; y: number };
  /**
   * "anchor" (objects, FB-029): every sheet pivots per direction on that direction's anchor, given as each
   * animation's `pivot` (FB-028 follow-up). Absent: the model origin, `pivot` for every animation.
   */
  pivotSource?: 'anchor';
  pixelsPerMetre: number | null;
  /** The scale lock (or fit) every sheet was rendered at. */
  scale: ScaleRecord;
  /** Objects and props: footprint, height, anchor and ground collision polygon (the body model's). */
  object?: ObjectInfo;
  alignment: LayerAlignment;
  body: { base: string; pages: string[]; files: string[] };
  parts: LayerPartInfo[];
  clips: { name: string; loop: boolean; frameCount: number; events: ClipEvent[]; cls?: string }[];
  /** Weapon classes in this export (clips are named `<class>_<clip>`); the body sheet holds all of them. */
  classes?: { id: string; label: string }[];
  directions: { name: string; screenAngle: number; mirrorOf: string | null }[];
  /** Same order and frame counts as every sheet's `animations`. `front` says where to draw each part; `z` is the measured depth. */
  animations: {
    name: string; clip: string; direction: string; flipX: boolean;
    /** pivotSource "anchor": this animation's own pivot (its direction's anchor; a flipX one's is x-flipped, as drawn). */
    pivot?: { x: number; y: number };
    frames: LayerFrame[];
  }[];
  validation: ValidationIssue[];
  /** What produced this export (so `--align-to` can add layers or clips later with the same inputs). */
  source?: { set: AnimationSet; gender: JobPreset['gender']; loadout: LoadoutItem[]; /** Export format id (godot4, generic…). */ profile?: string };
  /** Named outfits: which parts each one shows. Optional; a game that ignores it can show any parts it likes. */
  outfits?: OutfitPreset[];
  note: string;
}

export const LAYERS_NOTE =
  'Every sheet (body and parts) has the same frames, pivot, trim and timing: draw frame i of each one at the same ' +
  'position. Draw parts with front=false behind the body and front=true over it (ascending z within each group). ' +
  'With occlusion "mask" the parts already lack the pixels the body covers, so front is always true: draw the body, ' +
  'then every part; z is then only the measured depth. Mirrored directions flip every sheet (and offsets: x = ' +
  'frameWidth - x); z does not change. Parts with blend "add" are drawn additively. Unity: one SpriteRenderer per ' +
  'layer, sortingOrder = front ? 1 : -1.';

/** Stable hash of the alignment (key order does not matter). */
export function alignmentSignature(a: Omit<LayerAlignment, 'signature'>): string {
  // Only what decides geometry and timing; the part list may grow. The collision slice changes no pixels.
  const { collisionHeight: _c, collision: _k, ...view } = a.view;
  a = { view, framing: a.framing, layout: a.layout, clips: a.clips };
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const s = JSON.stringify(canon(a));
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (h1 >>> 7), 0x5bd1e995) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export interface ManifestInput {
  body: ExportContext;
  bodyFiles: string[];
  parts: { info: Omit<LayerPartInfo, 'base' | 'pages' | 'files'>; ctx: ExportContext; files: string[] }[];
  /** Per rendered frame (clip, direction, index): z and attachment offset per part. */
  z: (clip: string, direction: string, index: number) => Record<string, number> | undefined;
  /** Weapon class per clip name, when the export has classes. */
  clipClass?: (clip: string) => string | undefined;
  classes?: { id: string; label: string }[];
  offset?: (clip: string, direction: string, index: number) => Record<string, { x: number; y: number }> | undefined;
  occlusion: 'mask' | 'none';
  alignment: Omit<LayerAlignment, 'signature'>;
  validation?: ValidationIssue[];
}

export function buildLayersManifest(o: ManifestInput): LayersManifest {
  const b = o.body;
  const srcDir = (a: ExportContext['animations'][number]) => a.mirrorOf ?? a.direction;
  return {
    schema: 'ssg-layers/1',
    generator: b.generator,
    asset: b.asset,
    base: b.base,
    occlusion: o.occlusion,
    frameWidth: b.frameWidth,
    frameHeight: b.frameHeight,
    fps: b.fps,
    pivot: b.pivot,
    ...(b.pivotSource === 'anchor' ? { pivotSource: 'anchor' as const } : {}),
    pixelsPerMetre: b.pixelsPerMetre,
    scale: b.scale ?? scaleRecord(b.view, b.pixelsPerMetre),
    ...(b.object ? { object: b.object } : {}),
    alignment: { ...o.alignment, signature: alignmentSignature(o.alignment), parts: o.parts.map((p) => p.info.name), pages: b.pages.length },
    body: { base: b.base, pages: b.pages.map((p) => p.file), files: o.bodyFiles },
    parts: o.parts.map((p) => ({ ...p.info, base: p.ctx.base, pages: p.ctx.pages.map((pg) => pg.file), files: p.files })),
    clips: b.clips.map((c) => ({ name: c.name, loop: c.loop, frameCount: c.frameCount, events: c.events, ...(o.clipClass?.(c.name) ? { cls: o.clipClass(c.name) } : {}) })),
    ...(o.classes?.length ? { classes: o.classes } : {}),
    directions: b.directions.map((d) => ({ name: d.name, screenAngle: d.screenAngle, mirrorOf: d.mirrorOf === null ? null : b.directions[d.mirrorOf].name })),
    animations: b.animations.map((a) => ({
      name: a.name, clip: a.clip, direction: a.direction, flipX: a.flipX,
      // Objects pivot per direction on their anchor (FB-029): one manifest pivot would misplace every other facing.
      ...(b.pivotSource === 'anchor' ? { pivot: a.pivot } : {}),
      frames: a.frames.map((f) => {
        const z = o.z(a.clip, srcDir(a), f.index) ?? {};
        // front = where to draw it; z = the measured depth (informational for masked sheets, which always go on top).
        return { z, front: Object.fromEntries(Object.entries(z).map(([k, v]) => [k, o.occlusion === 'mask' || v >= 0])), offset: o.offset?.(a.clip, srcDir(a), f.index) ?? {} };
      }),
    })),
    validation: o.validation ?? [],
    note: LAYERS_NOTE,
  };
}

const presetItemKey = (it: { asset: number; layer?: string | null; cls?: string | null }) => `${it.asset}:${it.layer ?? ''}:${it.cls ?? ''}`;

/**
 * Turn outfits over loadout items (item keys, see itemKey) into presets over this export's parts. Parts know
 * their item; older exports fall back to the source loadout's order. An item without a part (not rendered yet)
 * is left out.
 */
export function outfitPresets(m: LayersManifest, outfits: { id: string; name: string; items: string[] }[]): OutfitPreset[] {
  const src = m.source?.loadout ?? [];
  const itemOf = (p: LayerPartInfo, i: number) => p.item ?? (src.length === m.parts.length ? src[i] : undefined);
  const byKey = new Map<string, string>();
  const byAsset = new Map<string, string>();
  m.parts.forEach((p, i) => {
    const it = itemOf(p, i);
    if (!it) return;
    byKey.set(presetItemKey(it), p.name);
    byAsset.set(`${it.asset}:${it.cls ?? ''}`, p.name);
  });
  return outfits.map((o) => ({
    id: o.id, name: o.name,
    parts: [...new Set(o.items.map((k) => byKey.get(k) ?? byAsset.get(k.replace(/^(\d+):[^:]*:/, '$1:'))).filter((n): n is string => !!n))],
  }));
}

/** Merge a manifest rendered with `--align-to` (new parts and/or clips) into the one it aligned to. */
export function mergeManifests(base: LayersManifest, add: LayersManifest): LayersManifest {
  // New clips for the existing sheets (an extension: every added clip is new, pages numbered after the old ones):
  // the sheets keep their pages and gain the new ones. Otherwise an added part replaces the one of that name.
  const extension = add.body.pages.length > 0 && add.clips.length > 0 && add.clips.every((c) => !base.clips.some((b) => b.name === c.name));
  const parts = extension
    ? [
        ...base.parts.map((p) => {
          const q = add.parts.find((x) => x.name === p.name);
          return q ? { ...p, pages: [...new Set([...p.pages, ...q.pages])], files: [...new Set([...p.files, ...q.files])] } : p;
        }),
        ...add.parts.filter((q) => !base.parts.some((p) => p.name === q.name)),
      ]
    : [...base.parts.filter((p) => !add.parts.some((q) => q.name === p.name)), ...add.parts];
  const clips = [...base.clips.filter((c) => !add.clips.some((q) => q.name === c.name)), ...add.clips];
  const byName = new Map(base.animations.map((a) => [a.name, a]));
  for (const a of add.animations) {
    const cur = byName.get(a.name);
    if (!cur) byName.set(a.name, a);
    else byName.set(a.name, { ...cur, frames: cur.frames.map((f, i) => ({
      z: { ...f.z, ...a.frames[i]?.z }, front: { ...f.front, ...a.frames[i]?.front }, offset: { ...f.offset, ...a.frames[i]?.offset },
    })) });
  }
  const body = add.body.pages.length ? { pages: [...new Set([...base.body.pages, ...add.body.pages])], files: [...new Set([...base.body.files, ...add.body.files])] } : base.body;
  // What the merged export was made from: the added items join the earlier loadout (a parts-only render carries
  // only its own items), and a full re-render's set replaces the earlier one.
  const sameItem = (a: LoadoutItem, b: LoadoutItem) => a.asset === b.asset && (a.layer ?? null) === (b.layer ?? null) && (a.cls ?? null) === (b.cls ?? null);
  const set = !add.source || !base.source ? undefined
    : extension ? { ...base.source.set, items: [...base.source.set.items, ...add.source.set.items] }
    : add.body.pages.length ? add.source.set : base.source.set;
  const source = add.source && base.source
    ? { set: set!, gender: add.source.gender, loadout: [...base.source.loadout.filter((it) => !add.source!.loadout.some((o) => sameItem(o, it))), ...add.source.loadout], ...((base.source.profile ?? add.source.profile) ? { profile: base.source.profile ?? add.source.profile } : {}) }
    : add.source ?? base.source;
  // The alignment now covers the new clips too (their sample times, and the pages they added), so later renders
  // line up with all of them.
  const alignment = extension
    ? (() => {
        const a = { ...base.alignment, clips: [...base.alignment.clips, ...add.alignment.clips.filter((c) => !base.alignment.clips.some((b) => b.name === c.name))] };
        return { ...a, signature: alignmentSignature(a), parts: parts.map((p) => p.name), pages: body.pages.length };
      })()
    : { ...base.alignment, parts: parts.map((p) => p.name) };
  return {
    ...base, body: { ...base.body, ...body }, parts, clips, animations: [...byName.values()], validation: [...base.validation, ...add.validation], generator: add.generator,
    alignment,
    ...(source ? { source } : {}),
    ...((add.outfits ?? base.outfits) ? { outfits: (add.outfits ?? base.outfits)!.map((o) => ({ ...o, parts: o.parts.filter((n) => parts.some((p) => p.name === n)) })) } : {}),
  };
}

/** Take parts (layers) out of a manifest: their entries, their per-frame depth data and their loadout items. */
export function dropPartsFromManifest(m: LayersManifest, names: string[]): LayersManifest {
  const gone = new Set(names);
  const strip = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => !gone.has(k)));
  const parts = m.parts.filter((p) => !gone.has(p.name));
  return {
    ...m, parts,
    animations: m.animations.map((a) => ({ ...a, frames: a.frames.map((f) => ({ z: strip(f.z), front: strip(f.front), offset: strip(f.offset) })) })),
    alignment: { ...m.alignment, parts: parts.map((p) => p.name) },
    ...(m.source ? { source: { ...m.source, loadout: m.source.loadout.filter((it) => !gone.has(it.layer ?? '')) } } : {}),
    ...(m.outfits ? { outfits: m.outfits.map((o) => ({ ...o, parts: o.parts.filter((n) => !gone.has(n)) })) } : {}),
  };
}

/** Godot 4: a Node2D that stacks one AnimatedSprite2D per layer and re-orders them every frame. */
export const GODOT_LAYERS_GD = `# Generated by {{ generator.name }} {{ generator.version }} — layered sprite for {{ asset.name }}.
# Add as a child scene, call play("Walk_F_E", flip_h) and the body and equipment animate in step, each
# re-ordered per frame (z_index) from the export's depth data. Drop a part by removing it from PARTS.
# A part with a "cls" (weapon class) only shows during that class's clips ("<cls>_<clip>"); switch fighting
# styles by playing the other class's animation ("rifle_idle" -> "sword_idle").
class_name {{ base | pascal }}Layers
extends Node2D

const BODY := "{{ base }}.tres"
const PARTS := [
{%- for p in parts %}
	{ "name": "{{ p.name }}", "res": "{{ p.base }}.tres", "blend": "{{ p.blend }}", "cls": "{{ p.cls }}" },
{%- endfor %}
]
const OFFSET := Vector2({{ pivot.x | float }}, {{ pivot.y | float }})
const FRAME_WIDTH := {{ frameWidth | float }}
# Objects pivot on their anchor, which differs per direction: each rendered animation's own pivot. Godot's flip_h
# mirrors the texture inside its rect and leaves offset alone, so a flipped one uses x = FRAME_WIDTH - x.
const OFFSETS := {
{%- if pivotSource == "anchor" %}{%- for a in animations %}{% unless a.flipX %}
	"{{ a.name }}": Vector2({{ a.pivot.x | float }}, {{ a.pivot.y | float }}),{% endunless %}
{%- endfor %}{%- endif %}
}
# Per animation, per frame: which parts are in front of the body (true) or behind it.
const FRONT := {
{%- for a in animations %}
	"{{ a.name }}": [{% for f in a.frames %}{ {% for p in parts %}"{{ p.name }}": {{ f.front[p.name] }}{% unless forloop.last %}, {% endunless %}{% endfor %} }{% unless forloop.last %}, {% endunless %}{% endfor %}],
{%- endfor %}
}

var _sprites := {}

func _ready() -> void:
	var dir := get_script().resource_path.get_base_dir()
	_add_layer("body", dir.path_join(BODY), "normal")
	for p in PARTS:
		_add_layer(p["name"], dir.path_join(p["res"]), p["blend"])

func _add_layer(name: String, res: String, blend: String) -> void:
	var s := AnimatedSprite2D.new()
	s.name = name
	s.sprite_frames = load(res)
	s.centered = false
	s.offset = -OFFSET
	if blend == "add":
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		s.material = m
	add_child(s)
	_sprites[name] = s
	if name == "body":
		s.frame_changed.connect(_on_frame_changed)

func play(anim: String, flip_h := false) -> void:
	var pivot: Vector2 = OFFSETS.get(anim, OFFSET)
	if flip_h:
		pivot.x = FRAME_WIDTH - pivot.x
	for s in _sprites.values():
		s.flip_h = flip_h
		s.offset = -pivot
		if s.sprite_frames.has_animation(anim):
			s.play(anim)
	for p in PARTS:
		var cls: String = p["cls"]
		_sprites[p["name"]].visible = cls == "" or anim.begins_with(cls + "_")
	_on_frame_changed()

func _on_frame_changed() -> void:
	var body: AnimatedSprite2D = _sprites["body"]
	var frames = FRONT.get(body.animation, [])
	if frames.is_empty():
		return
	var f = frames[min(body.frame, frames.size() - 1)]
	for p in PARTS:
		var s: AnimatedSprite2D = _sprites[p["name"]]
		s.z_index = 1 if f.get(p["name"], true) else -1
`;

/** Per-engine files that compose the layers (beyond the manifest every format gets). */
export async function layersHelperFiles(profileId: string, m: LayersManifest): Promise<RenderedFile[]> {
  if (profileId !== 'godot4') return [];
  const content = await createLiquid().parseAndRender(GODOT_LAYERS_GD, m);
  return [{ name: `${m.base}_layers.gd`, content }];
}

/** The same loadout item as before? (asset and every option that changes its sheet) */
export const sameLoadoutItem = (a: LoadoutItem, b: LoadoutItem) =>
  a.asset === b.asset && JSON.stringify([a.target, a.pos, a.rot, a.scale, a.layers, a.depth, a.secondary, a.trigger, a.fix, a.fixRev]) === JSON.stringify([b.target, b.pos, b.rot, b.scale, b.layers, b.depth, b.secondary, b.trigger, b.fix, b.fixRev]);

/**
 * Compare the parts a render wants with what an earlier export of the same alignment holds: `missing` must be
 * rendered (new or changed items), `extra` are layers that export has and this render does not want (another
 * sprite's hair on the same model, an item taken off, a changed item's old sheet) and are dropped from the earlier
 * files before the new layers are merged in.
 */
export function diffParts<P extends { name: string; asset: string; item?: LoadoutItem }>(
  previous: { parts: { name: string; asset: string }[]; loadout: LoadoutItem[] }, parts: P[],
): { missing: P[]; extra: string[] } {
  const missing = parts.filter((p) => {
    const had = previous.parts.some((q) => q.name === p.name && q.asset === p.asset);
    const same = !!p.item && previous.loadout.some((it) => sameLoadoutItem(it, p.item!));
    return !(had && same);
  });
  // Layers to take out of the earlier files before the new ones go in: no longer wanted, or about to be replaced
  // by a same-named render of a changed item (else the old sheet and loadout entry would linger beside the new).
  const extra = previous.parts.filter((q) => !parts.some((p) => p.name === q.name) || missing.some((m) => m.name === q.name)).map((q) => q.name);
  return { missing, extra };
}
