/**
 * `ssg.models.json`: the game-ready GLB models a game needs. Ported from the old generator's
 * packages/client/src/models.ts (ModelDecl, checkModelSpec, parseModelsFile) and packages/shared/src/model3d/*
 * (ModelSpec and the built kinds: trackpiece, terrain, skydome, composite), with the same keys, ranges and
 * cross-field rules. Unknown keys are errors.
 */
import { z } from 'zod';
import { doc, opt } from '../meta.js';
import { assetRef, hexColor, hexColor36, nameList, projectRef } from './common.js';

export const MODEL_COLLIDERS = ['box', 'convex', 'trimesh'] as const;
export const MODEL_ORIGINS = ['bottom-centre', 'axle-centre', 'pivot'] as const;
export const MODEL_TEX_FORMATS = ['png', 'webp', 'keep'] as const;
export const MODEL_COMPRESS = ['meshopt', 'none'] as const;
export const MODEL_MAX_VARIANTS = 16;
export const MODEL_MAX_POSES = 32;
export const MODEL_MAX_LODS = 4;

// ---- track pieces ----

export const TRACK_SHAPES = ['flat', 'pipe', 'halfpipe', 'tunnel'] as const;
export const TRACK_SIDES = ['both', 'left', 'right', 'none'] as const;
export const TRACK_SLOTS = ['deck', 'kerb', 'kerbAlt', 'wall', 'support'] as const;
export const TRACK_SUPPORTS = ['auto', 'none', 'pillars', 'solid'] as const;
export const TRACK_BANK_PIVOTS = ['low-edge', 'centre'] as const;
export const TRACK_PRESETS = [
  'straight', 'curve-left', 'curve-right', 'banked-curve-left', 'banked-curve-right', 'bank-transition', 'slope-up', 'slope-down', 'ramp', 'landing',
  'jump', 'loop', 'corkscrew-left', 'corkscrew-right', 'pipe', 'pipe-in', 'pipe-out', 'halfpipe', 'halfpipe-in', 'halfpipe-out', 'tunnel', 'bridge',
  'chicane-left', 'chicane-right', 'split-left', 'split-right', 'crossroads', 'helix-left', 'helix-right', 'widen', 'narrow', 'barrel-roll',
] as const;
export type TrackPreset = (typeof TRACK_PRESETS)[number];
/** The preset parameters each preset takes (a custom path takes only bank). */
export const TRACK_PRESET_PARAMS: Record<TrackPreset, string[]> = {
  straight: ['length'],
  'curve-left': ['size', 'radius', 'angle'],
  'curve-right': ['size', 'radius', 'angle'],
  'banked-curve-left': ['size', 'radius', 'angle', 'bank', 'transition', 'bankIn', 'bankOut'],
  'banked-curve-right': ['size', 'radius', 'angle', 'bank', 'transition', 'bankIn', 'bankOut'],
  'bank-transition': ['length', 'from', 'to'],
  'slope-up': ['length', 'height', 'transition'],
  'slope-down': ['length', 'height', 'transition'],
  ramp: ['length', 'height', 'angle'],
  landing: ['length', 'height', 'angle'],
  jump: ['length', 'height', 'angle'],
  loop: ['radius', 'shift', 'align', 'turn'],
  'corkscrew-left': ['length', 'side'],
  'corkscrew-right': ['length', 'side'],
  pipe: ['length', 'radius'],
  'pipe-in': ['length', 'radius'],
  'pipe-out': ['length', 'radius'],
  halfpipe: ['length', 'radius'],
  'halfpipe-in': ['length', 'radius'],
  'halfpipe-out': ['length', 'radius'],
  tunnel: ['length', 'height'],
  bridge: ['length', 'height'],
  'chicane-left': ['length', 'shift', 'offset'],
  'chicane-right': ['length', 'shift', 'offset'],
  'split-left': ['size'],
  'split-right': ['size'],
  crossroads: [],
  'helix-left': ['radius', 'height', 'angle', 'travel'],
  'helix-right': ['radius', 'height', 'angle', 'travel'],
  widen: ['length', 'to'],
  narrow: ['length', 'from'],
  'barrel-roll': ['length', 'radius', 'angle', 'transition', 'turn'],
};
const PRESET_PARAM_KEYS = ['length', 'size', 'angle', 'radius', 'bank', 'transition', 'bankIn', 'bankOut', 'from', 'to', 'height', 'shift', 'side', 'align', 'turn', 'offset', 'travel'] as const;

const materialRef = z.string().min(1).refine((s) => !s.startsWith('#') || hexColor.safeParse(s).success, 'is "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb"');

export const trackProfile = doc(
  z.strictObject({
    shape: opt(z.enum(TRACK_SHAPES), { help: 'flat road, closed pipe (the car drives on its inside), half-pipe, or a flat road under a tunnel shell.' }).optional(),
    width: opt(z.number().min(1).max(100), { help: 'Drivable width between the kerbs\' outer edges; for a pipe its diameter (default 10).', example: 10 }).optional(),
    kerb: opt(z.number().min(0).max(5), { help: 'Kerb strip width on each edge, 0 for none (default 0.6).' }).optional(),
    kerbHeight: opt(z.number().min(0).max(2), { help: 'Kerb height.' }).optional(),
    kerbs: opt(z.enum(TRACK_SIDES), { help: 'Which edges get kerbs.' }).optional(),
    wall: opt(z.number().min(0).max(20), { help: 'Wall / rail height above the deck, 0 for none (default 0.8).' }).optional(),
    wallThickness: opt(z.number().min(0.02).max(5), { help: 'Wall thickness.' }).optional(),
    walls: opt(z.enum(TRACK_SIDES), { help: 'Which edges get walls.' }).optional(),
    thickness: opt(z.number().min(0.02).max(10), { help: 'Deck slab thickness under the surface (default 0.5).' }).optional(),
    radius: opt(z.number().min(0.2).max(100), { help: 'Half-pipe: the radius of its curved sides (default width / 4).' }).optional(),
    height: opt(z.number().min(1).max(100), { help: 'Tunnel: clear height inside (default width / 2 + 2).' }).optional(),
    median: opt(z.number().min(0).max(50), { help: 'A divided road (CS-FB-012): the width of the central median strip (default 0: none).', example: 3 }).optional(),
    medianHeight: opt(z.number().min(0).max(10), { help: 'The median\'s height (default 0.8, a concrete barrier; 0: a painted strip).' }).optional(),
    edge: opt(z.string().min(1), { help: 'The edge kind flat road ends report from here on (default the spec\'s edge, else road; e.g. highway).', example: 'highway' }).optional(),
  }),
  { id: 'track-profile', title: 'Track profile', summary: 'A track piece\'s cross-section: the road\'s shape, width, kerbs, walls and median.' },
);

