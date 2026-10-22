/**
 * The plain objects the library hands out. Names stay close to the old generator's DTOs (packages/client/src/api.ts
 * `Pack`, `Asset`, `Animation`; apps/server/src/main.ts assetDto / animDto) so later ports stay easy; field names are
 * camelCase, the DB's snake_case never leaks.
 */
import type { AssetKind } from './synty/naming.js';
import type { Category } from './synty/categories.js';
import type { PartSlot } from './synty/attachments.js';
import type { SizeSuspect } from './synty/scale.js';
import type { PackKind } from './synty/packs.js';
import type { AssetVariants } from './synty/states.js';
import type { RigKind } from './synty/rigs.js';

export type { AssetKind, Category, PartSlot, PackKind, AssetVariants, RigKind, SizeSuspect };

export type PackStatus = 'extracting' | 'ingesting' | 'ready' | 'error';

export interface Pack {
  id: number;
  /** Version-less identity, e.g. POLYGON_City. */
  name: string;
  version: number;
  kind: PackKind;
  /** The zip it was installed from. */
  fileName: string;
  /** The extracted folder (absolute; under dataDir/packs when the data dir moved since the DB was written). */
  dir: string;
  status: PackStatus;
  message: string | null;
  createdAt: string;
  /** Row counts. */
  assets: number;
  animations: number;
  errors: number;
}

export type AssetStatus = 'pending' | 'ready' | 'error';

export type LabelField = 'kind' | 'slot' | 'moveset' | 'category' | 'tags' | 'description' | 'hidden';

/** A label a person (locked) or the AI set on an asset in the old generator. */
export interface Label {
  value: unknown;
  source: 'human' | 'ai';
  model: string | null;
  updatedAt: string;
}

/** A bundled attachment: one `*_Attach_*` mesh of a combined character file, listed as its own asset. */
export interface BundledInfo {
  /** The FBX it ships in (relative to the pack dir). */
  file: string;
  mesh: string;
  /** Skinned to the file's skeleton (deforms with the character's bones), else a static mesh. */
  skinned: boolean;
  [k: string]: unknown;
}

export interface Asset {
  id: number;
  packId: number;
  /** Pack name (POLYGON_War). */
  pack: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  error: string | null;
  /** The FBX inside the pack (relative to the pack dir). */
  fbx: string;
  /** For combined character files: the body mesh this row shows; null for a whole file. */
  variant: string | null;
  /** The ingested GLB and its thumbnail, relative to the data dir; null when the ingest produced none. */
  glb: string | null;
  thumb: string | null;
  bundled: BundledInfo | null;
  /** The effective category: a label's, else the name rules' (null for characters, weapons, attachments, fx). */
  category: Category | null;
  /** The name rules' damaged / destroyed / broken flag. */
  damaged: boolean;
  /** The effective slot (a label's, else the name rules') for attachments, weapons and fx; null for other kinds. */
  slot: PartSlot | null;
  /** Size in metres ([x, y, z], y up) with the scale fix applied; null when the model was never measured. */
  size: [number, number, number] | null;
  /** A piece of a modular set (wall corner, road straight, bundled attachment); null when not yet judged by the old server. */
  modular: boolean | null;
  /** Tags and a one-line description: a person's label, else the AI tagger's; [] / null until tagged. */
  tags: string[];
  description: string | null;
  labels: Partial<Record<LabelField, Label>>;
  hidden: boolean;
}

/** Where an asset's scale comes from. */
export type ScaleSource = 'override' | 'known' | 'bundled' | 'auto';

export interface AssetScale {
  /** Multiply the model's root nodes by this to get true metres. */
  scale: number;
  /** override: a row of the DB's scale_overrides; known: scale-overrides.json (the DB lost it); bundled: a bundled attachment keeps its character's units; auto: the rules. */
  source: ScaleSource;
  /** What the rules alone say (the pack's verdict, the name rules, the unit check). */
  auto: number;
  /** The largest side as imported (model units), null when not measured. */
  extent: number | null;
  /** The size after the fix still looks wrong for what the name says (a 2.3 m pistol) and what would fix it. */
  suspect: (SizeSuspect & { suggestedScale: number | null }) | null;
}

