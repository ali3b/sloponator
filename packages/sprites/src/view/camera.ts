// Moved from synty-sprite-generator packages/shared/src/camera.ts (P2, ali3b/sloponator#8).
/**
 * View standards shared by the preview, the direction grid and the exporter: projections, direction sets,
 * direction basis (world vs screen), mirroring, ordering/naming conventions and the scale lock.
 *
 * Angle convention: compass degrees counter-clockwise from screen-right (East), screen-up = North.
 * In game code (dy positive = down the screen):  angle = atan2(-dy, dx)
 */
import type { CollisionMode } from '../object/footprint.js';

export type Projection = 'ortho' | 'persp';

/** Direction sets. 4d = the four diagonals (iso games moving along tile edges); 6f/6p = hex flat-/pointy-top. */
export type DirectionSetId = '1' | '2' | '4' | '4d' | '6f' | '6p' | '8' | '12' | '16' | '32';

/**
 * world:  directions evenly spaced on the ground plane. At an oblique pitch they project unevenly on screen,
 *         which is exactly what tile grids need (a world 45° facing lands on the 2:1 iso tile diagonal, 26.57°).
 * screen: directions evenly spaced on screen (free-aim top-down games); the world yaw is solved per direction.
 */
export type DirectionBasis = 'world' | 'screen';

/** Row order conventions. */
export type DirectionOrder = 'ccw-e' | 'cw-n' | 'cw-s' | 'ccw-n' | 'rpgmaker';
/** Label conventions: compass (E, NE…), words (right, up_right… as used for Godot animation names), degrees (a045). */
export type DirectionNaming = 'compass' | 'words' | 'degrees';

export type ScaleConfig =
  /** Fit each asset into a fixed frame (scale differs per asset). */
  | { mode: 'fit' }
  /** Fixed pixels per metre: every asset shares one scale and a feet-anchored pivot. */
  | { mode: 'ppm'; ppm: number }
  /** Derive pixels per metre from the game's tile size (diamond = 2:1 iso tiles rotated 45°). */
  | { mode: 'tile'; tilePx: number; metresPerTile: number; shape: 'square' | 'diamond' };

/** How detail is produced (applies identically to the preview and the export). */
export interface QualityConfig {
  /** Render at N× the frame size and average down: smoother edges and finer detail. */
  supersample: 1 | 2 | 3 | 4;
  /** Texture sampling: crisp palette swatches (nearest) or smooth (linear with mipmaps). */
  textureFilter: 'nearest' | 'linear';
  shadow: 'off' | 'low' | 'high';
  /**
   * clean: anti-aliased sprite. pixel: pixel-art look — every output pixel is one solid colour (averaged
   * from its supersampled block), hard silhouette, optional colour reduction and 1 px outline. The frame
   * size is the pixel resolution (32–96 px frames suit pixel art).
   */
  style?: 'clean' | 'pixel';
  /**
   * Pixel style colours: full (every rendered colour), model (snap to the model's own texture swatches in
   * `shadeSteps` light bands: clean toon shading), levels (posterise to `colorLevels` per channel).
   */
  palette?: 'full' | 'model' | 'levels';
  shadeSteps?: number;
  colorLevels?: number;
  /** Pixel style: draw a 1 px outline around the silhouette. */
  outline?: boolean;
  outlineColor?: string;
  /** Pixel style edges: hard cut at 50 % coverage (default) or 'soft' (four alpha steps, for smoke and glows). */
  alphaThreshold?: number | 'soft';
  /** Post-render look (outline, grading, texture, cel bands). */
  stylize?: StyleConfig;
}

/**
 * Post-render stylization, applied to every frame as a 2D pass (alpha-preserving): an outline around the
 * silhouette (clean style too), colour grading, a paper/canvas texture, and cel-shading bands (toon) which the
 * renderer produces from the model's own palette.
 */
export interface StyleConfig {
  outline?: { width: 0 | 1 | 2; color: string; soft?: boolean };
  /** Each in -1..1 (0 = as rendered); hue in degrees; posterize = colour levels per channel (0 = off). */
  grade?: { brightness?: number; contrast?: number; saturation?: number; hue?: number; posterize?: number };
  overlay?: { texture: 'none' | 'paper' | 'canvas' | 'noise'; opacity: number; blend: 'multiply' | 'overlay' };
  /** Cel shading: snap shading to this many light bands of the model's palette (clean style). */
  toon?: { steps: number };
}