export const trackSegment = doc(
  z
    .strictObject({
      length: opt(z.number().min(0.01).max(5000), { help: 'Metres along the centreline.', example: 30 }),
      turn: opt(z.number().min(-1440).max(1440), { help: 'Yaw over the segment, degrees, + left.' }).optional(),
      pitch: opt(z.number().min(-1440).max(1440), { help: 'Pitch over the segment, degrees, + nose up (a loop is 360).' }).optional(),
      roll: opt(z.number().min(-1440).max(1440), { help: 'Rolls the path frame itself over the segment, degrees, + raises the right edge (corkscrews).' }).optional(),
      rollRadius: opt(z.number().min(0.1).max(500), { help: 'CS-FB-027: roll about an axis this many metres above the deck instead of the centre line (a barrel roll). Only with roll; no turn, pitch, shift or rise.' }).optional(),
      rollEase: opt(z.number().min(0).max(0.5), { help: 'With rollRadius: the share of the length each end takes to ease the roll in or out (0–0.5, default 0.25).' }).optional(),
      bank: opt(z.number().min(-180).max(180), { help: 'Deck bank at the END of the segment (absolute degrees, eased from the previous end); + raises the right edge.' }).optional(),
      shift: opt(z.number().min(-1000).max(1000), { help: 'Sideways offset over the segment, metres, + left, eased in and out.' }).optional(),
      rise: opt(z.number().min(-1000).max(1000), { help: 'Upward offset over the segment, metres, eased (an S-shaped slope with level ends).' }).optional(),
      profile: opt(trackProfile, { help: 'This segment\'s profile, merged over the previous one.' }).optional(),
      blend: opt(z.boolean(), { help: 'Ease from the previous segment\'s profile to this one over the segment (pipe-road transitions).' }).optional(),
      gap: opt(z.boolean(), { help: 'No geometry: the path flies on (the gap of a jump).' }).optional(),
    })
    .superRefine((s, ctx) => {
      if (s.rollRadius !== undefined) {
        if (!s.roll) ctx.addIssue({ code: 'custom', path: ['rollRadius'], message: 'rollRadius goes with a roll (the degrees to turn about the raised axis)' });
        const other = (['turn', 'pitch', 'shift', 'rise'] as const).filter((k) => s[k]);
        if (other.length) ctx.addIssue({ code: 'custom', path: ['rollRadius'], message: `a roll about a raised axis (rollRadius) takes no ${other.join(', ')}` });
      } else if (s.rollEase !== undefined) ctx.addIssue({ code: 'custom', path: ['rollEase'], message: 'rollEase goes with rollRadius' });
    }),
  { id: 'track-segment', title: 'Track segment', summary: 'One segment of a custom track path: how far it goes and how it turns, pitches, rolls, banks and shifts on the way.' },
);

const vec3 = z.tuple([z.number().min(-10000).max(10000), z.number().min(-10000).max(10000), z.number().min(-10000).max(10000)]);

export const trackBranch = doc(
  z
    .strictObject({
      name: opt(z.string().regex(/^[A-Za-z][\w-]{0,31}$/, 'is a socket name (a letter, then letters, digits, _ or -)'), { help: 'Socket name(s): name for its one open end, name_in / name_out when both are open.', example: 'pit' }),
      from: opt(z.number().int().min(0), { help: 'Start where the main path is after this many segments (0: the entry). Not with start.' }).optional(),
      start: opt(
        z.strictObject({
          pos: opt(vec3, { help: 'A position in the piece, metres.' }),
          heading: opt(z.number().min(-360).max(360), { help: 'Degrees, 0 = +Z, + left.' }).optional(),
          bank: opt(z.number().min(-180).max(180), { help: 'The deck bank at the start.' }).optional(),
        }),
        { help: 'Or start here: a position in the piece and a heading.' },
      ).optional(),
      path: opt(z.array(trackSegment).min(1).max(256), { help: 'The branch\'s segments.' }),
      profile: opt(trackProfile, { help: 'Profile changes over the main path\'s (the profile where it starts).' }).optional(),
      open: opt(z.enum(['start', 'end', 'both', 'none']), { help: 'Which ends are open (get sockets). Default end for from, both for start.' }).optional(),
    })
    .superRefine((b, ctx) => {
      if (b.from !== undefined && b.start !== undefined) ctx.addIssue({ code: 'custom', path: ['start'], message: 'give from or start, not both' });
    }),
  { id: 'track-branch', title: 'Track branch', summary: 'A side path off a track piece (a pit lane, a split) with its own sockets.' },
);

