// Moved from synty-sprite-generator packages/shared/src/model3d/manifest.ts (P3, ali3b/sloponator#14).
import type { ModelFit, ModelOrigin } from './spec.js';
import type { TrackPreset, TrackSlot } from './trackpiece.js';
import type { TerrainSlot, TerrainTile } from './terrain.js';
import type { SkydomePreset } from './skydome.js';

/**
 * The `.model.json` written next to every exported GLB. Units are metres, +Y is up and the model faces +Z (so +X
 * is its left). Positions are in the model's space: the GLB root node's frame, with the origin the spec asked for.
 */
export type ModelVec3 = [number, number, number];

export interface ModelPart {
  /** glTF node name (the node is pivoted here, so rotating it turns the part on its own axle or hinge). */
  node: string;
  role: string | null;
  /** The node's position in the model (its pivot). */
  pivot: ModelVec3;
  /** Wheels and other spinning parts: half their size across the spin axis. */
  radius?: number;
  /** Unit axis the part spins about (wheels: the axle), in the model's frame. Only spinning roles (SPIN_ROLES). */
  spinAxis?: ModelVec3;
  /** Doors and lids: the hinge (the node sits at `pos`); a positive angle about `axis` opens the part outward/upward. */
  hinge?: ModelHinge;
  /** Gauge needles (role `needle`, CS-FB-023): the unit axis it turns about; a positive angle turns it clockwise as the driver sees it. */
  axis?: ModelVec3;
}

export interface ModelHinge {
  /** The hinge's position in the model (the part's pivot). */
  pos: ModelVec3;
  /** Unit axis along the hinge, signed so a positive rotation opens the part. */
  axis: ModelVec3;
}

/** Roles that turn continuously: only these carry a radius and spin axis. */
export const SPIN_ROLES = ['wheel', 'propeller', 'track'] as const;
export const isSpinRole = (role: string | null | undefined) => !!role && (SPIN_ROLES as readonly string[]).includes(role);
/** Roles that swing on a hinge (bonnets and boots are lids). */
export const HINGE_ROLES = ['door', 'lid'] as const;
export const isHingeRole = (role: string | null | undefined) => !!role && (HINGE_ROLES as readonly string[]).includes(role);

/**
 * Hinges for door and lid parts from their boxes in the model's frame (+Z forward, +X left), when the source gives
 * no pivot. The box's thinnest axis says what the panel is:
 * - a side door (thin in X): its front edge, about Y, the rear edge swinging out from the centre line;
 * - a bonnet or boot lid (thin in Y): its edge nearest the cabin (the model's middle), about X, lifting up; a lid
 *   in the middle of the model (a chest) hinges at its back edge;
 * - an end panel (thin in Z, a tailgate or hatch): its bottom edge (folding down), or its top edge when it reaches
 *   the roof (a hatchback), about X, swinging out.
 * A part whose name extends another hinged part's (Door_L_Glass of Door_L) shares that part's hinge.
 */
export function hingesOf(parts: { name: string; role: string | null; min: number[]; max: number[] }[], model: { min: number[]; max: number[] }): Map<string, ModelHinge> {
  const out = new Map<string, ModelHinge>();
  const mc = model.min.map((v, i) => (v + model.max[i]) / 2);
  const ms = model.max.map((v, i) => v - model.min[i]);
  const hinged = parts.filter((p) => isHingeRole(p.role));
  const own = (p: (typeof hinged)[number]): ModelHinge => {
    const c = p.min.map((v, i) => (v + p.max[i]) / 2);
    const size = p.max.map((v, i) => v - p.min[i]);
    const thin = size.indexOf(Math.min(...size));
    const sgn = (v: number) => (v < 0 ? -1 : 1);
    if (thin === 0) {
      const side = sgn(c[0] - mc[0]);
      return { pos: [c[0], c[1], p.max[2]], axis: [0, -side, 0] };
    }
    if (thin === 1) {
      const middle = Math.abs(c[2] - mc[2]) < ms[2] * 0.1;
      const z = middle || c[2] > mc[2] ? p.min[2] : p.max[2];
      const dir = sgn(c[2] - z);
      return { pos: [c[0], p.max[1], z], axis: [-dir, 0, 0] };
    }
    const out_ = sgn(c[2] - mc[2]);
    // A hatch reaches the roof line; a tailgate (even on a lifted truck) stops well below it.
    const top = p.max[1] >= model.max[1] - ms[1] * 0.12;
    return top ? { pos: [c[0], p.max[1], c[2]], axis: [-out_, 0, 0] } : { pos: [c[0], p.min[1], c[2]], axis: [out_, 0, 0] };
  };
  const byLen = [...hinged].sort((a, b) => a.name.length - b.name.length);
  for (const p of byLen) {
    const parent = byLen.find((q) => q !== p && q.name.length < p.name.length && p.name.startsWith(q.name) && out.has(q.name));
    const h = parent ? out.get(parent.name)! : own(p);
    out.set(p.name, { pos: h.pos.map((v) => r4(v)) as ModelVec3, axis: h.axis.map((v) => v + 0) as ModelVec3 });
  }
  return out;
}