/** An animatable rigid part of a multi-part model (vehicle doors, wheels, turrets…). */
export interface AssetPart {
  name: string;
  /** The name without the model's prefix (Door_l). */
  local: string;
  /** The effective role: a person's override, else the rules'. */
  role: string | null;
  /** What the rules say (synty/roles.ts). */
  ruleRole: string | null;
  overridden: boolean;
  parent?: string;
  /** In the model's own units. */
  pivot?: number[];
  bboxMin?: number[];
  bboxMax?: number[];
  spinAxis?: number[];
  /** The same in metres with the scale fix applied. */
  pivotM?: number[];
  minM?: number[];
  maxM?: number[];
  sizeM?: number[];
}

export interface AssetRig {
  /** synty_legacy, synty_ue, mixamo, or a user profile. */
  profile: RigKind;
  score: number;
  /** canonical bone → the model's bone name. */
  map: Record<string, string>;
  /** Every bone of the skeleton, parents first. */
  bones: string[];
}

/** The ingest JSON the Blender worker wrote (worker/ingest.py); the keys the library reads are typed, the rest kept. */
export interface IngestMeta {
  name: string;
  source: string;
  kind: string;
  unit_scale?: number;
  bones?: string[];
  rig?: { profile: string; score: number; map?: Record<string, string> } | null;
  bounds?: { min: number[]; max: number[] } | null;
  /** Body meshes of a combined character file. */
  variants?: string[];
  parts?: { name: string; local?: string; role?: string | null; parent?: string; pivot?: number[]; bbox_min?: number[]; bbox_max?: number[]; spin_axis?: number[] }[];
  bundled?: BundledInfo;
  texture?: unknown;
  texture_variants?: unknown;
  materials?: unknown;
  [k: string]: unknown;
}

/** An asset with its lazy lookups. The methods are not enumerable: `{ ...entry }` and JSON.stringify give the plain Asset. */
export interface AssetEntry extends Asset {
  /** Absolute path of the ingested GLB when it is on disk, else null. */
  glbPath(): string | null;
  /** Absolute path of the ingest meta JSON when it is on disk, else null (the DB keeps a copy: see meta()). */
  metaPath(): string | null;
  /** The ingest meta (from the DB row, else the file), null for an asset that never ingested. */
  meta(): IngestMeta | null;
  thumbPath(): string | null;
  /** Absolute path of the source FBX inside the extracted pack (may not exist when the pack folder was removed). */
  fbxPath(): string;
  scale(): AssetScale;
  /** Animatable parts with their roles (overrides applied); [] for a model without parts. */
  roles(): AssetPart[];
  /** The skeleton: the ingest's detection, else detected from the bones now; null for a model without bones. */
  rig(): AssetRig | null;
  /** Damaged / destroyed versions of this model in its pack, by name. */
  variants(): AssetVariants;
  /** The saved default grip when held by a character (the old `grips` table: target bone, pos, rot, scale, sockets), or null. */
  grip(): Record<string, unknown> | null;
  /** Saved placement fixes by moveset ('' = any), with their revision and source (the old `placements` table). */
  placements(): Record<string, Record<string, unknown> & { rev: number; source: 'human' | 'ai-approved' }>;
}