export const DEFAULT_QUALITY: QualityConfig = {
  supersample: 2, textureFilter: 'nearest', shadow: 'high', style: 'clean', palette: 'model', shadeSteps: 4, colorLevels: 6,
  outline: true, outlineColor: '#1a1418',
};

export interface ViewConfig {
  projection: Projection;
  /** Camera elevation above the ground plane in degrees (0 = side view, 90 = straight down). */
  pitch: number;
  /** Vertical field of view in degrees (persp only). */
  fov: number;
  directions: DirectionSetId;
  /**
   * Chosen directions instead of the whole set (FB-098): set angles in compass degrees (0 = E, 90 = N), as named
   * in a spec ("dirs": "E" or ["N", "S"]). `directions` then holds the set with as many directions (or '1').
   */
  angles?: number[];
  basis: DirectionBasis;
  /** Render only the right-hand half and mark the rest as horizontal mirrors (the engine flips them). */
  mirror: boolean;
  order: DirectionOrder;
  naming: DirectionNaming;
  scale: ScaleConfig;
  /** Frame size in pixels: exact in fit mode, the minimum in ppm/tile mode. */
  frameWidth: number;
  frameHeight: number;
  /** Frames per second sampled from the animation. */
  fps: number;
  /** Fraction of the frame left empty around the asset (fit) / pixels of margin (ppm, tile). */
  padding: number;
  /**
   * ppm/tile only: feet pivot height above the frame bottom in pixels (minimum; grows if an asset needs
   * more). With frameWidth/frameHeight set, every asset gets an identical frame and pivot. Null = auto.
   */
  pivotBottom?: number | null;
  /** Rendering quality (optional for configs saved before it existed). */
  quality?: QualityConfig;
  /** Layered exports: a different stylization per layer kind, merged over quality.stylize. */
  stylizeByKind?: Partial<Record<'body' | 'equipment' | 'fx', StyleConfig>>;
  /**
   * Objects: render grid-aligned facings instead of `directions` (see `facingAngles`): 1 = one facing, 2 = the two
   * grid axes (walls, fences, wire), 4 = all four. 0 or absent = use `directions`. Object exports in diamond-grid
   * views default to 1 unless directions were asked for explicitly (`objectView`).
   */
  facings?: ObjectFacings;
  /** Objects on a diamond tile lock: cut each frame into per-tile-column strips for depth sorting (manifest `object.slices`). */
  slice?: 'columns';
  /**
   * Objects: height of the ground slice whose hull is the collision polygon, metres above the model's bottom
   * (default: 0.5 m or the lowest 15 % of the height, whichever is smaller). See `objectInfo`.
   */
  collisionHeight?: number;
  /**
   * Objects: which polygon they collide with. 'full' = the whole hull; 'base' = the ground slice (see
   * collisionHeight); 'concave' = the outline of the slice (the whole model unless collisionHeight), following a
   * curved wall or fence instead of its hull (FB-099); 'auto' or absent = by what the model is (vehicles,
   * aircraft, buildings: full; trees, poles: base) and its shape (FB-050). See `collisionRule`.
   */
  collision?: CollisionMode;
}

export type ObjectFacings = 0 | 1 | 2 | 4;
export const OBJECT_FACINGS: ObjectFacings[] = [1, 2, 4];

/** The style a layer gets: the view's own, with any per-kind override merged on top. */
export function styleForKind(view: ViewConfig, kind: 'body' | 'equipment' | 'fx'): StyleConfig | undefined {
  const base = view.quality?.stylize, over = view.stylizeByKind?.[kind];
  if (!base && !over) return undefined;
  return { ...(base ?? {}), ...(over ?? {}) };
}

export interface StylePreset {
  id: 'clean' | 'pixel' | 'hand_painted' | 'stylized';
  label: string;
  hint: string;
  quality: QualityConfig;
}