const trackpieceFields = {
  preset: opt(z.enum(TRACK_PRESETS), { help: 'A ready-made piece; its parameters are the keys below that it takes.', example: 'curve-left' }).optional(),
  cell: opt(z.number().min(2).max(500), { help: 'The grid\'s cell in metres (default 30).', example: 30 }).optional(),
  footprint: opt(z.tuple([z.number().int().min(1), z.number().int().min(1)]), { help: 'Declared footprint in cells [across (X), along (Z)]; checked against the geometry.', example: [1, 2] }).optional(),
  elevation: opt(z.number().min(-100).max(2000), { help: 'Height of the entry above the ground (default 0; a bridge preset sets it).' }).optional(),
  bank: opt(z.number().min(-180).max(180), { help: 'Entry bank, degrees (default 0); on a banked curve, the bank (default 30).' }).optional(),
  pitch: opt(z.number().min(-90).max(90), { help: 'Entry pitch, degrees (default 0).' }).optional(),
  bankPivot: opt(z.enum(TRACK_BANK_PIVOTS), { help: 'Bank about the edge that goes down, which stays at path height (default), or about the centre line.' }).optional(),
  profile: opt(trackProfile, { help: 'The cross-section at the entry.' }).optional(),
  width: opt(z.number().min(1).max(100), { help: 'A shorthand for profile.width.', example: 10 }).optional(),
  path: opt(z.array(trackSegment).min(1).max(256), { help: 'A custom path of segments instead of a preset.', cli: false }).optional(),
  branches: opt(z.array(trackBranch), { help: 'Side paths with their own sockets.', cli: false }).optional(),
  materials: opt(z.strictObject(Object.fromEntries(TRACK_SLOTS.map((k) => [k, materialRef.optional()])) as Record<(typeof TRACK_SLOTS)[number], z.ZodOptional<typeof materialRef>>), { help: 'Synty swatches per slot (deck, kerb, kerbAlt, wall, support): "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb".', example: { deck: '#404040' } }).optional(),
  supports: opt(
    z.union([
      z.enum(TRACK_SUPPORTS),
      z.strictObject({
        kind: opt(z.enum(TRACK_SUPPORTS), { help: 'Pillars or a solid fill.' }).optional(),
        spacing: opt(z.number().min(2).max(500), { help: 'Pillars: metres between them along the path (default 15).' }).optional(),
        size: opt(z.number().min(0.1).max(20), { help: 'Pillars: the side of their square section (default 1.6).' }).optional(),
      }),
    ]),
    { help: 'Pillars or a solid fill down to y = 0 under elevated parts; auto (default) pillars where the deck is over 1.5 m up, solid for ramps.' },
  ).optional(),
  stripe: opt(z.number().min(0.2).max(100), { help: 'Kerb stripe length in metres (default 2).' }).optional(),
  edge: opt(z.string().min(1), { help: 'The edge kind a flat road end reports in its socket (default road; e.g. highway for a dual carriageway).', example: 'highway' }).optional(),
  // Preset parameters.
  length: opt(z.number().min(0.1).max(32), { help: 'Cells along the piece (straight, slope, ramp, jump, corkscrew, pipe, tunnel, bridge, chicane…).', example: 2 }).optional(),
  size: opt(z.number().min(0.1).max(32), { help: 'Curves and splits: the footprint in cells (1: 1×1, radius half a cell; 2: 2×2, radius 1.5 cells).', example: 2 }).optional(),
  angle: opt(z.number().min(1).max(1440), { help: 'Curves: degrees turned (default 90). Ramps / jumps: the lip angle (default 20). Helix and barrel roll: up to 1440.' }).optional(),
  radius: opt(z.number().min(0.1).max(500), { help: 'Loop: its radius in metres. Curves: the centre-line radius (instead of size). Pipe: the tube\'s radius. Helix: its radius. Barrel roll: the roll axis\'s height above the deck.' }).optional(),
  transition: opt(z.number().min(0).max(0.5), { help: 'Banked curve: the share of the arc each bank ramp takes. Slope: the share of the run each curved end takes (default 0.25).' }).optional(),
  bankIn: opt(z.number().min(-180).max(180), { help: 'Banked curve: bank at the entry (default 0).' }).optional(),
  bankOut: opt(z.number().min(-180).max(180), { help: 'Banked curve: bank at the exit (default 0).' }).optional(),
  from: opt(z.union([z.number().min(-180).max(180), trackProfile]), { help: 'Bank transition: the bank at the entry (degrees). Narrow: the wide profile at the entry ({ width, edge, median… }).' }).optional(),
  to: opt(z.union([z.number().min(-180).max(180), trackProfile]), { help: 'Bank transition: the bank at the exit (degrees). Widen: the wide profile at the exit.' }).optional(),
  height: opt(z.number().min(-500).max(500), { help: 'Slopes: the rise (m); ramps / jumps: the lip height; bridges: the deck height; tunnels: the clear height; helix: the climb over its turn (negative descends).' }).optional(),
  shift: opt(z.number().min(-500).max(500), { help: 'Loop and chicane: the sideways offset (m).' }).optional(),
  side: opt(z.number().min(0).max(32), { help: 'Corkscrew: the cells it moves sideways (default 1).' }).optional(),
  align: opt(z.enum(['offset', 'inline']), { help: 'Loop: offset (default; the exit leaves shift metres to the side of the entry) or inline (2 cells, exit on the centre line).' }).optional(),
  turn: opt(z.enum(['left', 'right']), { help: 'Loop: which way the exit moves (default right). Barrel roll: the wall the deck climbs first.' }).optional(),
  offset: opt(z.boolean(), { help: 'Chicane: true makes it a lane change, the exit shift metres to the side of the entry (default false: an S-bend that ends in line).' }).optional(),
  travel: opt(z.number().min(0).max(32), { help: 'Helix: cells it advances along its entry heading while it turns (default 0).' }).optional(),
};

export const trackpieceSpec = doc(
  z.strictObject(trackpieceFields).superRefine((t, ctx) => {
    if (t.preset && t.path) ctx.addIssue({ code: 'custom', path: ['path'], message: 'give a preset or a path, not both' });
    if (!t.preset && !t.path) ctx.addIssue({ code: 'custom', path: ['preset'], message: `a trackpiece needs a preset (${TRACK_PRESETS.join(', ')}) or a path of segments` });
    const allowed = t.preset ? TRACK_PRESET_PARAMS[t.preset] : ['bank'];
    for (const k of PRESET_PARAM_KEYS) {
      if (t[k] === undefined || allowed.includes(k)) continue;
      ctx.addIssue({ code: 'custom', path: [k], message: `${t.preset ? `preset ${t.preset}` : 'a custom path'} does not take "${k}"${t.preset ? ` (it takes ${allowed.join(', ') || 'no parameters'})` : ''}` });
    }
    if (t.branches) {
      const names = ['in', 'out', ...t.branches.flatMap((b) => [b.name, `${b.name}_in`, `${b.name}_out`])];
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) ctx.addIssue({ code: 'custom', path: ['branches'], message: `the socket name "${dup}" is used twice` });
      t.branches.forEach((b, i) => {
        if (b.from !== undefined && b.from > (t.path?.length ?? 0)) ctx.addIssue({ code: 'custom', path: ['branches', i, 'from'], message: `must be a segment count 0–${t.path?.length ?? 0}` });
      });
    }
  }),
  { id: 'trackpiece', title: 'Track piece', summary: 'A procedural track piece instead of an asset (CS-FB-001): a preset with its parameters, or a path of segments swept with a profile; Synty swatch materials; sockets at its open ends.' },
);