export type WheelSlot = 'fl' | 'fr' | 'rl' | 'rr';
export const WHEEL_SLOTS: WheelSlot[] = ['fl', 'fr', 'rl', 'rr'];

export interface ModelWheel {
  node: string;
  radius: number;
  /** Axle direction (unit vector the wheel spins about), in the model's frame. */
  axle: ModelVec3;
  /** Front wheels steer. */
  steer: boolean;
  /** The wheel's centre in the model (same as its part's pivot). */
  pos: ModelVec3;
}

export interface ModelSocket {
  name: string;
  /** Node the socket follows (a bone for characters; the root for props and weapons). */
  node: string;
  /** Offset in the node's frame (metres for the root; bones carry their own scale). */
  pos: ModelVec3;
  /** Rotation in the node's frame, a quaternion [x, y, z, w] (track pieces: +Z to forward, +Y to up). */
  rot: [number, number, number, number];
  /** Track pieces: the direction of travel there and the deck's up (unit vectors), exact to 0.1 mm. */
  forward?: ModelVec3;
  up?: ModelVec3;
  /** Track pieces: `in` when forward points into the piece, `out` when it points out (join an out to an in). */
  dir?: 'in' | 'out';
  /** Track pieces: the end's kind (road, elevated, banked-left, banked-right, pipe, halfpipe, tunnel, or the spec's edge, e.g. highway), its width and bank. */
  edge?: string;
  width?: number;
  bank?: number;
  /** Track pieces: a divided road's median strip width (CS-FB-012), when it has one. */
  median?: number;
}

/** What a track piece export was made of (manifest.source for a trackpiece spec). */
export interface ModelTrackSource {
  kind: 'trackpiece';
  /** The preset, or null for a custom path. */
  preset: TrackPreset | null;
  /** Each slot's material: the reference asked for, the swatch it gave (its colour and where in which atlas), and how. */
  materials: Record<TrackSlot, ModelTrackMaterial>;
}

export interface ModelTrackMaterial {
  ref: string;
  color: string;
  /** The library asset (or material) the swatch was sampled from, when it came from one. */
  pack?: string;
  asset?: string;
  assetId?: number;
  material?: string;
  /** The source atlas and the swatch's UV in it (so a game can map to the original Synty texture). */
  texture?: string;
  uv?: [number, number];
  /** Set when the reference could not be used and the default colour stands in. */
  fallback?: string;
}

/** What a terrain export was made of (CS-FB-003). */
export interface ModelTerrainSource {
  kind: 'terrain';
  /** The tile kind (and its dir), or null for a grid. */
  tile: TerrainTile | null;
  dir?: string;
  materials: Record<TerrainSlot, ModelTrackMaterial>;
}

/** What a skydome export was made of (CS-FB-004). */
export interface ModelSkydomeSource {
  kind: 'skydome';
  preset: SkydomePreset;
  /** The silhouette ring's props (those found in the library). */
  ring: { ref: string; pack: string; asset: string; assetId: number }[];
}

/** What a composite export was made of (CS-FB-024): its parts' library assets, in spec order. */
export interface ModelCompositeSource {
  kind: 'composite';
  parts: { name: string; pack: string; asset: string; assetId: number }[];
}

/** A composite's parts (manifest.composite): each part's node and where it was placed. */
export interface ModelCompositeInfo {
  parts: {
    /** The part's node (a child of the root, carrying the placement as its transform). */
    node: string;
    pack: string;
    asset: string;
    assetId: number;
    pos: ModelVec3;
    /** The placement's rotation, a quaternion [x, y, z, w], and its scale. */
    rot: [number, number, number, number];
    scale: ModelVec3;
    /** The part's own box in the composite's frame. */
    bounds: ModelBounds;
  }[];
  /** Materials and textures after the merge (identical ones from different parts are shared). */
  materials: number;
  textures: number;
}