/** Ready-made looks (the Wizard's Look cards and the Studio's Stylize presets). */
export const STYLE_PRESETS: StylePreset[] = [
  { id: 'clean', label: 'Clean', hint: 'Smooth, detailed sprites that look like the 3D model.', quality: { supersample: 2, textureFilter: 'nearest', shadow: 'high', style: 'clean', palette: 'model', shadeSteps: 4, colorLevels: 6, outline: true, outlineColor: '#1a1418' } },
  { id: 'pixel', label: 'Pixel art', hint: 'Chunky pixels, few colours and a dark outline, like a retro game.', quality: { supersample: 3, textureFilter: 'nearest', shadow: 'high', style: 'pixel', palette: 'model', shadeSteps: 4, colorLevels: 6, outline: true, outlineColor: '#1a1418' } },
  {
    id: 'hand_painted', label: 'Hand-painted', hint: 'Soft dark edges, warmer colours and a paper grain, like painted 2D art.',
    quality: {
      supersample: 3, textureFilter: 'linear', shadow: 'high', style: 'clean', palette: 'model', shadeSteps: 4, colorLevels: 6, outline: true, outlineColor: '#1a1418',
      stylize: { outline: { width: 1, color: '#2a211c', soft: true }, grade: { saturation: 0.1, contrast: 0.05 }, overlay: { texture: 'paper', opacity: 0.15, blend: 'multiply' } },
    },
  },
  {
    id: 'stylized', label: 'Stylized', hint: 'Bold cel shading in three light bands with a thick outline, like a cartoon.',
    quality: {
      supersample: 3, textureFilter: 'nearest', shadow: 'high', style: 'clean', palette: 'model', shadeSteps: 4, colorLevels: 6, outline: true, outlineColor: '#1a1418',
      stylize: { outline: { width: 2, color: '#14110f' }, grade: { saturation: 0.15 }, toon: { steps: 3 } },
    },
  },
];

export interface ViewPreset {
  id: string;
  label: string;
  hint: string;
  config: ViewConfig;
}

const base: ViewConfig = {
  projection: 'ortho', pitch: 45, fov: 30, directions: '8', basis: 'world', mirror: false, order: 'ccw-e',
  naming: 'compass', scale: { mode: 'fit' }, frameWidth: 128, frameHeight: 128, fps: 12, padding: 0.06,
  quality: DEFAULT_QUALITY,
};

export const VIEW_PRESETS: ViewPreset[] = [
  { id: 'side2', label: 'Side-scroller', hint: 'Platformers, brawlers. 0° camera, left/right.', config: { ...base, pitch: 0, directions: '2' } },
  { id: 'lowthreequarter', label: 'Low 3/4 (beat-em-up)', hint: 'Streets of Rage style: slight top view.', config: { ...base, pitch: 18, directions: '2' } },
  { id: 'jrpg4', label: '3/4 top-down, 4 dir (JRPG)', hint: 'Zelda / Stardew style.', config: { ...base, pitch: 45, directions: '4', order: 'cw-s' } },
  { id: 'topdown8', label: '3/4 top-down, 8 dir', hint: 'Top-down action / RPG.', config: { ...base, pitch: 45, directions: '8' } },
  { id: 'high8', label: 'High top-down, 8 dir', hint: 'Twin-stick shooters.', config: { ...base, pitch: 60, directions: '8', basis: 'screen' } },
  { id: 'straightdown', label: 'Straight down (engine rotates)', hint: '1 direction; rotate the sprite in the engine.', config: { ...base, pitch: 90, directions: '1' } },
  { id: 'iso8', label: 'Isometric 2:1, 8 dir', hint: 'Pixel-art "isometric" (dimetric, 30°): 64×32 tiles.', config: { ...base, pitch: 30, directions: '8' } },
  { id: 'iso4d', label: 'Isometric 2:1, 4 diagonal', hint: 'Iso games where units move along tile edges.', config: { ...base, pitch: 30, directions: '4d' } },
  { id: 'trueiso8', label: 'True isometric, 8 dir', hint: '35.264° (atan 1/√2), equal foreshortening.', config: { ...base, pitch: 35.264, directions: '8' } },
  { id: 'hexflat6', label: 'Hex flat-top, 6 dir', hint: 'Hex grid neighbours (flat-top hexes).', config: { ...base, pitch: 45, directions: '6f', basis: 'screen' } },
  { id: 'hexpointy6', label: 'Hex pointy-top, 6 dir', hint: 'Hex grid neighbours (pointy-top hexes).', config: { ...base, pitch: 45, directions: '6p', basis: 'screen' } },
  { id: 'vehicle16', label: 'Vehicle, 16 dir', hint: 'Smoothly turning vehicles.', config: { ...base, pitch: 45, directions: '16', frameWidth: 192, frameHeight: 192, padding: 0.04 } },
  { id: 'rts32', label: 'RTS unit / turret, 32 dir', hint: 'Classic RTS facings (mirroring halves the sheet).', config: { ...base, pitch: 45, directions: '32', mirror: true } },
  { id: 'rpgmaker', label: 'RPG Maker MZ (48 px)', hint: '3×4 sheet rows: down, left, right, up.', config: { ...base, pitch: 30, directions: '4', order: 'rpgmaker', naming: 'words', frameWidth: 48, frameHeight: 48, padding: 0.02 } },
  { id: 'lpc', label: 'LPC (64 px)', hint: 'Liberated Pixel Cup rows: up, left, down, right.', config: { ...base, pitch: 20, directions: '4', order: 'ccw-n', naming: 'words', frameWidth: 64, frameHeight: 64, padding: 0.02 } },
];