/** `defaults.trackpiece`: fields every piece shares (cell, width, profile, materials…); never preset or path. */
export const trackpieceDefaults = doc(z.strictObject(trackpieceFields).omit({ preset: true, path: true }), {
  id: 'trackpiece-defaults',
  title: 'Track piece defaults',
  summary: '`defaults.trackpiece`: track fields every piece shares, merged under each piece\'s own (never preset or path).',
});

// ---- terrain ----

export const TERRAIN_TILES = ['flat', 'slope', 'corner-outer', 'corner-inner', 'plateau', 'water', 'coast'] as const;
export const TERRAIN_DIRS = ['N', 'E', 'S', 'W', 'NE', 'NW', 'SE', 'SW'] as const;
export const TERRAIN_SLOTS = ['ground', 'slope', 'shore', 'seabed', 'water', 'skirt'] as const;
export const TERRAIN_SHAPES = ['planar', 'track'] as const;
export const TERRAIN_BIOMES = ['meadow', 'desert', 'alpine', 'tropical', 'swamp'] as const;
const TERRAIN_WATER_CODES = ['', '.', 'w', 'NE', 'NW', 'SE', 'SW'];
const MAX_TILES = 128;

export const terrainScatter = doc(
  z
    .strictObject({
      asset: opt(z.string().min(1), { help: 'A Synty prop ("Pack/Asset" or a name), exported in metres and instanced.', example: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Cactus_01' }),
      density: opt(z.number().min(0).max(200), { help: 'Props per tile on average (default 4).', example: 4 }).optional(),
      scale: opt(z.tuple([z.number().min(0.01).max(100), z.number().min(0.01).max(100)]), { help: 'Uniform scale range [min, max] (default [0.8, 1.2]).', example: [0.8, 1.2] }).optional(),
      maxSlope: opt(z.number().min(0).max(90), { help: 'Steepest ground it stands on, degrees (default 25).' }).optional(),
      on: opt(z.enum(['land', 'shore', 'any']), { help: 'Where: land (default, dry ground off the shore), shore (the shore only), any dry ground.' }).optional(),
      align: opt(z.boolean(), { help: 'Tilt with the ground (default false: upright).' }).optional(),
    })
    .refine((s) => !s.scale || s.scale[0] <= s.scale[1], { path: ['scale'], message: 'must be [min, max] with min ≤ max' }),
  { id: 'terrain-scatter', title: 'Terrain scatter', summary: 'Props scattered over a terrain (cacti, rocks), instanced in the GLB.' },
);

const terrainFields = {
  cell: opt(z.number().min(2).max(500), { help: 'The grid\'s cell in metres (default 30, as track pieces).', example: 30 }).optional(),
  height: opt(z.number().min(0.1).max(500), { help: 'One height step in metres (default 0.44 cell). Heights count steps.', example: 13 }).optional(),
  tile: opt(z.enum(TERRAIN_TILES), { help: 'One tile: its kind (not with heights).' }).optional(),
  dir: opt(z.enum(TERRAIN_DIRS), { help: 'The way a tile faces: slope, the uphill side N|E|S|W; corners, the uphill corner NE|NW|SE|SW; coast, the water\'s corner.' }).optional(),
  heights: opt(z.array(z.array(z.number().min(-64).max(64)).min(2)).min(2), { help: 'A grid: corner heights in steps, rows along +Z, columns along +X: (rows + 1) × (cols + 1) numbers (not with tile).', example: [[0, 0], [0, 1]], cli: false }).optional(),
  water: opt(z.array(z.union([z.string(), z.array(z.union([z.string(), z.number()]))])), { help: 'Water per tile (rows × cols): "" or "." land, "w" water, NE | NW | SE | SW a coast; a string of one char a tile also works ("..w").', example: ['..w', '.ww'], cli: false }).optional(),
  level: opt(z.number().min(-1000).max(1000), { help: 'The water surface\'s height in metres (default 0.02).' }).optional(),
  depth: opt(z.number().min(0).max(100), { help: 'How far the bed under open water sinks below the surface, metres (default 1.5).' }).optional(),
  shape: opt(z.enum(TERRAIN_SHAPES), { help: 'Slope faces: planar (default; straight faces) or track (the slope-up piece\'s curve, so a road slope fits).' }).optional(),
  transition: opt(z.number().min(0).max(0.5), { help: 'track shape: the share of the run each curved end takes (default 0.25).' }).optional(),
  subdiv: opt(z.number().int().min(1).max(32), { help: 'Subdivisions per tile side (default 1 planar, 8 track).' }).optional(),
  skirt: opt(z.number().min(0).max(1000), { help: 'Vertical walls this many metres down from the outer edges (default 0: none).' }).optional(),
  chunk: opt(z.number().int().min(1).max(MAX_TILES), { help: 'Tiles per chunk side: a grid is cut into chunk × chunk meshes (default 10).' }).optional(),
  biome: opt(z.enum(TERRAIN_BIOMES), { help: 'A swatch set: meadow (default), desert, alpine, tropical, swamp.' }).optional(),
  materials: opt(z.strictObject(Object.fromEntries(TERRAIN_SLOTS.map((k) => [k, materialRef.optional()])) as Record<(typeof TERRAIN_SLOTS)[number], z.ZodOptional<typeof materialRef>>), { help: 'Swatches per slot (ground, slope, shore, seabed, water, skirt): "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb".', example: { ground: 'POLYGON_Generic_v3/Generic_Grass' } }).optional(),
  slopeAngle: opt(z.number().min(0).max(90), { help: 'Faces steeper than this (degrees) take the slope material (default 45).' }).optional(),
  shade: opt(z.number().min(0).max(0.3), { help: 'Brightness variation between faces, 0–0.3 (default 0.06).' }).optional(),
  seed: opt(z.number().min(0), { help: 'Seed of the shading and the scatter (default 1).' }).optional(),
  scatter: opt(z.array(terrainScatter).max(8), { help: 'Props scattered over the ground (at most 8 kinds).', cli: false }).optional(),
  clear: opt(z.array(z.tuple([z.number().int(), z.number().int()])), { help: 'Tiles [i, j] kept free of scatter (where track pieces go).', example: [[0, 0]], cli: false }).optional(),
};

export const terrainSpec = doc(
  z.strictObject(terrainFields).superRefine((t, ctx) => {
    if (t.tile !== undefined && t.heights !== undefined) ctx.addIssue({ code: 'custom', path: ['heights'], message: 'give a tile or heights (a grid), not both' });
    if (t.tile === undefined && t.heights === undefined) ctx.addIssue({ code: 'custom', path: ['tile'], message: `a terrain needs a tile (${TERRAIN_TILES.join(', ')}) or heights (a grid of corner heights in steps)` });
    if (t.tile !== undefined) {
      if (t.water !== undefined) ctx.addIssue({ code: 'custom', path: ['water'], message: 'water goes with heights (a tile says water or coast itself)' });
      const dirs = t.tile === 'slope' ? ['N', 'E', 'S', 'W'] : t.tile === 'corner-outer' || t.tile === 'corner-inner' || t.tile === 'coast' ? ['NE', 'NW', 'SE', 'SW'] : null;
      if (t.dir !== undefined && !dirs) ctx.addIssue({ code: 'custom', path: ['dir'], message: `a ${t.tile} tile does not take dir` });
      else if (t.dir !== undefined && dirs && !dirs.includes(t.dir)) ctx.addIssue({ code: 'custom', path: ['dir'], message: `a ${t.tile} tile faces ${dirs.join(', ')}` });
    } else if (t.dir !== undefined) ctx.addIssue({ code: 'custom', path: ['dir'], message: 'dir goes with a tile' });
    if (t.heights) {
      const cols = t.heights[0]?.length ?? 0;
      if (!t.heights.every((r) => r.length === cols)) ctx.addIssue({ code: 'custom', path: ['heights'], message: 'every row needs the same number of corners (at least 2)' });
      if (t.heights.length - 1 > MAX_TILES || cols - 1 > MAX_TILES) ctx.addIssue({ code: 'custom', path: ['heights'], message: `at most ${MAX_TILES}×${MAX_TILES} tiles` });
      if (t.water) {
        const rows = t.heights.length - 1;
        if (t.water.length !== rows) ctx.addIssue({ code: 'custom', path: ['water'], message: `must have a row per tile row (${rows}), each with a code per tile` });
        t.water.forEach((row, j) => {
          const cells = typeof row === 'string' ? (row.length === cols - 1 ? row.split('') : null) : row.map(String);
          if (!cells || cells.length !== cols - 1) ctx.addIssue({ code: 'custom', path: ['water', j], message: `needs ${cols - 1} codes (a string of one char a tile, or a list)` });
          else cells.forEach((c, i) => {
            if (!TERRAIN_WATER_CODES.includes(c)) ctx.addIssue({ code: 'custom', path: ['water', j, i], message: 'must be "" or "." (land), "w" (water) or a coast corner NE, NW, SE, SW' });
          });
        });
      }
    }
  }),
  { id: 'terrain3d', title: 'Terrain (3D)', summary: 'Terrain on the track grid instead of an asset (CS-FB-003): one tile, or a whole grid of corner heights with water, coasts, swatch materials and scattered props.' },
);

/** `defaults.terrain`: fields every terrain shares; never tile or heights. */
export const terrainDefaults = doc(z.strictObject(terrainFields).omit({ tile: true, heights: true }), {
  id: 'terrain3d-defaults',
  title: 'Terrain (3D) defaults',
  summary: '`defaults.terrain`: terrain fields every entry shares (cell, height, biome, materials, shape…), merged under each terrain\'s own (never tile or heights).',
});

// ---- skydome ----

export const SKYDOME_PRESETS = ['desert', 'tropical', 'alpine', 'city', 'country'] as const;

export const skydomeSpec = doc(
  z.strictObject({
    preset: opt(z.enum(SKYDOME_PRESETS), { help: 'The sky and ring the colours start from.', example: 'desert' }).optional(),
    radius: opt(z.number().min(10).max(100000), { help: 'Dome radius, metres (default 1000; keep it inside the camera\'s far plane).', example: 1000 }).optional(),
    colors: opt(
      z.strictObject({
        zenith: opt(hexColor, { help: 'The sky straight up.' }).optional(),
        horizon: opt(hexColor, { help: 'The sky at the horizon.' }).optional(),
        ground: opt(hexColor, { help: 'Below the horizon (the far ground or sea).' }).optional(),
        ring: opt(hexColor, { help: 'The silhouette ring\'s own colour before the haze.' }).optional(),
      }),
      { help: 'Colour overrides.' },
    ).optional(),
    ring: opt(
      z.union([
        z.boolean(),
        z.strictObject({
          assets: opt(z.array(z.string().min(1)).min(1).max(12), { help: 'Synty background props by reference ("Pack/Asset"); default the preset\'s.' }).optional(),
          distance: opt(z.number().min(0.3).max(0.98), { help: 'The ring\'s distance as a share of the radius (default 0.85).' }).optional(),
          elevation: opt(z.number().min(0.5).max(45), { help: 'How high the tallest silhouettes reach, degrees above the horizon (default the preset\'s, 3–8).' }).optional(),
          haze: opt(z.number().min(0).max(1), { help: '0–1: how far the ring\'s colour fades into the horizon\'s (default 0.55).' }).optional(),
          layers: opt(z.number().int().min(1).max(4), { help: 'Rings, the far ones lower and hazier (default 2).' }).optional(),
        }),
      ]),
      { help: 'The silhouette ring: true / left out for the preset\'s, false for none, or its settings.' },
    ).optional(),
    segments: opt(z.number().int().min(8).max(128), { help: 'Segments around (default 32).' }).optional(),
    seed: opt(z.number().min(0).max(2 ** 31), { help: 'Seed of the ring placement.' }).optional(),
    panorama: opt(z.union([z.number().int().min(256).max(8192).multipleOf(2), z.literal(false)]), { help: 'Also an equirectangular panorama PNG of the dome and ring, this many pixels wide (default 2048; false: none).' }).optional(),
  }),
  { id: 'skydome', title: 'Skydome', summary: 'A skydome instead of an asset (CS-FB-004): a gradient dome and a silhouette ring of Synty background props.' },
);

// ---- composite ----

export const COMPOSITE_PART_ORIGINS = ['bottom-centre', 'pivot'] as const;
export const COMPOSITE_MAX_PARTS = 64;
const cvec3 = z.tuple([z.number(), z.number(), z.number()]);

export const compositePart = doc(
  z.strictObject({
    asset: opt(assetRef, { help: 'Asset id, name or "Pack/Name".', example: 'POLYGON_Pro_Racer/SM_Prop_Gantry_06' }),
    name: opt(z.string().min(1), { help: 'Its node in the GLB (default the asset\'s name; repeats get _2, _3…).' }).optional(),
    pos: opt(cvec3, { help: 'Position in metres (default [0, 0, 0]).', example: [0, 0, 5] }).optional(),
    rot: opt(z.union([z.number().min(-3600).max(3600), cvec3]), { help: 'Degrees: a number turns it about +Y (yaw, + to the left); [x, y, z] are Euler angles applied X, then Y, then Z.', example: 90 }).optional(),
    scale: opt(z.union([z.number().min(0.001).max(1000), cvec3]), { help: 'A uniform scale, or [x, y, z] (default 1).', example: 1 }).optional(),
    origin: opt(z.enum(COMPOSITE_PART_ORIGINS), { help: 'Where the part\'s own origin is before it is placed: bottom-centre (default) or pivot (the source model\'s own origin).' }).optional(),
    attach: opt(z.array(z.string().min(1)), { help: 'Extra pieces of this part, as a model\'s attach.' }).optional(),
    tint: opt(hexColor36, { help: 'Recolour this part\'s paint, as a model\'s tint.' }).optional(),
    paint: opt(z.string().min(1), { help: 'The paint its tint recolours, as a model\'s paint (#rrggbb or a material name).' }).optional(),
    decals: opt(z.boolean(), { help: 'false: its decals are painted over, as a model\'s decals.' }).optional(),
  }),
  { id: 'composite-part', title: 'Composite part', summary: 'One library asset placed in a composite model.' },
);

export const compositeSpec = doc(z.strictObject({ parts: opt(z.array(compositePart).min(1).max(COMPOSITE_MAX_PARTS), { help: 'The parts, each placed at its pos / rot / scale.', cli: false }) }), {
  id: 'composite',
  title: 'Composite',
  summary: 'One model from several library assets at offsets (CS-FB-024): each part exported, placed and merged into one GLB with shared materials.',
});

// ---- the model spec ----

const clipList = nameList;
const BUILT = ['trackpiece', 'terrain', 'skydome', 'composite'] as const;
/** The fields a built kind takes besides itself (the others describe a library asset). */
const BUILT_FIELDS = ['collider', 'name', 'texSize', 'texFormat', 'compress'];

export const modelVariant = doc(
  z.strictObject({
    name: opt(z.string().min(1), { help: 'The variant\'s name (KHR_materials_variants).', example: 'red' }),
    tint: opt(hexColor36, { help: '#rrggbb; left out, the model\'s own colours.', example: '#c62828' }).optional(),
  }),
  { id: 'model-variant', title: 'Model variant', summary: 'One paint variant (shared geometry, its own material and texture). The CLI form is "red=#c62828,blue=#1e5bc6,plain".' },
);

const poseFields = {
  clip: opt(z.union([z.string().min(1), z.number().int()]), { help: 'The clip (any clips form) to pose at.', example: 'Crowd_Sit_Idle' }),
  time: opt(z.number().min(0).max(3600), { help: 'Seconds into the clip as exported (default 0).', example: 1 }).optional(),
};
export const modelPose = doc(z.strictObject(poseFields), { id: 'model-pose', title: 'Model pose', summary: 'A pose to bake: a clip and a time. The CLI form is "Clip:0.2".' });
export const modelNamedPose = doc(z.strictObject({ name: opt(z.string().min(1), { help: 'Its node in the GLB.', example: 'sit' }), ...poseFields }), {
  id: 'model-named-pose',
  title: 'Named pose',
  summary: 'One of several baked poses (a node per pose in one GLB). The CLI form is "idle=Idle:0,wave=Wave_01:0.2".',
});

export const modelSpecFields = {
  asset: opt(assetRef, { help: 'Asset id, or name ("SM_Veh_Pickup_Lift_01", or "Pack/Name" when several packs have it). Not with a built kind.', example: 'POLYGON_Palm_City/SM_Veh_Pickup_01' }).optional(),
  trackpiece: opt(trackpieceSpec, { help: 'A procedural track piece instead of an asset (see Track piece).', cli: false }).optional(),
  terrain: opt(terrainSpec, { help: 'Terrain on the track grid instead of an asset (see Terrain (3D)).', cli: false }).optional(),
  skydome: opt(skydomeSpec, { help: 'A skydome instead of an asset (see Skydome).', cli: false }).optional(),
  composite: opt(compositeSpec, { help: 'One model from several assets at offsets (see Composite).', cli: false }).optional(),
  collider: opt(z.enum(MODEL_COLLIDERS), { help: 'The collider the export carries (CS-FB-002): box (the manifest\'s box; default for assets), trimesh (also a collider node in the GLB; default for track pieces) or convex (assets: the hull of the visual mesh).' }).optional(),
  colliderExclude: opt(nameList, { help: 'Parts a trimesh or convex collider leaves out, by role (wheel, door…) or part name. Default the moving parts; [] keeps every part.', example: ['wheel', 'door'] }).optional(),
  convexMaxVertices: opt(z.number().int().min(4).max(65535), { help: 'With collider convex: the most vertices the hull may have (default 255, what physics engines take).', example: 255 }).optional(),
  name: opt(z.string().min(1), { help: 'Output name (file names and the GLB\'s root node). Default: the asset\'s name.', example: 'truck' }).optional(),
  clips: opt(clipList, { help: 'Clips baked into the GLB (characters only): a clip name, name@Masculine|Feminine|Neutral, name@Polygon|Sidekick (the rig family), name@<pack>, or an animation id.', example: ['POLY_IDL_Base@Masculine'] }).optional(),
  inPlace: opt(z.boolean(), { help: 'In-place clips (default true); false keeps the root motion.' }).optional(),
  attach: opt(clipList, { help: 'Extra pieces: bundled attachments of the same file by mesh name, or other attachment assets by name or id.', example: ['SM_Veh_Pickup_Lift_01'] }).optional(),
  replaceWheels: opt(z.boolean(), { help: 'When an attachment brings four road wheels of its own (a lift kit), the model\'s own are dropped and the attachment\'s become the wheels (default true).' }).optional(),
  origin: opt(z.enum(MODEL_ORIGINS), { help: 'Where the model\'s origin goes: the centre of its bottom (default), the centre of the wheel axles at axle height (vehicles), or the source model\'s own origin.' }).optional(),
  texSize: opt(z.number().int().min(16).max(8192), { help: 'Largest texture side in pixels (scaled down to fit, never up). Default by kind: props 256, vehicles and characters 1024.', example: 1024 }).optional(),
  texFormat: opt(z.enum(MODEL_TEX_FORMATS), { help: 'Texture format: webp (default), png, or keep (as ingested).' }).optional(),
  simplify: opt(z.number().gt(0).max(1), { help: 'Mesh simplification: the fraction of triangles to keep (0.05–1; 1 or unset = none).', example: 0.5 }).optional(),
  tint: opt(hexColor36, { help: 'A colour (#rgb / #rrggbb): recolours the body paint. Not with variants.', example: '#c62828' }).optional(),
  variants: opt(z.union([z.string().min(1), z.array(modelVariant).max(MODEL_MAX_VARIANTS)]), { help: 'Paint variants in one GLB: [{ name, tint }] (or "red=#c62828,blue=#1e5bc6,plain"). The first is the default look.', example: [{ name: 'red', tint: '#c62828' }] }).optional(),
  compress: opt(z.enum(MODEL_COMPRESS), { help: 'Geometry compression: meshopt (three.js needs MeshoptDecoder) or none (default).' }).optional(),
  fit: opt(
    z.strictObject({
      length: opt(z.number().gt(0), { help: 'Z (forward), metres.' }).optional(),
      width: opt(z.number().gt(0), { help: 'X, metres.' }).optional(),
      height: opt(z.number().gt(0), { help: 'Y, metres.' }).optional(),
    }),
    { help: 'Scale the model uniformly so a dimension matches, in metres. With several, the smallest scale wins.', example: { length: 4.5 } },
  ).optional(),
  pose: opt(z.union([z.string().min(1), modelPose]), { help: 'Bake a character into one static mesh posed at a clip\'s time: { clip, time } or "Clip:0.2". Not with clips or poses.', example: { clip: 'Crowd_Sit_Idle', time: 1 } }).optional(),
  poses: opt(z.union([z.string().min(1), z.array(modelNamedPose).max(MODEL_MAX_POSES)]), { help: 'Several posed static meshes in one GLB, a node per pose: [{ name, clip, time }] or "idle=Idle:0,wave=Wave_01:0.2". Not with clips or pose.', cli: false }).optional(),
  splitBySwatch: opt(z.boolean(), { help: 'Split the model\'s triangles by palette swatch (OR-FB-022): a child node swatch_<hex> per atlas colour with its own material. Static models only.' }).optional(),
  lods: opt(z.union([z.string().min(1), z.array(z.number().min(0.01).max(0.95)).max(MODEL_MAX_LODS)]), { help: 'Levels of detail in the same GLB, as falling shares of the triangles ([0.5, 0.2]); at most 4.', example: [0.5, 0.2] }).optional(),
  paint: opt(z.string().min(1).refine((s) => !s.startsWith('#') || hexColor.safeParse(s).success, 'is a colour like "#e3b52f" or a material name'), { help: 'The paint a tint or variants recolour (CS-FB-026): a colour #rrggbb (the swatch that is its paint) or a material name. Default: found.', example: '#e3b52f' }).optional(),
  decals: opt(z.boolean(), { help: 'CS-FB-028: false paints over every decal and livery in the paint\'s texture with the paint. Default true: only small lettering enclosed by the paint.' }).optional(),
};

type Spec = { [K in keyof typeof modelSpecFields]?: unknown } & { lods?: string | number[]; variants?: string | { name: string }[]; poses?: string | { name: string }[]; clips?: string | string[] };

const lodsOf = (v: unknown): number[] => (typeof v === 'string' ? v.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)) : Array.isArray(v) ? (v as number[]) : []);
const listLen = (v: unknown) => (typeof v === 'string' ? v.split(',').filter((x) => x.trim()).length : Array.isArray(v) ? v.length : 0);