/** A terrain's grid facts (manifest.terrain). */
export interface ModelTerrainInfo {
  cell: number;
  /** One height step, metres. */
  step: number;
  /** Tiles [across X, along Z]; the lowest tile's corner [x, z] (grid lines as track pieces'). */
  tiles: [number, number];
  gridMin: [number, number];
  subdiv: number;
  shape: 'planar' | 'track';
  /** The chunk nodes and the tiles each covers [i0, j0, i1, j1) (end exclusive). */
  chunks: { node: string; tiles: [number, number, number, number]; triangles: number }[];
  /** Water: the surface height, its nodes (one per chunk that has water, material TerrainWater) and the tiles with water. */
  water: { level: number; nodes: string[]; tiles: number } | null;
  /** Scatter: per prop, the instanced node (EXT_mesh_gpu_instancing) and how many. */
  scatter: { asset: string; pack: string; assetId: number; node: string; count: number }[];
}

/** A skydome's facts (manifest.skydome). */
export interface ModelSkydomeInfo {
  radius: number;
  colors: { zenith: string; horizon: string; ground: string; ring: string };
  /** The dome's node (unlit, vertex colours, facing in) and the ring's (null without one). */
  dome: string;
  ring: { node: string; props: number; triangles: number } | null;
  /** An equirectangular PNG of the same sky (three.js EquirectangularReflectionMapping), next to the GLB; null when turned off. */
  panorama: { file: string; width: number; height: number } | null;
}

/** A track piece's grid facts (manifest.trackpiece). */
export interface ModelTrackInfo {
  cell: number;
  /** Cells covered [across X, along Z], and the corner [x, z] of the lowest cell (grid lines at x = ±cell/2 + k·cell, z = k·cell). */
  footprint: [number, number];
  gridMin: [number, number];
  /** Centre-line length of the main path, metres. */
  length: number;
  supports: string;
}

export interface ModelClip {
  /** Animation name in the GLB (the clip's name in the library). */
  name: string;
  /** Seconds, after the clip's trim and speed. */
  duration: number;
  loop: boolean;
  /** Ground speed of a locomotion cycle (metres a second), when it is known. */
  speedMps?: number;
  /** Named moments (seconds in the exported clip): hit, release, footstep_l… */
  events?: { t: number; name: string }[];
  /** The library clip it came from: several share a name across genders, rig families and packs. */
  source?: ModelClipSource;
}

/** Which library clip a clip (or a baked pose) came from. */
export interface ModelClipSource {
  /** Animation id: always names this clip (`clips: ["859"]`). */
  id: number;
  pack: string;
  /** The clip's library name. */
  name: string;
  /** Masculine, Feminine or Neutral (Synty's gender folders); null when the pack has none. */
  variant: string | null;
  /** Rig family (Polygon, Sidekick); null when the pack has none. */
  set: string | null;
}

/** One baked pose of a posed export (ModelSpec.pose / poses): a static mesh, no skin. */
export interface ModelPoseInfo {
  name: string;
  /** The node holding the pose's mesh (the root node for a single `pose`). */
  node: string;
  /** The clip as the spec named it, and the time baked (seconds into the clip as exported). */
  clip: string;
  time: number;
  source?: ModelClipSource;
  /** This pose's own box (the manifest's bounds hold every pose). */
  bounds: ModelBounds;
}

export interface ModelBounds {
  min: ModelVec3;
  max: ModelVec3;
  size: ModelVec3;
}

export const MODEL_LICENCE = 'Synty Store EULA: not for redistribution as source assets' as const;