export const DIRECTION_SETS: { id: DirectionSetId; label: string }[] = [
  { id: '1', label: '1 (facing camera)' },
  { id: '2', label: '2 (left / right)' },
  { id: '4', label: '4 cardinal' },
  { id: '4d', label: '4 diagonal (iso tile edges)' },
  { id: '6f', label: '6 hex flat-top' },
  { id: '6p', label: '6 hex pointy-top' },
  { id: '8', label: '8' },
  { id: '12', label: '12' },
  { id: '16', label: '16' },
  { id: '32', label: '32' },
];

/** The set's intended angles (compass degrees, CCW from East). */
export function setAngles(id: DirectionSetId): number[] {
  switch (id) {
    case '1': return [270];
    case '2': return [0, 180];
    case '4': return [0, 90, 180, 270];
    case '4d': return [45, 135, 225, 315];
    case '6f': return [30, 90, 150, 210, 270, 330];
    case '6p': return [0, 60, 120, 180, 240, 300];
    default: {
      const n = Number(id);
      return Array.from({ length: n }, (_, i) => (i * 360) / n);
    }
  }
}

const norm = (a: number) => ((a % 360) + 360) % 360;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => norm((r * 180) / Math.PI);
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const sameAngle = (a: number, b: number) => {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 360 - d) < 1e-3;
};

/** Where a world facing appears on screen for a camera at `pitch`. */
export function projectAngle(worldAngle: number, pitch: number) {
  const p = rad(Math.max(0.0001, Math.min(90, pitch)));
  return round6(deg(Math.atan2(Math.sin(rad(worldAngle)) * Math.sin(p), Math.cos(rad(worldAngle)))));
}

/** The world facing that appears at `screenAngle` on screen (inverse of projectAngle). */
export function unprojectAngle(screenAngle: number, pitch: number) {
  const p = rad(Math.max(0.0001, Math.min(90, pitch)));
  return round6(deg(Math.atan2(Math.sin(rad(screenAngle)), Math.cos(rad(screenAngle)) * Math.sin(p))));
}

const COMPASS16 = ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'];
const WORDS8: Record<number, string> = {
  0: 'right', 45: 'up_right', 90: 'up', 135: 'up_left', 180: 'left', 225: 'down_left', 270: 'down', 315: 'down_right',
};

const DIRECTION_SET_IDS = new Set<string>(DIRECTION_SETS.map((d) => d.id));

/**
 * A `dirs` value from a spec, the CLI or MCP (FB-098): a direction set ("1", 8, "4d"), or direction names, one or
 * several ("E", "N,S", ["N", "S"]): compass names (E, NE, N… and ENE, NNE…), "right"/"up_left"… or "a045" degrees.
 * Names give `angles` (compass degrees, in the order given, duplicates dropped) and the set with as many directions.
 */
