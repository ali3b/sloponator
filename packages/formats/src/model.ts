/**
 * `ssg-model`: the `<name>.model.json` written next to every exported GLB (P3, ali3b/sloponator#14). Mirrors
 * field for field the old generator's packages/shared/src/model3d/manifest.ts `ModelManifest` (now
 * @slop/models3d spec/manifest.ts): units are metres, +Y is up and the model faces +Z (so +X is its left).
 * Positions are in the model's space: the GLB root node's frame, with the origin the spec asked for. Also the
 * `models.json` index a build writes beside the files (`ssg-models-index`).
 */
import { z } from 'zod';
import { SKYDOME_PRESETS, TERRAIN_TILES, TRACK_PRESETS } from '@slop/schema';

export const modelVec3 = z.tuple([z.number(), z.number(), z.number()]);
export type ModelVec3 = z.infer<typeof modelVec3>;
export const modelQuat = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const MODEL_LICENCE = 'Synty Store EULA: not for redistribution as source assets' as const;
export const MODEL_ORIGINS = ['bottom-centre', 'axle-centre', 'pivot'] as const;
export const WHEEL_SLOTS = ['fl', 'fr', 'rl', 'rr'] as const;
export const TRACK_SLOTS = ['deck', 'kerb', 'kerbAlt', 'wall', 'support'] as const;
export const TERRAIN_SLOTS = ['ground', 'slope', 'shore', 'seabed', 'water', 'skirt'] as const;

/** Doors and lids: the hinge (the part's node sits at `pos`); a positive angle about `axis` opens the part. */
export const modelHinge = z.object({ pos: modelVec3, axis: modelVec3 });
export type ModelHinge = z.infer<typeof modelHinge>;

/** A rigid part (wheel, door, turret…): its glTF node, pivoted so rotating it turns the part on its own axle or hinge. */
export const modelPart = z.object({
  node: z.string(),
  role: z.string().nullable(),
  /** The node's position in the model (its pivot). */
  pivot: modelVec3,
  /** Wheels and other spinning parts: half their size across the spin axis. */
  radius: z.number().optional(),
  /** Unit axis the part spins about (wheels: the axle), in the model's frame. Only spinning roles. */
  spinAxis: modelVec3.optional(),
  hinge: modelHinge.optional(),
  /** Gauge needles: the unit axis it turns about. */
  axis: modelVec3.optional(),
});
export type ModelPart = z.infer<typeof modelPart>;

export const modelWheel = z.object({
  node: z.string(),
  radius: z.number(),
  /** Axle direction (unit vector the wheel spins about), in the model's frame. */
  axle: modelVec3,
  /** Front wheels steer. */
  steer: z.boolean(),
  /** The wheel's centre in the model (same as its part's pivot). */
  pos: modelVec3,
});
export type ModelWheel = z.infer<typeof modelWheel>;

export const modelSocket = z.object({
  name: z.string(),
  /** Node the socket follows (a bone for characters; the root for props and weapons). */
  node: z.string(),
  /** Offset in the node's frame (metres for the root; bones carry their own scale). */
  pos: modelVec3,
  /** Rotation in the node's frame, a quaternion [x, y, z, w]. */
  rot: modelQuat,
  /** Track pieces: the direction of travel there and the deck's up (unit vectors). */
  forward: modelVec3.optional(),
  up: modelVec3.optional(),
  /** Track pieces: `in` when forward points into the piece, `out` when it points out. */
  dir: z.enum(['in', 'out']).optional(),
  /** Track pieces: the end's kind, width, bank and a divided road's median width. */
  edge: z.string().optional(),
  width: z.number().optional(),
  bank: z.number().optional(),
  median: z.number().optional(),
});
export type ModelSocket = z.infer<typeof modelSocket>;

/** A track piece or terrain slot's material: the reference asked for, the swatch it gave and where it came from. */
export const modelTrackMaterial = z.object({
  ref: z.string(),
  color: z.string(),
  pack: z.string().optional(),
  asset: z.string().optional(),
  assetId: z.number().optional(),
  material: z.string().optional(),
  /** The source atlas and the swatch's UV in it. */
  texture: z.string().optional(),
  uv: z.tuple([z.number(), z.number()]).optional(),
  /** Set when the reference could not be used and the default colour stands in. */
  fallback: z.string().optional(),
});
export type ModelTrackMaterial = z.infer<typeof modelTrackMaterial>;

const slotMaterials = <S extends readonly [string, ...string[]]>(slots: S) => z.object(Object.fromEntries(slots.map((s) => [s, modelTrackMaterial])) as Record<S[number], typeof modelTrackMaterial>);