/** The rules that hold between a model's keys (ported from checkModelSpec and normaliseSpec). `needAsset` is false for defaults. */
function checkModelRules(s: Spec, ctx: z.RefinementCtx, needAsset: boolean) {
  const kinds = BUILT.filter((k) => s[k] !== undefined);
  if (kinds.length > 1) ctx.addIssue({ code: 'custom', path: [kinds[1]!], message: `give one of ${BUILT.join(', ')}, not ${kinds.join(' and ')}` });
  const kind = kinds[0];
  if (kind) {
    if (s.asset !== undefined) ctx.addIssue({ code: 'custom', path: ['asset'], message: `give asset or ${kind}, not both` });
    const takes = [kind, ...BUILT_FIELDS, ...(kind === 'composite' ? ['convexMaxVertices'] : [])];
    const extra = Object.keys(s).filter((k) => (s as Record<string, unknown>)[k] !== undefined && !takes.includes(k) && !(BUILT as readonly string[]).includes(k));
    if (extra.length) ctx.addIssue({ code: 'custom', path: [extra[0]!], message: `a ${kind} is built, not loaded: it takes ${takes.join(', ')}, not ${extra.join(', ')}` });
    if (s.collider === 'convex' && kind !== 'composite') ctx.addIssue({ code: 'custom', path: ['collider'], message: `a ${kind} takes collider ${kind === 'skydome' ? 'box' : 'trimesh (the default) or box'}; convex is for assets` });
    if (kind === 'skydome' && s.collider === 'trimesh') ctx.addIssue({ code: 'custom', path: ['collider'], message: 'a skydome has no collider: leave collider out' });
  } else if (s.asset === undefined && needAsset) {
    ctx.addIssue({ code: 'custom', path: ['asset'], message: `asset is missing (a model name, Pack/Name or id; or a built kind: trackpiece { preset: ${TRACK_PRESETS.slice(0, 4).join(' | ')} … }, terrain, skydome, composite)` });
  }
  if (s.colliderExclude !== undefined && s.collider !== 'trimesh' && s.collider !== 'convex') ctx.addIssue({ code: 'custom', path: ['colliderExclude'], message: 'colliderExclude goes with collider trimesh or convex' });
  if (s.convexMaxVertices !== undefined && s.collider !== 'convex') ctx.addIssue({ code: 'custom', path: ['convexMaxVertices'], message: 'convexMaxVertices goes with collider convex' });
  if (s.tint !== undefined && listLen(s.variants)) ctx.addIssue({ code: 'custom', path: ['tint'], message: 'give each variant its tint, not tint as well' });
  if (s.pose !== undefined && listLen(s.poses)) ctx.addIssue({ code: 'custom', path: ['poses'], message: 'give one pose or a list of poses, not both' });
  if ((s.pose !== undefined || listLen(s.poses)) && listLen(s.clips)) ctx.addIssue({ code: 'custom', path: ['clips'], message: 'a posed export is a static mesh with no animations: leave clips out (the pose names its clip)' });
  const lods = lodsOf(s.lods);
  if (lods.some((n, i) => i > 0 && n >= (lods[i - 1] ?? 0))) ctx.addIssue({ code: 'custom', path: ['lods'], message: 'must fall: each level keeps fewer triangles than the one before ([0.5, 0.2])' });
  for (const key of ['variants', 'poses'] as const) {
    const list = s[key];
    if (!Array.isArray(list)) continue;
    const names = list.map((x) => x.name.toLowerCase());
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) ctx.addIssue({ code: 'custom', path: [key], message: `the name "${dup}" is used twice` });
  }
}