export function parseDirs(v: unknown): { directions: DirectionSetId; angles?: number[] } {
  if (typeof v === 'number' && DIRECTION_SET_IDS.has(String(v))) return { directions: String(v) as DirectionSetId };
  const list = (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).split(/[,\s]+/) : [null])).filter((x) => x !== '');
  if (list.length === 1 && list[0] !== null && DIRECTION_SET_IDS.has(list[0].toLowerCase())) return { directions: list[0].toLowerCase() as DirectionSetId };
  const angles: number[] = [];
  for (const x of list) {
    const a = x === null ? null : directionAngle(x);
    if (a === null) {
      throw new Error(`dirs: ${JSON.stringify(x === null ? v : x)} is neither a direction count (${[...DIRECTION_SET_IDS].join(', ')}) nor a direction name (E, NE, N, NW, W, SW, S, SE, ENE…; right, up_left…; a045).`);
    }
    if (!angles.some((b) => sameAngle(a, b))) angles.push(a);
  }
  if (!angles.length) throw new Error('dirs: give a direction count (1, 2, 4, 8…) or direction names (E, ["N", "S"]).');
  const n = String(angles.length);
  return { directions: (DIRECTION_SET_IDS.has(n) ? n : '1') as DirectionSetId, angles };
}

/** A direction's compass angle from its name (E, NNE, up_left, a045), or null. */
export function directionAngle(name: string): number | null {
  const n = name.trim();
  const c = COMPASS16.findIndex((x) => x.toLowerCase() === n.toLowerCase());
  if (c >= 0) return c * 22.5;
  const w = Object.entries(WORDS8).find(([, x]) => x === n.toLowerCase().replace(/[- ]/g, '_'));
  if (w) return Number(w[0]);
  const d = /^a(\d{1,3}(?:\.\d+)?)$/i.exec(n);
  return d && Number(d[1]) < 360 ? Number(d[1]) : null;
}

/** A view's directions in a spec's words: the set ("8") or the chosen names ("E", "N,S"). */
export const dirsText = (v: Pick<ViewConfig, 'directions' | 'angles' | 'naming'>) => (v.angles?.length ? v.angles.map((a) => directionName(a, 'compass')).join(',') : String(v.directions));

export function directionName(angle: number, naming: DirectionNaming) {
  const a = round6(norm(angle));
  if (naming === 'words' && WORDS8[a] !== undefined) return WORDS8[a];
  if (naming !== 'degrees' && Number.isInteger(a / 22.5)) {
    const c = COMPASS16[a / 22.5];
    return naming === 'words' ? c.toLowerCase() : c;
  }
  return `a${String(Math.round(a)).padStart(3, '0')}`;
}

function orderKey(angle: number, order: DirectionOrder) {
  switch (order) {
    case 'ccw-e': return norm(angle);
    case 'ccw-n': return norm(angle - 90); // LPC: up, left, down, right
    case 'cw-n': return norm(90 - angle);
    case 'cw-s': return norm(270 - angle);
    case 'rpgmaker': {
      // RPG Maker rows: down, left, right, up. Other angles (8-dir plugins) follow clockwise from down.
      const fixed: Record<number, number> = { 270: 0, 180: 1, 0: 2, 90: 3 };
      const a = round6(norm(angle));
      return fixed[a] !== undefined ? fixed[a] - 10 : norm(270 - angle);
    }
  }
}

export interface Direction {
  /** Position in the ordered list. */
  index: number;
  name: string;
  /** Angle as it appears on screen (what game code compares against). */
  screenAngle: number;
  /** Ground-plane facing the asset is rendered at. */
  worldAngle: number;
  /** When mirroring: index of the rendered direction this one is a horizontal flip of. */
  mirrorOf: number | null;
}

/**
 * Resolve a config into its ordered directions. Set angles are interpreted in the configured basis: in
 * 'world' basis they are ground facings (screen angle = projection), in 'screen' basis they are screen
 * angles (world facing = unprojection). Side views (pitch 0) and straight-down views have no difference.
 */