/** The library asset an export was made from. */
export const modelAssetSource = z.object({ pack: z.string(), asset: z.string(), assetId: z.number() });
export const modelTrackSource = z.object({ kind: z.literal('trackpiece'), preset: z.enum(TRACK_PRESETS).nullable(), materials: slotMaterials(TRACK_SLOTS) });
export const modelTerrainSource = z.object({ kind: z.literal('terrain'), tile: z.enum(TERRAIN_TILES).nullable(), dir: z.string().optional(), materials: slotMaterials(TERRAIN_SLOTS) });
export const modelSkydomeSource = z.object({ kind: z.literal('skydome'), preset: z.enum(SKYDOME_PRESETS), ring: z.array(modelAssetSource.extend({ ref: z.string() })) });
export const modelCompositeSource = z.object({ kind: z.literal('composite'), parts: z.array(modelAssetSource.extend({ name: z.string() })) });
export const modelSource = z.union([modelAssetSource, modelTrackSource, modelTerrainSource, modelSkydomeSource, modelCompositeSource]);
export type ModelSource = z.infer<typeof modelSource>;

export const modelBounds = z.object({ min: modelVec3, max: modelVec3, size: modelVec3 });
export type ModelBounds = z.infer<typeof modelBounds>;

/** Which library clip a clip (or a baked pose) came from. */
export const modelClipSource = z.object({ id: z.number(), pack: z.string(), name: z.string(), variant: z.string().nullable(), set: z.string().nullable() });
export type ModelClipSource = z.infer<typeof modelClipSource>;

export const modelClip = z.object({
  /** Animation name in the GLB. */
  name: z.string(),
  /** Seconds, after the clip's trim and speed. */
  duration: z.number(),
  loop: z.boolean(),
  /** Ground speed of a locomotion cycle (metres a second), when it is known. */
  speedMps: z.number().optional(),
  /** Named moments (seconds in the exported clip): hit, release, footstep_l… */
  events: z.array(z.object({ t: z.number(), name: z.string() })).optional(),
  source: modelClipSource.optional(),
});
export type ModelClip = z.infer<typeof modelClip>;

/** One baked pose of a posed export: a static mesh, no skin. */
export const modelPoseInfo = z.object({
  name: z.string(),
  /** The node holding the pose's mesh (the root node for a single `pose`). */
  node: z.string(),
  clip: z.string(),
  time: z.number(),
  source: modelClipSource.optional(),
  bounds: modelBounds,
});
export type ModelPoseInfo = z.infer<typeof modelPoseInfo>;

const colliderMesh = z.object({ node: z.string(), triangles: z.number(), vertices: z.number(), excluded: z.array(z.string()).optional() });

/** The collider: always the box; with trimesh/convex also a GLB node holding the mesh (extras `{ collider: true }`). */
export const modelCollider = z.object({
  box: z.object({ center: modelVec3, size: modelVec3 }),
  trimesh: colliderMesh.optional(),
  convex: colliderMesh.optional(),
});
export type ModelCollider = z.infer<typeof modelCollider>;

/** A track piece's grid facts. */
export const modelTrackInfo = z.object({
  cell: z.number(),
  footprint: z.tuple([z.number(), z.number()]),
  gridMin: z.tuple([z.number(), z.number()]),
  /** Centre-line length of the main path, metres. */
  length: z.number(),
  supports: z.string(),
});
export type ModelTrackInfo = z.infer<typeof modelTrackInfo>;

/** A terrain's grid, chunks, water and scatter. */
export const modelTerrainInfo = z.object({
  cell: z.number(),
  step: z.number(),
  tiles: z.tuple([z.number(), z.number()]),
  gridMin: z.tuple([z.number(), z.number()]),
  subdiv: z.number(),
  shape: z.enum(['planar', 'track']),
  chunks: z.array(z.object({ node: z.string(), tiles: z.tuple([z.number(), z.number(), z.number(), z.number()]), triangles: z.number() })),
  water: z.object({ level: z.number(), nodes: z.array(z.string()), tiles: z.number() }).nullable(),
  scatter: z.array(z.object({ asset: z.string(), pack: z.string(), assetId: z.number(), node: z.string(), count: z.number() })),
});
export type ModelTerrainInfo = z.infer<typeof modelTerrainInfo>;

/** A skydome's facts. */
export const modelSkydomeInfo = z.object({
  radius: z.number(),
  colors: z.object({ zenith: z.string(), horizon: z.string(), ground: z.string(), ring: z.string() }),
  dome: z.string(),
  ring: z.object({ node: z.string(), props: z.number(), triangles: z.number() }).nullable(),
  /** An equirectangular PNG of the same sky next to the GLB; null when turned off. */
  panorama: z.object({ file: z.string(), width: z.number(), height: z.number() }).nullable(),
});
export type ModelSkydomeInfo = z.infer<typeof modelSkydomeInfo>;