/** A project of the old generator: the settings its sprites inherited (view card, look, size, format, fps…). */
export interface Project {
  id: number;
  name: string;
  description: string | null;
  /** '2d' (sprites) or '3d' (models). */
  kind: string;
  /** The old `ProjectDefaults` JSON as stored: viewCardId, view, lookId, sizeId, profileId, layers, uniformFrame, layered, gender. */
  defaults: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ClipEventMark {
  /** Seconds in the source clip. */
  t: number;
  name: string;
}

/** A clip's shared edits in the old generator (trim, speed, events). */
export interface ClipEdit {
  start?: number | null;
  end?: number | null;
  speed?: number;
  events?: ClipEventMark[];
  autoEvents?: boolean;
  reverse?: boolean;
  [k: string]: unknown;
}

export interface Animation {
  id: number;
  packId: number;
  pack: string;
  /** Walk_F, Walk_F_RM, Idle_Standing… shared by the Polygon and Sidekick copies and both genders. */
  name: string;
  /** The FBX inside the pack (relative to the pack dir). */
  fbx: string;
  /** Detected rig profile; null = needs a bone mapping (or a prop clip with no humanoid skeleton). */
  rig: RigKind | null;
  frames: number | null;
  fps: number | null;
  loop: boolean;
  /** Locomotion/Walk, Idle, Combat/Attack… */
  category: string | null;
  /** Synty rig family folder: Polygon / Sidekick. */
  set: string | null;
  gender: string | null;
  rootMotion: boolean;
  status: AssetStatus;
  error: string | null;
  /** Ready, humanoid, and no rig profile matched. */
  needsMapping: boolean;
  /** Names the clip had before it was renamed, newest first. */
  previousNames: string[];
  edit: ClipEdit | null;
}

export interface AnimationEntry extends Animation {
  /** Absolute path of the retargeted clip baked onto a character (data/bakes/a{asset}/n{anim}[_rm].glb) when it exists, else null. Never bakes. */
  bakePath(assetId: number, opts?: { inPlace?: boolean }): string | null;
  /** The ground speed (m/s) recorded beside a bake; null without a bake, for older bakes, or in-place loops with no travel. */
  bakeSpeed(assetId: number, opts?: { inPlace?: boolean }): number | null;
  metaPath(): string | null;
  fbxPath(): string;
  /** The skeleton's bones, parents first ([] when unknown). */
  bones(): string[];
}

export interface AssetQuery {
  /** Words: full-text search (names, AI tags, descriptions; best match first) when the DB has the FTS5 table, else a LIKE on the name. */
  query?: string;
  kind?: AssetKind | AssetKind[];
  /** Pack id or name (version suffix optional). */
  pack?: number | string;
  category?: Category | Category[];
  /** Default: only ready assets. */
  status?: AssetStatus | 'all';
  /** Default 200, at most 5000. */
  limit?: number;
  offset?: number;
}

export interface AnimationQuery {
  /** Matches the name, the category or an earlier name (LIKE). */
  query?: string;
  pack?: number | string;
  /** synty_legacy, synty_ue, mixamo; null for clips without a rig. */
  rigKind?: RigKind | null;
  /** Category prefix (Locomotion, Locomotion/Walk, Combat). */
  category?: string;
  gender?: string;
  set?: string;
  rootMotion?: boolean;
  status?: AssetStatus | 'all';
  limit?: number;
}

export interface ScaleOverrideRow {
  pack: string;
  fbx: string;
  variant: string;
  scale: number;
}

export interface Library {
  readonly dataDir: string;
  readonly dbPath: string;
  /** The DB has the FTS5 search table (assets_fts). */
  readonly hasFts: boolean;
  packs(): Pack[];
  /** By id or name (case-insensitive; a version suffix like _v4 is ignored). */
  pack(ref: number | string): Pack | undefined;
  assets(query?: AssetQuery): AssetEntry[];
  /**
   * By id, by `Pack/Name` as the games' ssg.assets.json names models, or by bare name. A name picks the ready asset
   * called so (case-insensitive): a whole-file row before a body variant, then the lowest id.
   */
  asset(ref: number | string): AssetEntry | undefined;
  /** Every ready asset with this exact name (case-insensitive), optionally in one pack: for telling duplicates apart. */
  assetsNamed(name: string, pack?: number | string): AssetEntry[];
  animations(query?: AnimationQuery): AnimationEntry[];
  /** By id, or by name: the ready clip with a rig called so, a non-root-motion copy first, then the lowest id. */
  animation(ref: number | string): AnimationEntry | undefined;
  /** The old generator's projects (their shared sprite settings), by name. */
  projects(): Project[];
  /** A project by id or name (case-insensitive). */
  project(ref: number | string): Project | undefined;
  /** The DB's scale_overrides rows (what scale-overrides.json is exported from). */
  scaleOverrides(): ScaleOverrideRow[];
  close(): void;
}