const MODEL_SUMMARY = 'One model to export: a library asset (or a built kind: trackpiece, terrain, skydome, composite) and its options. `name` is the file name in the folder; it defaults to the asset\'s name.';

/** One declared model: `name` plus the spec. */
export const modelDecl = doc(
  z.strictObject(modelSpecFields).superRefine((s, ctx) => {
    checkModelRules(s, ctx, true);
    if (s.name === undefined && typeof s.asset === 'number') ctx.addIssue({ code: 'custom', path: ['name'], message: 'name is missing (needed when asset is an id)' });
  }),
  { id: 'model', title: 'Model', summary: MODEL_SUMMARY },
);
export type ModelDecl = z.infer<typeof modelDecl>;

/** The spec alone (what the CLI's `model export` takes): `asset` required unless a built kind is given. */
export const modelSpec = doc(z.strictObject(modelSpecFields).superRefine((s, ctx) => checkModelRules(s, ctx, true)), { id: 'model-spec', title: 'Model spec', summary: 'A model export spec on its own (the CLI\'s `model export`): the Model keys without the file-level name rule.' });
export type ModelSpec = z.infer<typeof modelSpec>;

const { asset: _a, name: _n, trackpiece: _t, terrain: _te, skydome: _s, composite: _c, ...defaultFields } = modelSpecFields;
export const modelDefaults = doc(
  z
    .strictObject({
      ...defaultFields,
      trackpiece: opt(trackpieceDefaults, { help: 'Track fields every piece shares (cell, width, profile, materials…), merged under each piece\'s own.', cli: false }).optional(),
      terrain: opt(terrainDefaults, { help: 'Terrain fields every entry shares (cell, height, biome, materials…), merged under each terrain\'s own.', cli: false }).optional(),
    })
    .superRefine((s, ctx) => checkModelRules({ ...s, trackpiece: undefined, terrain: undefined }, ctx, false)),
  { id: 'model-defaults', title: 'Model defaults', summary: 'The `defaults` object: Model keys every model starts from (never asset or name). Asset fields do not apply to built kinds, and `trackpiece` / `terrain` here hold the fields those kinds share.' },
);