export interface ModelManifest {
  version: 1;
  name: string;
  /** The library asset, or for a track piece, terrain or skydome what it was built from. */
  source: { pack: string; asset: string; assetId: number } | ModelTrackSource | ModelTerrainSource | ModelSkydomeSource | ModelCompositeSource;
  units: 'm';
  forward: '+Z';
  up: '+Y';
  /** `entry` for a track piece: the origin is on the ground under its entry socket, in the middle of its entry cell edge. */
  origin: ModelOrigin | 'entry' | 'tile' | 'centre' | 'composite';
  bounds: ModelBounds;
  parts: ModelPart[];
  wheels?: Record<WheelSlot, ModelWheel>;
  sockets: ModelSocket[];
  clips: ModelClip[];
  collider: ModelCollider;
  licence: typeof MODEL_LICENCE;
  /** Track pieces: the grid it sits on. */
  trackpiece?: ModelTrackInfo;
  /** Terrain: the grid, chunks, water and scatter. */
  terrain?: ModelTerrainInfo;
  skydome?: ModelSkydomeInfo;
  /** Composites: the parts and their placements. */
  composite?: ModelCompositeInfo;
  /**
   * Present when the spec asked for a `fit`: the uniform scale applied on top of the library's metre size, and the
   * dimensions asked for. Everything in the manifest (and the GLB) is already scaled.
   */
  scale?: { modelScale: number; fit: ModelFit };
  /**
   * Paint variants (KHR_materials_variants), in the GLB's variant order: switch a variant's materials in with its
   * index. The first is the GLB's default look. `tint` is null for the model's own colours.
   */
  variants?: { name: string; tint: string | null }[];
  /** Geometry compression the GLB uses: a loader needs its decoder (three.js: MeshoptDecoder). */
  compress?: 'meshopt';
  /**
   * Characters: the pose `bounds` and `collider` measure, `clip:<name>` (the first frame of the first clip) or
   * `rest` (the bind pose with the arms lowered), never the T-pose.
   */
  pose?: string;
  /**
   * Posed exports (ModelSpec.pose / poses): the baked static meshes, in spec order. All share the origin (the first
   * pose's bottom centre), so a game can swap between them in place.
   */
  poses?: ModelPoseInfo[];
  /**
   * splitBySwatch exports (OR-FB-022): the nodes the model's triangles were split into, one per palette swatch
   * colour (a traffic light's red, amber and green lamps), each with its own material.
   */
  swatches?: ModelSwatch[];
  /**
   * Seating (OR-FB-024: grandstands, bleachers, benches): one seat per entry, `[x, y, z, yaw]`: the point on the seat
   * surface (metres, model frame) and the yaw in radians about +Y a seated person faces (0 = +Z, π/2 = +X).
   */
  seats?: ModelSeat[];
  /**
   * CS-FB-025: levels of detail (ModelSpec.lods): a node per level under the root, `LOD0` (the model) first. Each
   * level is a whole copy of the model at fewer triangles: the source file's own LOD meshes where it ships them
   * (Synty's `_LOD1`, `_LOD2`…), else LOD0 simplified.
   */
  lods?: ModelLod[];
  /**
   * CS-FB-023: the instrument cluster of a vehicle with gauges (Street Racer speedometers): each dial and the needle
   * that turns on it, so an in-car view can drive the needles.
   */
  dashboard?: ModelDashboard;
  /** Things the exporter could not do as asked (an unsupported option, a clip it skipped). */
  warnings?: string[];
}

/** One level of detail (ModelManifest.lods). */
export interface ModelLod {
  /** 0 is the model itself. */
  level: number;
  /** The node holding this level (show one level at a time: three.js LOD.addLevel(node, distance)). */
  node: string;
  /** The share of LOD0's triangles asked for (1 for LOD0). */
  ratio: number;
  triangles: number;
  /** Where the geometry came from: the model, the source file's own LOD mesh, or LOD0 simplified. */
  source: 'model' | 'synty' | 'simplified';
}

/** A gauge of a dashboard (ModelDashboard.gauges). */
export interface ModelGauge {
  /** The dial's node (role `gauge`). */
  node: string;
  /** The dial face's centre (metres, model frame). */
  center: ModelVec3;
  /** Unit normal of the dial face, towards the driver. */
  normal: ModelVec3;
  /** The dial's radius (metres): half its larger extent across the normal. */
  radius: number;
  /** The needle that turns on this dial, when the model has one. */
  needle?: ModelNeedle;
}

/** A gauge needle (role `needle`). */
export interface ModelNeedle {
  node: string;
  /** Where the needle turns (its node sits here). */
  pivot: ModelVec3;
  /** Unit axis it turns about (into the dial): a positive angle turns it clockwise as the driver sees it. */
  axis: ModelVec3;
  /** Unit direction it points at rest (from the pivot to its tip). The dial's range is not in the source files. */
  rest: ModelVec3;
  /** Length from the pivot to the tip (metres). */
  length: number;
}