export function resolveDirections(
  cfg: Pick<ViewConfig, 'directions' | 'basis' | 'mirror' | 'order' | 'naming' | 'pitch'> & Partial<Pick<ViewConfig, 'facings' | 'scale' | 'projection' | 'angles'>>,
): Direction[] {
  const oblique = cfg.pitch > 0.01 && cfg.pitch < 89.99;
  // Facings are ground directions along the tile grid, whatever the basis.
  const facings = cfg.facings ? facingAngles(viewGrid(cfg), cfg.facings) : null;
  const dirs = (facings ?? (cfg.angles?.length ? cfg.angles : setAngles(cfg.directions))).map((a) => {
    const worldAngle = oblique && cfg.basis === 'screen' && !facings ? unprojectAngle(a, cfg.pitch) : a;
    const screenAngle = oblique ? projectAngle(worldAngle, cfg.pitch) : a;
    return { worldAngle, screenAngle, setAngle: a };
  });
  dirs.sort((x, y) => orderKey(x.setAngle, cfg.order) - orderKey(y.setAngle, cfg.order));
  const out: Direction[] = dirs.map((d, index) => ({
    index,
    name: directionName(d.setAngle, cfg.naming),
    screenAngle: d.screenAngle,
    worldAngle: d.worldAngle,
    mirrorOf: null,
  }));
  if (cfg.mirror) {
    // A horizontal flip maps screen angle s to 180 - s. Directions pointing left (cos s < 0) become mirrors
    // of their right-pointing partner; straight up/down (and anything without a partner) is rendered.
    for (const d of out) {
      if (Math.cos(rad(d.screenAngle)) >= -1e-6) continue;
      const partner = out.find((o) => sameAngle(o.screenAngle, 180 - d.screenAngle));
      if (partner && partner.mirrorOf === null && Math.cos(rad(partner.screenAngle)) >= -1e-6) d.mirrorOf = partner.index;
    }
  }
  return out;
}

/**
 * The ground grid a view's objects stand on: a tile lock says it; otherwise an isometric pitch (25–40°: 2:1 pixel
 * iso at 30°, true iso at 35.26°) means a diamond grid and anything else a square one.
 */
export function viewGrid(cfg: Pick<ViewConfig, 'pitch'> & Partial<Pick<ViewConfig, 'scale' | 'projection'>>): 'square' | 'diamond' {
  if (cfg.scale?.mode === 'tile') return cfg.scale.shape;
  return cfg.projection !== 'persp' && cfg.pitch >= 25 && cfg.pitch <= 40 ? 'diamond' : 'square';
}

/**
 * Grid-aligned facings (world compass angles), the model's front (+Z) pointing along a grid axis so its sides lie
 * on the tile edges. Diamond grids (u down-right, v down-left): +u = SE 315°, +v = SW 225°, -u = NW 135°, -v = NE
 * 45°. Square grids (u right, v down): +v = S 270°, +u = E 0°, -v = N 90°, -u = W 180°. 1 = the first (front towards
 * the camera), 2 = one along each axis (walls, fences: both runs of a wall), 4 = all four.
 */
export function facingAngles(grid: 'square' | 'diamond', facings: Exclude<ObjectFacings, 0>): number[] {
  const all = grid === 'diamond' ? [315, 225, 135, 45] : [270, 0, 90, 180];
  return all.slice(0, facings);
}

/**
 * An object export's view: in a diamond-grid (iso) view with no facings chosen, one grid-aligned facing instead of
 * `directions` (an unturned prop would stand square to the screen, across the diamonds). facings 0 keeps directions.
 */
export function objectView<V extends Pick<ViewConfig, 'pitch' | 'facings'> & Partial<Pick<ViewConfig, 'scale' | 'projection'>>>(view: V): V {
  return view.facings === undefined && viewGrid(view) === 'diamond' ? { ...view, facings: 1 } : view;
}

/** The grid axis a facing points along ('+u', '-v'…), or null when it is not grid-aligned. */
export function facingAxis(worldAngle: number, grid: 'square' | 'diamond'): '+u' | '+v' | '-u' | '-v' | null {
  // The order of facingAngles: diamond grids start along +u (SE), square grids along +v (S).
  const axes = grid === 'diamond' ? (['+u', '+v', '-u', '-v'] as const) : (['+v', '+u', '-v', '-u'] as const);
  const i = facingAngles(grid, 4).findIndex((a) => sameAngle(a, worldAngle));
  return i < 0 ? null : axes[i];
}

/**
 * Yaw (radians, about +Y) that turns a +Z-forward asset (Synty/glTF convention) to the given ground facing,
 * with the camera looking from +Z towards -Z.
 */
export function yawForAngle(worldAngle: number): number {
  return rad(worldAngle + 90);
}

export function pixelsPerMetre(scale: ScaleConfig): number | null {
  if (scale.mode === 'ppm') return scale.ppm;
  if (scale.mode === 'tile') return scale.tilePx / (scale.metresPerTile * (scale.shape === 'diamond' ? Math.SQRT2 : 1));
  return null;
}