const safeName = (s: string) => String(s).trim().replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 80) || 'model';
const builtNameOf = (m: ModelDecl) => (m.trackpiece ? `trackpiece_${m.trackpiece.preset ?? 'path'}` : m.terrain ? `terrain_${m.terrain.tile ?? 'grid'}` : m.skydome ? `skydome_${m.skydome.preset ?? 'custom'}` : m.composite ? 'composite' : undefined);
const nameOf = (m: ModelDecl) => m.name ?? (typeof m.asset === 'string' ? m.asset : builtNameOf(m)) ?? '';

const modelsObject = z
  .strictObject({
    $schema: opt(z.string(), { help: 'The JSON Schema this file follows (editors use it); ignored.', cli: false }).optional(),
    comment: opt(z.unknown(), { help: 'A note for people; ignored.', cli: false }).optional(),
    project: opt(projectRef, { help: 'The project\'s name or id; the CLI\'s --project wins.', example: 'Off Road' }).optional(),
    models: opt(z.array(modelDecl).min(1), { help: 'The models.', cli: false }),
    defaults: opt(modelDefaults, { help: 'Settings every model starts from (see Model defaults).', cli: false }).optional(),
  })
  .superRefine((f, ctx) => {
    const seen = new Map<string, string>();
    f.models.forEach((m, i) => {
      const name = nameOf(m);
      if (!name) return;
      const key = safeName(name).toLowerCase();
      const other = seen.get(key);
      if (other !== undefined) ctx.addIssue({ code: 'custom', path: ['models', i, 'name'], message: `the name "${name}" is used twice (also "${other}"); names are the file names, so each must be different` });
      else seen.set(key, name);
    });
  });

/** `ssg.models.json`: an object with `models`, or a bare list of models. */
export const modelsFile = doc(z.union([modelsObject, z.array(modelDecl).min(1)]), {
  id: 'models-file',
  title: 'ssg.models.json',
  summary: 'Declares the 3D models a game keeps in a folder: `slop build` exports each one as a GLB plus a `.model.json` manifest, downloads only what changed, removes files of models no longer declared and indexes them in `models.json`. A bare list of models works too.',
});
export type ModelsFile = z.infer<typeof modelsFile>;
export { modelsObject };