/** CS-FB-023: a vehicle's instrument cluster (ModelManifest.dashboard). */
export interface ModelDashboard {
  gauges: ModelGauge[];
}

/**
 * The collider: always the box; with `collider: trimesh` also a GLB node holding a triangle mesh (no material, extras
 * `{ collider: true }`): a track piece's drivable surfaces and walls, or an asset's visual mesh; with `collider: convex`
 * a node holding the convex hull of the visual mesh (extras `{ collider: true, convex: true }`). A trimesh or convex
 * collider of an asset leaves out its moving parts (`excluded`: wheels, steering wheel, doors by default).
 */
export interface ModelCollider {
  box: { center: ModelVec3; size: ModelVec3 };
  trimesh?: { node: string; triangles: number; vertices: number; excluded?: string[] };
  convex?: { node: string; triangles: number; vertices: number; excluded?: string[] };
}

/** Whether a manifest is a track piece's. */
export const isTrackSource = (s: ModelManifest['source']): s is ModelTrackSource => (s as ModelTrackSource).kind === 'trackpiece';
/** What a manifest's source says in a line: Pack/Asset, trackpiece loop, terrain slope, skydome desert. */
export function sourceLabel(s: ModelManifest['source'] | undefined): string {
  if (!s) return '?';
  if ('kind' in s) {
    if (s.kind === 'trackpiece') return `trackpiece ${s.preset ?? 'custom'}`;
    if (s.kind === 'terrain') return `terrain ${s.tile ? `${s.tile}${s.dir ? ` ${s.dir}` : ''}` : 'grid'}`;
    if (s.kind === 'composite') return `composite of ${s.parts.length} (${[...new Set(s.parts.map((p) => p.asset))].join(', ')})`;
    return `skydome ${s.preset}`;
  }
  return `${s.pack ?? '?'}/${s.asset ?? '?'}`;
}

/** One swatch node of a splitBySwatch export: its node, the node it hangs under, the colour and its triangles. */
export interface ModelSwatch {
  node: string;
  parent: string;
  /** #rrggbb: the atlas texel the triangles sample. */
  color: string;
  triangles: number;
}

/** A seat: [x, y, z, yaw] (metres in the model frame; yaw in radians about +Y, 0 faces +Z). */
export type ModelSeat = [number, number, number, number];

/** What POST /api/models/export and GET /api/models/:id return. */
export interface ModelExportResult {
  /** The spec hash: the folder under data/models/. */
  id: string;
  name: string;
  glbUrl: string;
  manifestUrl: string;
  manifest: ModelManifest;
  /** True when the model was already built for this spec (and its sources had not changed). */
  cached: boolean;
  /**
   * The build's revision: changes when the same spec is rebuilt (a source, the scale fix or the exporter changed),
   * while the id stays. `ssg model apply` downloads again when it differs.
   */
  rev?: string;
  /**
   * CS-FB-010: served from the cache although the asset's pack is being re-ingested (the reason). The files are the
   * last export of this spec.
   */
  stale?: string;
}

/** What GET /api/models/info?asset= returns (nothing is exported). */
export interface ModelInfo {
  asset: { id: number; name: string; pack: string };
  kind: string;
  /** Size in metres (x, y, z) with the scale fix applied. */
  sizeM: ModelVec3 | null;
  /** Parts as an export with the default origin would list them. */
  parts: ModelPart[];
  wheels: Record<WheelSlot, ModelWheel> | null;
  /**
   * Clips a character can take (empty for other kinds): a name that only one clip has as is, others qualified so
   * each entry names one clip (`Idle@Feminine`, `Idle@Masculine@Sidekick`, `Idle@#859`).
   */
  clipsAvailable: string[];
  /** Bundled attachments of the same file that `attach` can name. */
  attachAvailable?: string[];
  /**
   * CS-FB-008: same-pack assets named after this one (`<asset>_Body_NN`, bumpers, spoilers, skirts, `_Attach_` pieces):
   * `attach` takes them by name. A vehicle with `body` companions exports as a bare chassis without one.
   */
  companions?: ModelCompanion[];
}

export type ModelCompanionSlot = 'body' | 'bumper' | 'spoiler' | 'skirt' | 'wheel' | 'attach' | 'part';

/** A companion piece of a vehicle (CS-FB-008). */
export interface ModelCompanion {
  id: number;
  name: string;
  kind: string;
  slot: ModelCompanionSlot;
}