export interface Bounds {
  minY: number;
  maxY: number;
  /** Max horizontal distance from the asset origin over all sampled frames (direction-invariant). */
  radius: number;
}

export interface Framing {
  /** Ortho half extents in world units. */
  viewHalfW: number;
  viewHalfH: number;
  /** Camera-space vertical centre of the view. */
  centreY: number;
  /** Camera-space horizontal centre of the view (default 0: the model origin; portraits centre on the face). */
  centreX?: number;
  frameWidth: number;
  frameHeight: number;
  /** Pixel position of the asset origin (its ground pivot), from the frame's top-left. */
  pivot: { x: number; y: number };
  /** Pixels per metre (null for persp). */
  ppm: number | null;
}

/**
 * Direction-invariant framing: every direction and frame shares one scale and one pivot, so nothing
 * jitters. In ppm/tile mode the scale is fixed and the frame grows to fit (never below the configured
 * size), with the feet pivot snapped to whole pixels so different assets line up.
 */
export function computeFraming(b: Bounds, cfg: Pick<ViewConfig, 'pitch' | 'frameWidth' | 'frameHeight' | 'padding' | 'scale' | 'projection' | 'pivotBottom'>): Framing {
  const p = rad(Math.min(cfg.pitch, 89.9));
  const top = b.maxY * Math.cos(p) + b.radius * Math.sin(p);
  const bottom = Math.min(0, b.minY) * Math.cos(p) - b.radius * Math.sin(p);
  const ppm = cfg.projection === 'ortho' ? pixelsPerMetre(cfg.scale) : null;

  if (ppm === null) {
    const halfW = b.radius;
    const halfH = (top - bottom) / 2;
    const aspect = cfg.frameWidth / cfg.frameHeight;
    // G17: on a 0.1 mm grid (the half height rounded up, so nothing is cut). Measured bounds differ by a few ulps
    // from one page load to the next; on the grid the same model and clips frame the same, so their frame-cache
    // keys and sheets do too. A 0.1 mm step is far below a pixel at any frame size.
    const grid = (v: number, f: (x: number) => number) => f(v * 1e4) / 1e4;
    const viewHalfH = grid(Math.max(halfH, halfW / aspect) / (1 - 2 * cfg.padding), Math.ceil);
    const viewHalfW = viewHalfH * aspect;
    const centreY = grid((top + bottom) / 2, Math.round);
    return {
      viewHalfW, viewHalfH, centreY, frameWidth: cfg.frameWidth, frameHeight: cfg.frameHeight, ppm: null,
      pivot: { x: cfg.frameWidth / 2, y: cfg.frameHeight / 2 + (centreY / viewHalfH) * (cfg.frameHeight / 2) },
    };
  }

  // Fixed scale. Margin in pixels (padding < 1 is treated as a fraction of the configured frame).
  const margin = cfg.padding < 1 ? Math.ceil(cfg.padding * cfg.frameHeight) : Math.ceil(cfg.padding);
  const below = Math.max(Math.ceil(-bottom * ppm) + margin, cfg.pivotBottom ?? 0); // pixels from pivot to frame bottom
  const above = Math.ceil(top * ppm) + margin;
  const half = Math.ceil(b.radius * ppm) + margin;
  const even = (n: number) => n + (n % 2);
  const frameWidth = Math.max(cfg.frameWidth, even(2 * half));
  const frameHeight = Math.max(cfg.frameHeight, even(above + below));
  // Feet anchored `below` px from the bottom; any extra height goes on top.
  const pivot = { x: frameWidth / 2, y: frameHeight - below };
  const viewHalfW = frameWidth / 2 / ppm;
  const viewHalfH = frameHeight / 2 / ppm;
  // Camera-space y at the frame centre: the pivot (y=0) sits (frameHeight/2 - below) px below centre.
  const centreY = (frameHeight / 2 - below) / ppm;
  return { viewHalfW, viewHalfH, centreY, frameWidth, frameHeight, pivot, ppm };
}

/** Frame layout for a batch: the largest frame any asset needs, so every sheet shares size and pivot. */
export function unionFraming(framings: Framing[]): Pick<Framing, 'frameWidth' | 'frameHeight'> {
  return {
    frameWidth: Math.max(...framings.map((f) => f.frameWidth)),
    frameHeight: Math.max(...framings.map((f) => f.frameHeight)),
  };
}