/** A composite's parts and their placements. */
export const modelCompositeInfo = z.object({
  parts: z.array(z.object({ node: z.string(), pack: z.string(), asset: z.string(), assetId: z.number(), pos: modelVec3, rot: modelQuat, scale: modelVec3, bounds: modelBounds })),
  materials: z.number(),
  textures: z.number(),
});
export type ModelCompositeInfo = z.infer<typeof modelCompositeInfo>;

/** One level of detail: a node per level under the root, `LOD0` (the model) first. */
export const modelLod = z.object({
  level: z.number(),
  node: z.string(),
  /** The share of LOD0's triangles asked for (1 for LOD0). */
  ratio: z.number(),
  triangles: z.number(),
  source: z.enum(['model', 'synty', 'simplified']),
});
export type ModelLod = z.infer<typeof modelLod>;

export const modelNeedle = z.object({ node: z.string(), pivot: modelVec3, axis: modelVec3, rest: modelVec3, length: z.number() });
export const modelGauge = z.object({ node: z.string(), center: modelVec3, normal: modelVec3, radius: z.number(), needle: modelNeedle.optional() });
/** A vehicle's instrument cluster: each dial and the needle that turns on it. */
export const modelDashboard = z.object({ gauges: z.array(modelGauge) });
export type ModelDashboard = z.infer<typeof modelDashboard>;

/** One swatch node of a splitBySwatch export. */
export const modelSwatch = z.object({ node: z.string(), parent: z.string(), color: z.string(), triangles: z.number() });
export type ModelSwatch = z.infer<typeof modelSwatch>;

/** A seat: [x, y, z, yaw] (metres in the model frame; yaw in radians about +Y, 0 faces +Z). */
export const modelSeat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type ModelSeat = z.infer<typeof modelSeat>;

export const ssgModel = z.strictObject({
  version: z.literal(1),
  name: z.string(),
  /** The library asset, or for a track piece, terrain, skydome or composite what it was built from. */
  source: modelSource,
  units: z.literal('m'),
  forward: z.literal('+Z'),
  up: z.literal('+Y'),
  /** `entry` for a track piece (the origin on the ground under its entry socket), `tile` / `centre` for terrain, `composite`. */
  origin: z.enum([...MODEL_ORIGINS, 'entry', 'tile', 'centre', 'composite']),
  bounds: modelBounds,
  parts: z.array(modelPart),
  wheels: z.object(Object.fromEntries(WHEEL_SLOTS.map((s) => [s, modelWheel])) as Record<(typeof WHEEL_SLOTS)[number], typeof modelWheel>).optional(),
  sockets: z.array(modelSocket),
  clips: z.array(modelClip),
  collider: modelCollider,
  licence: z.literal(MODEL_LICENCE),
  trackpiece: modelTrackInfo.optional(),
  terrain: modelTerrainInfo.optional(),
  skydome: modelSkydomeInfo.optional(),
  composite: modelCompositeInfo.optional(),
  /** Present when the spec asked for a `fit`: the uniform scale applied on top of the library's metre size. */
  scale: z.object({ modelScale: z.number(), fit: z.object({ length: z.number().optional(), width: z.number().optional(), height: z.number().optional() }) }).optional(),
  /** Paint variants (KHR_materials_variants), in the GLB's variant order; the first is the default look. */
  variants: z.array(z.object({ name: z.string(), tint: z.string().nullable() })).optional(),
  /** Geometry compression the GLB uses: a loader needs its decoder (three.js: MeshoptDecoder). */
  compress: z.literal('meshopt').optional(),
  /** Characters: the pose `bounds` and `collider` measure (`clip:<name>` or `rest`). */
  pose: z.string().optional(),
  poses: z.array(modelPoseInfo).optional(),
  swatches: z.array(modelSwatch).optional(),
  seats: z.array(modelSeat).optional(),
  lods: z.array(modelLod).optional(),
  dashboard: modelDashboard.optional(),
  /** Things the exporter could not do as asked. */
  warnings: z.array(z.string()).optional(),
});
export type SsgModel = z.infer<typeof ssgModel>;

/** The `models.json` index a build writes beside the files: name → files, id, revision and the manifest itself. */
export const ssgModelsIndex = z.strictObject({
  version: z.literal(1),
  models: z.record(
    z.string(),
    z.strictObject({
      /** The export id (spec hash) and build revision: unchanged id and rev = unchanged files. */
      id: z.string(),
      rev: z.string().optional(),
      /** The asset, or `trackpiece:<preset>`, `terrain:<tile|grid>`, `skydome:<preset>`, `composite:<parts>`. */
      asset: z.union([z.string(), z.number()]),
      glb: z.string(),
      manifest: z.string(),
      data: ssgModel,
    }),
  ),
});
export type SsgModelsIndex = z.infer<typeof ssgModelsIndex>;