/** A road wheel: a part with the wheel role that is not the steering wheel (some packs tag that a wheel too). */
export function isRoadWheel(p: { node?: string; name?: string; role: string | null }) {
  return p.role === 'wheel' && !/steer/i.test(p.node ?? p.name ?? '');
}

/**
 * The wheel slot a part name says: Wheel_FL, Wheel_fl, Wheel_Front_L, Wheel_F_L, Wheel_LF, FrontLeftWheel… Null
 * when the name does not say both front/rear and left/right.
 */
export function wheelSlotOf(name: string): WheelSlot | null {
  const n = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (!/wheel|tyre|tire/.test(n)) return null;
  const tail = n.replace(/.*?(wheels?|tyres?|tires?)/, '');
  const head = n.replace(/(wheels?|tyres?|tires?).*$/, '');
  for (const part of [tail, head]) {
    const toks = part.split(/[_\s.-]+/).filter(Boolean);
    let fb: 'f' | 'r' | null = null, lr: 'l' | 'r' | null = null;
    for (const t of toks) {
      if (t === 'front') fb = 'f';
      else if (t === 'rear' || t === 'back') fb = 'r';
      else if (t === 'left') lr = 'l';
      else if (t === 'right') lr = 'r';
      else if (/^(f|r|b)(l|r)$/.test(t)) {
        fb = t[0] === 'f' ? 'f' : 'r';
        lr = t[1] as 'l' | 'r';
      }
      else if (/^(l|r)(f|r|b)$/.test(t)) {
        lr = t[0] as 'l' | 'r';
        fb = t[1] === 'f' ? 'f' : 'r';
      }
      else if (t === 'f') fb = 'f';
      else if (t === 'b') fb = 'r';
      else if (t === 'l') lr = 'l';
      else if (t === 'r') {
        // A lone "r" is rear before a side is known (Wheel_R_L), right after a front/rear (Wheel_F_R).
        if (fb && !lr) lr = 'r';
        else if (!fb) fb = 'r';
      }
    }
    if (fb && lr) return `${fb === 'f' ? 'f' : 'r'}${lr}` as WheelSlot;
  }
  return null;
}

/**
 * The four corner wheels of a vehicle: by name where the names say (Wheel_FL…), else by position (front = +Z,
 * left = +X, for a model facing +Z). Vehicles with other than four wheels get the outermost four corners; null
 * when there are fewer than four.
 */
export function mapWheels<W extends { node: string; pos: ModelVec3 }>(wheels: W[]): Record<WheelSlot, W> | null {
  if (wheels.length < 4) return null;
  const out: Partial<Record<WheelSlot, W>> = {};
  for (const w of wheels) {
    const s = wheelSlotOf(w.node);
    if (s && !out[s]) out[s] = w;
  }
  if (WHEEL_SLOTS.every((s) => out[s])) return out as Record<WheelSlot, W>;
  // By position: the corner each wheel is nearest, the most extreme wheel winning each corner.
  const zs = wheels.map((w) => w.pos[2]);
  const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const pick = (front: boolean, left: boolean) =>
    wheels
      .filter((w) => (front ? w.pos[2] > midZ : w.pos[2] <= midZ) && (left ? w.pos[0] > 0 : w.pos[0] <= 0))
      .sort((a, b) => (front ? b.pos[2] - a.pos[2] : a.pos[2] - b.pos[2]) || Math.abs(b.pos[0]) - Math.abs(a.pos[0]))[0];
  const byPos = { fl: pick(true, true), fr: pick(true, false), rl: pick(false, true), rr: pick(false, false) };
  return WHEEL_SLOTS.every((s) => byPos[s]) ? (byPos as Record<WheelSlot, W>) : null;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/** Bounds (and size) from a min and max, rounded to 0.1 mm. */
export function boundsOf(min: ModelVec3, max: ModelVec3): ModelBounds {
  return { min: min.map(r4) as ModelVec3, max: max.map(r4) as ModelVec3, size: max.map((v, i) => r4(v - min[i])) as ModelVec3 };
}

/** The collider box a manifest offers: the model's bounds as a centre and size. */
export function colliderOf(b: ModelBounds): ModelManifest['collider'] {
  return { box: { center: b.min.map((v, i) => r4((v + b.max[i]) / 2)) as ModelVec3, size: b.size.map(r4) as ModelVec3 } };
}
